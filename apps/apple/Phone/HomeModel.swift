import Foundation
import SwiftUI
import UserNotifications

@MainActor final class HomeModel: ObservableObject {
    let gateway = HomeGateway()
    let outbox = ReviewOutbox()
    let watch = PhoneWatchBridge()
    @Published var homeAddress = ""
    @Published var fingerprint = ""
    @Published var pairingToken = ""
    @Published var error: String?
    @Published var projects: [[String: Any]] = []
    @Published var continuity: [String: Any] = [:]
    @Published var notifications: [[String: Any]] = []
    @Published var review: [String: Any] = [:]
    @Published var artifact: [String: Any] = [:]
    @Published var runEvents: [[String: Any]] = []
    @Published var projectId: Int?
    @Published var chatId: Int?
    @Published var decisionId = ""
    @Published var message = ""
    @Published var finalDecision = ""
    @Published var rationale = ""
    @Published var outcome = "approved"
    @Published var requestedWatchDecision: Int?
    private var deliveredNotifications = Set<String>()
    private var pageOffset = 0
    private var nextOffset: Int?
    private var polling: Task<Void, Never>?
    private var activeRun: String?
    private var activeRunSequence = -1

    init() {
        do {
            try outbox.load()
            if let data = try DeviceKeychain.load("home") {
                let home = try JSONDecoder().decode(HomeConfiguration.self, from: data)
                homeAddress = home.address; fingerprint = home.fingerprint
            }
        } catch { self.error = error.localizedDescription }
        gateway.onEvent = { [weak self] event, payload in
            guard let self else { return }
            if event == "home.connected" {
                Task {
                    await self.perform { try await self.refreshProjects() }
                    if let activeRun = self.activeRun { await self.perform { _ = try await self.gateway.call("conversation.subscribe", ["requestId": activeRun, "afterSeq": self.activeRunSequence]) } }
                }
            } else if event == "conversation.event" {
                self.runEvents.append(payload)
                if self.runEvents.count > 100 { self.runEvents.removeFirst() }
                if let seq = payload["runSeq"] as? Int { self.activeRunSequence = seq }
                Task { await self.perform { try await self.refreshContinuity() } }
            } else if event == "resync.required" || event == "data.invalidate" {
                Task { await self.perform { try await self.refreshContinuity() } }
            }
        }
        watch.onReviewRequest = { [weak self] decision in self?.requestedWatchDecision = decision }
    }
    func perform(_ operation: () async throws -> Void) async {
        do { try await operation(); error = nil }
        catch { self.error = error.localizedDescription }
    }
    func connect() throws {
        let home = try HomeConfiguration.validated(address: homeAddress, fingerprint: fingerprint)
        try gateway.connect(home: home, pairingToken: pairingToken)
        pairingToken = ""
    }
    func refreshProjects() async throws {
        projects = try await gateway.call("projects.list")["projects"] as? [[String: Any]] ?? []
        if let projectId { try await selectProject(projectId) }
    }
    func selectProject(_ id: Int) async throws {
        projectId = id; chatId = nil; pageOffset = 0
        continuity = [:]; notifications = []; artifact = [:]; review = [:]; runEvents = []
        try await refreshContinuity()
        try await refreshNotifications()
    }
    func refreshContinuity() async throws {
        guard let projectId else { return }
        var params: [String: Any] = ["projectId": projectId, "offset": pageOffset, "limit": 50]
        if let chatId { params["chatId"] = chatId }
        continuity = try await gateway.call("device.continuity.read", params)
        nextOffset = continuity["nextOffset"] as? Int
    }
    func selectChat(_ id: Int) async throws { chatId = id; pageOffset = 0; try await refreshContinuity() }
    func nextMessages() async throws { guard let nextOffset else { return }; pageOffset = nextOffset; try await refreshContinuity() }
    func firstMessages() async throws { pageOffset = 0; try await refreshContinuity() }
    func createChat() async throws {
        guard let projectId else { return }
        let result = try await gateway.call("chats.create", ["projectId": projectId])
        guard let id = (result["chat"] as? [String: Any])?["id"] as? Int else { throw ClientFailure(message: "Home did not return a canonical Chat.") }
        try await selectChat(id)
    }
    func send() async throws {
        guard let chatId, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ClientFailure(message: "Select or create a saved Chat before sending.") }
        let requestId = UUID().uuidString.lowercased()
        _ = try await gateway.call("conversation.start", ["chatId": chatId, "body": ["requestId": requestId, "message": message]])
        activeRun = requestId; activeRunSequence = -1; message = ""
        try await refreshContinuity()
    }
    func cancelRun() async throws {
        guard let activeRun else { return }
        _ = try await gateway.call("conversation.cancel", ["requestId": activeRun])
    }
    func readArtifact(_ id: String) async throws { artifact = try await gateway.call("artifacts.read", ["artifactId": id]) }
    func readDecision(_ id: Int) async throws {
        review = try await gateway.call("decision.review.read", ["decisionId": id])
        decisionId = String(id); finalDecision = ""; rationale = ""
    }
    func saveDraft() throws {
        guard review["canReview"] as? Bool == true else { throw ClientFailure(message: "Home has not granted review authority for this receipt.") }
        let binding = try JSONDecoder().decode(ReviewBinding.self, from: JSONSerialization.data(withJSONObject: review["binding"] ?? NSNull()))
        try outbox.save(binding: binding, outcome: outcome, finalDecision: finalDecision, rationale: rationale)
        finalDecision = ""; rationale = ""
    }
    func refreshNotifications() async throws {
        guard let projectId else { return }
        notifications = try await gateway.call("notifications.list", ["projectId": projectId, "limit": 50])["notifications"] as? [[String: Any]] ?? []
        for row in notifications {
            guard row["status"] as? String == "delivered", let id = row["id"] as? String,
                  row["readAt"] is NSNull, !deliveredNotifications.contains(id) else { continue }
            let content = UNMutableNotificationContent()
            content.title = "LiOS Home update"
            content.body = "Open LiOS to review canonical Home state."
            content.sound = .default
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
            deliveredNotifications.insert(id)
        }
        watch.publish(status: gateway.status, project: (continuity["project"] as? [String: Any])?["name"] as? String ?? "LiOS",
            notifications: notifications, homeId: continuity["homeId"] as? String ?? "")
    }
    func markRead(_ id: String) async throws {
        guard let projectId else { return }
        _ = try await gateway.call("notifications.read", ["projectId": projectId, "notificationId": id])
        try await refreshNotifications()
    }
    func foreground(_ active: Bool) {
        polling?.cancel(); polling = nil
        if !active { gateway.disconnect(); watch.publish(status: "Phone inactive — reconnect on phone", project: "LiOS", notifications: [], homeId: ""); return }
        polling = Task {
            while !Task.isCancelled {
                if gateway.connected { await perform { try await self.refreshNotifications() } }
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }
    static func pretty(_ object: Any) -> String {
        guard JSONSerialization.isValidJSONObject(object), let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]), let text = String(data: data, encoding: .utf8) else { return String(describing: object) }
        return text
    }
}
