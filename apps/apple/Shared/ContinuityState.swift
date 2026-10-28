import Foundation

/// One observed run, never a replayable start request. Set before sending start.
struct RunCursor: Codable {
    private(set) var requestId: String?
    private(set) var sequence = -1
    mutating func begin(_ id: String) { requestId = id; sequence = -1 }
    mutating func clear() { requestId = nil; sequence = -1 }
    mutating func receive(_ payload: [String: Any]) -> Bool {
        guard let id = requestId, payload["requestId"] as? String == id,
              let seq = payload["runSeq"] as? Int, seq > sequence else { return false }
        sequence = seq
        if let event = payload["event"] as? [String: Any], event["type"] as? String == "done", event["status"] as? String != "waiting_approval" { clear() }
        return true
    }
    mutating func subscribed(_ id: String, status: String) {
        if requestId == id && status == "finished" { clear() }
    }
}

/// Identifier-only observation checkpoint. It can reattach, never replay a start/write.
struct RunObservation: Codable {
    let home: HomeConfiguration
    let deviceId: String
    let homeId: String
    let userId: Int
    let projectId: Int
    let chatId: Int
    let cursor: RunCursor
    func validate() throws {
        let normalized = try HomeConfiguration.validated(address: home.address, fingerprint: home.fingerprint)
        guard normalized == home, UUID(uuidString: homeId) != nil, userId > 0, projectId > 0, chatId > 0,
              deviceId.count == 32, deviceId.allSatisfy({ $0.isASCII && $0.isHexDigit }), cursor.sequence >= -1,
              cursor.sequence <= 9_007_199_254_740_991,
              cursor.requestId == nil || UUID(uuidString: cursor.requestId!) != nil else {
            throw ClientFailure(message: "Invalid saved run observation.")
        }
    }
}

struct NotificationReadIntent: Codable, Equatable {
    let homeId: String
    let userId: Int
    let deviceId: String
    let projectId: Int
    let notificationId: String
    var params: [String: Any] { ["homeId": homeId, "userId": userId, "deviceId": deviceId, "projectId": projectId, "notificationId": notificationId] }
}

/// This narrow queue cannot contain messages, workflow runs or Decision reviews.
@MainActor final class NotificationReadOutbox {
    private(set) var items: [NotificationReadIntent] = []
    func load() throws {
        guard let data = try DeviceKeychain.load("notification-read-outbox") else { return }
        guard data.count <= 100_000 else { throw ClientFailure(message: "Notification-read outbox exceeds its bound.") }
        let loaded = try JSONDecoder().decode([NotificationReadIntent].self, from: data)
        guard loaded.count <= 50, loaded.allSatisfy({ UUID(uuidString: $0.homeId) != nil && $0.userId > 0 && $0.projectId > 0 && $0.deviceId.count == 32 && !$0.notificationId.isEmpty && $0.notificationId.count <= 300 }) else { throw ClientFailure(message: "Invalid notification-read outbox.") }
        items = loaded
    }
    func enqueue(_ intent: NotificationReadIntent) throws {
        if items.contains(intent) { return }
        guard items.count < 50 else { throw ClientFailure(message: "Notification-read outbox is full; reconnect to reconcile it.") }
        try persist(items + [intent])
    }
    func remove(_ intent: NotificationReadIntent) throws { try persist(items.filter { $0 != intent }) }
    private func persist(_ next: [NotificationReadIntent]) throws {
        let data = try JSONEncoder().encode(next)
        guard data.count <= 100_000 else { throw ClientFailure(message: "Notification-read outbox exceeds its bound.") }
        try DeviceKeychain.save(data, account: "notification-read-outbox")
        items = next
    }
}
