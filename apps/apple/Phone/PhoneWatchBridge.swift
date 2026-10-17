// WatchConnectivity snapshot/immediate-delivery mechanisms adapted from pinned
// OpenClaw apps/ios/Sources/Services/WatchConnectivityTransport.swift.
import Foundation
import WatchConnectivity

@MainActor final class PhoneWatchBridge: NSObject, WCSessionDelegate {
    var onReviewRequest: ((Int) -> Void)?
    private var homeId = ""
    private var snapshotId = UUID().uuidString
    private var received = Set<String>()
    override init() {
        super.init()
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }
    func publish(status: String, project: String, notifications: [[String: Any]], homeId: String) {
        guard WCSession.isSupported() else { return }
        self.homeId = homeId; snapshotId = UUID().uuidString
        let rows = notifications.prefix(10).map { row -> [String: Any] in
            var value: [String: Any] = ["id": row["id"] as? String ?? "", "title": row["title"] as? String ?? "Home update",
                "body": String((row["body"] as? String ?? "Open LiOS on phone to review.").prefix(1000)),
                "status": row["status"] as? String ?? "unknown", "unread": row["readAt"] is NSNull]
            // Canonical notification evidence may identify a Decision; never derive authority from prose.
            if let evidence = row["evidence"] as? [String: Any], let id = evidence["decisionId"] as? Int { value["decisionId"] = id }
            return value
        }
        let payload: [String: Any] = ["schemaVersion": 1, "homeId": homeId, "snapshotId": snapshotId,
            "status": status, "project": project, "notifications": rows,
            "observedAt": ISO8601DateFormatter().string(from: Date())]
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        do { try session.updateApplicationContext(payload) }
        catch { return } // Delivery remains unavailable, not a success receipt.
        if session.isReachable { session.sendMessage(payload, replyHandler: nil, errorHandler: nil) }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in
            guard message["kind"] as? String == "review.open", let request = message["requestId"] as? String,
                  UUID(uuidString: request) != nil, message["homeId"] as? String == homeId, !homeId.isEmpty,
                  message["snapshotId"] as? String == snapshotId, let id = message["decisionId"] as? Int, id > 0,
                  !received.contains(request) else { replyHandler(["ok": false, "message": "Stale or invalid Home review request; refresh on phone."]); return }
            if received.count >= 100 { received.removeAll() }
            received.insert(request)
            onReviewRequest?(id)
            replyHandler(["ok": true, "message": "Review request received on phone. Reading and approval still require phone interaction."])
        }
    }
}
