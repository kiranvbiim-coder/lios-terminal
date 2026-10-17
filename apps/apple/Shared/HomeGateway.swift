import Foundation
import Combine

@MainActor final class HomeGateway: ObservableObject {
    @Published private(set) var status = "Disconnected"
    @Published private(set) var connected = false
    var onEvent: ((String, [String: Any]) -> Void)?
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var receiver: Task<Void, Never>?
    private var pending: [String: CheckedContinuation<[String: Any], Error>] = [:]
    private var methods: Set<String> = []
    private var pairingToken = ""
    private var identity: DeviceIdentity?
    private var home: HomeConfiguration?
    private var generation = UUID()
    private var lastSequence: Int?

    func connect(home: HomeConfiguration, pairingToken: String = "") throws {
        disconnect()
        identity = try DeviceIdentity.loadOrCreate()
        self.home = home
        self.pairingToken = pairingToken.trimmingCharacters(in: .whitespacesAndNewlines)
        let delegate = PinnedHomeSession(home: home)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 20
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        let task = session!.webSocketTask(with: home.url)
        task.maximumMessageSize = 1_048_576
        socket = task
        let current = generation
        status = "Connecting to pinned Home"
        task.resume()
        receiver = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let message = try await task.receive()
                    guard let self, self.generation == current else { return }
                    let data: Data
                    switch message {
                    case .string(let text): data = Data(text.utf8)
                    case .data: throw ClientFailure(message: "Home sent a non-text Gateway frame.")
                    @unknown default: throw ClientFailure(message: "Unsupported Gateway frame.")
                    }
                    guard data.count <= 1_048_576, let frame = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        throw ClientFailure(message: "Invalid Home Gateway frame.")
                    }
                    try await self.receive(frame)
                }
            } catch {
                guard let self, self.generation == current else { return }
                self.fail(error)
            }
        }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard let self, self.generation == current, !self.connected, self.status != "Awaiting owner approval on Home" else { return }
            self.fail(ClientFailure(message: "Home handshake timed out; reconnect explicitly."))
        }
    }
    func disconnect() {
        generation = UUID()
        receiver?.cancel(); receiver = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil
        connected = false; methods = []; lastSequence = nil; status = "Disconnected"
        let waiting = pending.values
        pending.removeAll()
        for continuation in waiting { continuation.resume(throwing: ClientFailure(message: "Disconnected. No pending action was automatically replayed.")) }
    }
    private func fail(_ error: Error) {
        disconnect()
        status = error.localizedDescription
    }
    func call(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        guard connected, methods.contains(method) else { throw ClientFailure(message: "Home is offline or does not offer \(method).") }
        return try await request(method, params)
    }
    private func request(_ method: String, _ params: [String: Any]) async throws -> [String: Any] {
        guard let socket else { throw ClientFailure(message: "Home disconnected.") }
        let id = UUID().uuidString
        let frame: [String: Any] = ["type": "req", "id": id, "method": method, "params": params]
        let bytes = try JSONSerialization.data(withJSONObject: frame)
        guard bytes.count <= 1_048_576, let text = String(data: bytes, encoding: .utf8) else { throw ClientFailure(message: "Request exceeds Home payload bound.") }
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task {
                do { try await socket.send(.string(text)) }
                catch { pending.removeValue(forKey: id)?.resume(throwing: error) }
            }
            Task {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                pending.removeValue(forKey: id)?.resume(throwing: ClientFailure(message: "Home response timed out; read canonical state before retrying any write."))
            }
        }
    }
    private func receive(_ frame: [String: Any]) async throws {
        if frame["type"] as? String == "res", let id = frame["id"] as? String, let waiter = pending.removeValue(forKey: id) {
            if frame["ok"] as? Bool == true { waiter.resume(returning: frame["payload"] as? [String: Any] ?? [:]) }
            else {
                let error = frame["error"] as? [String: Any]
                waiter.resume(throwing: ClientFailure(message: error?["message"] as? String ?? "Home denied the request.", code: error?["code"] as? String))
            }
            return
        }
        guard frame["type"] as? String == "event", let event = frame["event"] as? String else { return }
        let payload = frame["payload"] as? [String: Any] ?? [:]
        if let sequence = frame["seq"] as? Int {
            if let lastSequence, sequence != lastSequence + 1 { onEvent?("resync.required", [:]) }
            lastSequence = sequence
        }
        if event == "connect.challenge" {
            guard let nonce = payload["nonce"] as? String, let identity else { throw ClientFailure(message: "Home challenge missing.") }
            var params: [String: Any] = ["minProtocol": 1, "maxProtocol": 1,
                "client": ["id": "lios-ios", "version": "1.0.0", "platform": "ios", "mode": "ui", "displayName": "LiOS iPhone/iPad"],
                "scopes": ["read", "write"], "device": try identity.proof(nonce: nonce, token: pairingToken, signedAt: Int64(Date().timeIntervalSince1970 * 1000))]
            if !pairingToken.isEmpty { params["pairing"] = ["token": pairingToken, "deviceName": "LiOS iPhone/iPad"] }
            // Receive loop must keep reading while request waits for its response.
            let current = generation
            Task { [weak self] in
                guard let self, self.generation == current else { return }
                do {
                    let hello = try await request("connect", params)
                    guard generation == current else { return }
                    if hello["type"] as? String == "pairing-pending" { status = "Awaiting owner approval on Home"; return }
                    guard hello["type"] as? String == "hello-ok", hello["protocol"] as? Int == 1,
                          (hello["auth"] as? [String: Any])?["deviceId"] as? String == identity.id else {
                        throw ClientFailure(message: "Home did not confirm this device identity.")
                    }
                    methods = Set((hello["features"] as? [String: Any])?["methods"] as? [String] ?? [])
                    guard let home else { throw ClientFailure(message: "Home configuration unavailable.") }
                    try DeviceKeychain.save(try JSONEncoder().encode(home), account: "home")
                    connected = true; status = "Connected to authenticated Home"; pairingToken = ""
                    onEvent?("home.connected", hello)
                } catch {
                    guard generation == current else { return }
                    fail(error)
                }
            }
        } else if event == "pairing.resolved" {
            let approved = payload["outcome"] as? String == "approved"
            guard approved, let home else { fail(ClientFailure(message: "Home pairing denied or expired.")); return }
            try DeviceKeychain.save(try JSONEncoder().encode(home), account: "home")
            try connect(home: home)
        } else if event == "shutdown" { fail(ClientFailure(message: "Home stopped. Reconnect to reread canonical state.")) }
        else { onEvent?(event, payload) }
    }
}
