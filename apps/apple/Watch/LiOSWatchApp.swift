// Adapted from OpenClaw pinned WatchConnectivityReceiver snapshot transport;
// no donor Gateway/configuration/approval authority is imported.
import SwiftUI
import WatchConnectivity
import UserNotifications

@main struct LiOSWatchApp: App {
    @StateObject private var model = WatchHomeModel()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                List {
                    Section("Canonical Home via phone") {
                        Text(model.status)
                        Text(model.project).font(.headline)
                        Text("Observed \(model.observedAt)").font(.caption2)
                        Text("Snapshot only. For fresh state open LiOS and reconnect on your paired phone.").font(.caption2)
                        Button("Enable local alerts") {
                            Task { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) }
                        }
                    }
                    Section("Home notifications") {
                        ForEach(Array(model.notifications.enumerated()), id: \.offset) { _, row in
                            VStack(alignment: .leading) {
                                Text(row["title"] as? String ?? "Home update")
                                Text(row["body"] as? String ?? "").font(.caption2)
                                if let id = row["decisionId"] as? Int { Button("Review Decision \(id) on phone") { model.openReview(id) } }
                            }
                        }
                    }
                    Section("Review continuation") {
                        TextField("Decision ID", text: $model.decisionId)
                        Button("Open review on phone") {
                            if let id = Int(model.decisionId), id > 0 { model.openReview(id) }
                            else { model.result = "Enter a canonical Decision ID." }
                        }
                        Text(model.result).font(.caption2)
                        Text("No watch approval or offline auto-release. The phone rereads the receipt; owner review and explicit release remain required.").font(.caption2)
                    }
                }.navigationTitle("LiOS")
            }
        }
    }
}
@MainActor final class WatchHomeModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var status = "Phone/Home unavailable"
    @Published var project = "LiOS"
    @Published var observedAt = "Not received"
    @Published var notifications: [[String: Any]] = []
    @Published var result = ""
    @Published var decisionId = ""
    private var homeId = ""
    private var snapshotId = ""
    private var notified = Set<String>()
    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self; WCSession.default.activate()
            apply(WCSession.default.receivedApplicationContext)
        }
    }
    func apply(_ payload: [String: Any]) {
        guard payload["schemaVersion"] as? Int == 1, let snapshot = payload["snapshotId"] as? String,
              snapshot != snapshotId, let home = payload["homeId"] as? String,
              let rows = payload["notifications"] as? [[String: Any]], rows.count <= 10 else { return }
        homeId = home; snapshotId = snapshot
        status = payload["status"] as? String ?? "Home unavailable"
        project = payload["project"] as? String ?? "LiOS"
        observedAt = payload["observedAt"] as? String ?? "Unknown"
        notifications = rows
        for row in rows {
            guard row["status"] as? String == "delivered", row["unread"] as? Bool == true,
                  let id = row["id"] as? String, !id.isEmpty, notified.insert(id).inserted else { continue }
            let content = UNMutableNotificationContent()
            content.title = "LiOS Home update"
            content.body = "Open LiOS on your phone to review."
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }
    func openReview(_ id: Int) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isReachable, !homeId.isEmpty else { result = "Phone unreachable. No review was queued or approved."; return }
        WCSession.default.sendMessage(["kind": "review.open", "requestId": UUID().uuidString,
            "homeId": homeId, "snapshotId": snapshotId, "decisionId": id], replyHandler: { reply in
                Task { @MainActor in self.result = reply["message"] as? String ?? "Phone did not confirm review." }
            }, errorHandler: { error in Task { @MainActor in self.result = error.localizedDescription } })
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.apply(session.receivedApplicationContext) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.apply(message) }
    }
}
