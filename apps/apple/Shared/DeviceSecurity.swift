// Adapted mechanisms: OpenClaw c074824a, DeviceIdentity.swift,
// GenericPasswordKeychainStore.swift and GatewayTLSPinning.swift. See provenance.json.
import Foundation
import CryptoKit
import Security

struct ClientFailure: LocalizedError {
    let message: String
    var code: String? = nil
    var errorDescription: String? { message }
}

enum DeviceKeychain {
    static let service = "LiOS.Apple.Device"
    static func load(_ account: String) throws -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else {
            throw ClientFailure(message: "Keychain unavailable (\(status)); identity was not replaced.")
        }
        return data
    }
    static func save(_ data: Data, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account]
        let update: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(update) { _, new in new } as CFDictionary, nil)
            if status == errSecDuplicateItem { status = SecItemUpdate(query as CFDictionary, update as CFDictionary) }
        }
        guard status == errSecSuccess else { throw ClientFailure(message: "Keychain write failed (\(status)).") }
    }
    static func remove(_ account: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ClientFailure(message: "Keychain removal failed (\(status)).")
        }
    }
}

struct HomeConfiguration: Codable, Equatable {
    let address: String
    let fingerprint: String
    var url: URL {
        // Construction is only permitted through validated().
        URL(string: address)!
    }
    static func validated(address: String, fingerprint: String) throws -> HomeConfiguration {
        guard let url = URL(string: address), url.scheme == "wss", let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path == "/gateway/device" else {
            throw ClientFailure(message: "Use wss://your-home:port/gateway/device without credentials, query or fragment.")
        }
        let pin = fingerprint.lowercased().replacingOccurrences(of: ":", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard pin.count == 64, pin.allSatisfy({ $0.isHexDigit && $0.isASCII }) else {
            throw ClientFailure(message: "Enter the certificate SHA-256 fingerprint shown on your Home.")
        }
        return HomeConfiguration(address: url.absoluteString, fingerprint: pin)
    }
}

struct DeviceIdentity {
    let key: Curve25519.Signing.PrivateKey
    var id: String { SHA256.hash(data: key.publicKey.rawRepresentation).prefix(16).map { String(format: "%02x", $0) }.joined() }
    static func loadOrCreate() throws -> DeviceIdentity {
        if let raw = try DeviceKeychain.load("ed25519") {
            return DeviceIdentity(key: try Curve25519.Signing.PrivateKey(rawRepresentation: raw))
        }
        let key = Curve25519.Signing.PrivateKey()
        try DeviceKeychain.save(key.rawRepresentation, account: "ed25519")
        return DeviceIdentity(key: key)
    }
    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    func proof(nonce: String, token: String, signedAt: Int64) throws -> [String: Any] {
        let payload = ["lios-device-v1", id, "lios-ios", "ui", "read,write", String(signedAt), nonce, token].joined(separator: "|")
        return ["id": id, "publicKey": Self.base64URL(key.publicKey.rawRepresentation),
            "signature": Self.base64URL(try key.signature(for: Data(payload.utf8))), "signedAt": signedAt]
    }
}

final class PinnedHomeSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let home: HomeConfiguration
    init(home: HomeConfiguration) { self.home = home }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.lowercased() == home.url.host?.lowercased(),
              challenge.protectionSpace.port == (home.url.port ?? 443),
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
        // Explicit owner-provided certificate pin permits a user-owned self-signed Home.
        // No TOFU, system-trust fallback, changed-pin replacement or cross-origin acceptance.
        guard digest == home.fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        urlSession(session, didReceive: challenge, completionHandler: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
