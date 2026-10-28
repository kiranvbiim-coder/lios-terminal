import Foundation
import SwiftUI
import UserNotifications

@MainActor final class HomeModel: ObservableObject {
    let gateway = HomeGateway()
    let outbox = ReviewOutbox()
    let watch = PhoneWatchBridge()
    let notificationOutbox = NotificationReadOutbox()
    @Published var homeAddress = ""
    @Published var fingerprint = ""
    @Published var pairingToken = ""
    @Published var error: String?
    @Published var projects: [[String: Any]] = []
    @Published var continuity: [String: Any] = [:]
    @Published var notifications: [[String: Any]] = []
    @Published var review: [String: Any] = [:]
    @Published var artifact: [String: Any] = [:]
    @Published var artifactVersions: [[String: Any]] = []
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
    private var run = RunCursor()
    private var artifactsOffset = 0
    private var nextArtifactsOffset: Int?
    private var versionsOffset = 0
    private var nextVersionsOffset: Int?
    private var selectedArtifact: String?
    private var configuredHome: HomeConfiguration?
    private var replayingReads = false
    private var observationOwner: (homeId: String, userId: Int)?
    private var persistedRunSequence = -1

    init() {
        do {
            try outbox.load()
            try notificationOutbox.load()
            if let data = try DeviceKeychain.load("home") {
                let home = try JSONDecoder().decode(HomeConfiguration.self, from: data)
                homeAddress = home.address; fingerprint = home.fingerprint
                configuredHome = home
                if let saved = try DeviceKeychain.load("run-observation") {
                    guard saved.count <= 16_384 else { throw ClientFailure(message: "Saved run observation exceeds its bound.") }
                    let observation = try JSONDecoder().decode(RunObservation.self, from: saved)
                    try observation.validate()
                    if observation.home == home && observation.deviceId == (try DeviceIdentity.loadOrCreate().id) {
                        run = observation.cursor; projectId = observation.projectId; chatId = observation.chatId
                        observationOwner = (observation.homeId, observation.userId)
                    }
                }
            }
        } catch { self.error = error.localizedDescription }
        gateway.onEvent = { [weak self] event, payload in
            guard let self else { return }
            if event == "home.connected" {
                Task {
                    await self.perform { try await self.refreshProjects(); try await self.reattachRun(); try await self.replayNotificationReads() }
                }
            } else if event == "conversation.event" {
                guard self.run.receive(payload) else { return }
                self.runEvents.append(payload)
                if self.run.requestId == nil || self.run.sequence - self.persistedRunSequence >= 16 {
                    do { try self.persistRunObservation() } catch { self.error = error.localizedDescription }
                }
                if self.runEvents.count > 100 { self.runEvents.removeFirst() }
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
        if configuredHome != home {
            run.clear(); projectId = nil; chatId = nil; continuity = [:]; notifications = []; review = [:]; artifact = [:]; artifactVersions = []; runEvents = []
            observationOwner = nil
            try DeviceKeychain.remove("run-observation")
        }
        configuredHome = home
        try gateway.connect(home: home, pairingToken: pairingToken)
        pairingToken = ""
    }
    func refreshProjects() async throws {
        projects = try await gateway.call("projects.list")["projects"] as? [[String: Any]] ?? []
        if let projectId {
            guard projects.contains(where: { $0["id"] as? Int == projectId }) else { self.projectId = nil; chatId = nil; continuity = [:]; notifications = []; review = [:]; return }
            try await refreshContinuity()
            try await refreshNotifications()
        }
    }
    func selectProject(_ id: Int) async throws {
        if run.requestId != nil {
            guard projectId == id else { throw ClientFailure(message: "Inspect or stop the attached run before changing its Project.") }
            return
        }
        projectId = id; chatId = nil; pageOffset = 0; artifactsOffset = 0
        continuity = [:]; notifications = []; artifact = [:]; artifactVersions = []; review = [:]
        try await refreshContinuity()
        try await refreshNotifications()
        try await replayNotificationReads()
    }
    func refreshContinuity() async throws {
        guard let projectId else { return }
        var params: [String: Any] = ["projectId": projectId, "offset": pageOffset, "limit": 50, "artifactsOffset": artifactsOffset, "artifactsLimit": 100]
        if let chatId { params["chatId"] = chatId }
        continuity = try await gateway.call("device.continuity.read", params)
        nextOffset = continuity["nextOffset"] as? Int
        nextArtifactsOffset = continuity["nextArtifactsOffset"] as? Int
    }
    func selectChat(_ id: Int) async throws {
        guard run.requestId == nil || chatId == id else { throw ClientFailure(message: "Inspect or stop the attached run before changing its Chat.") }
        chatId = id; pageOffset = 0; try await refreshContinuity()
        if let homeId = continuity["homeId"] as? String, let userId = continuity["userId"] as? Int {
            observationOwner = (homeId, userId); try persistRunObservation()
        }
    }
    private func persistRunObservation() throws {
        guard let home = configuredHome, let projectId, let chatId, let owner = observationOwner else { return }
        let state = RunObservation(home: home, deviceId: try DeviceIdentity.loadOrCreate().id,
            homeId: owner.homeId, userId: owner.userId, projectId: projectId, chatId: chatId, cursor: run)
        try state.validate()
        let data = try JSONEncoder().encode(state)
        guard data.count <= 16_384 else { throw ClientFailure(message: "Saved run observation exceeds its bound.") }
        try DeviceKeychain.save(data, account: "run-observation")
        persistedRunSequence = run.sequence
    }
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
        guard gateway.connected else { throw ClientFailure(message: "Home offline; messages are never queued.") }
        let requestId = UUID().uuidString.lowercased()
        guard run.requestId == nil else { throw ClientFailure(message: "A run is still attached or unconfirmed. Reconnect to inspect it before sending another message.") }
        run.begin(requestId); runEvents = []
        guard let homeId = continuity["homeId"] as? String, let userId = continuity["userId"] as? Int else {
            run.clear(); throw ClientFailure(message: "Read canonical Home and account identity before sending.")
        }
        observationOwner = (homeId, userId)
        do { try persistRunObservation() } catch { run.clear(); throw error }
        // Keep this ID on ambiguous failure: reconnect subscribes; it never resends start.
        do {
            _ = try await gateway.call("conversation.start", ["chatId": chatId, "body": ["requestId": requestId, "message": message]])
        } catch let error as ClientFailure {
            if let code = error.code, code != "UNAVAILABLE", run.requestId == requestId { run.clear(); try persistRunObservation() }
            throw error
        }
        message = ""
        try await refreshContinuity()
    }
    func cancelRun() async throws {
        guard let activeRun = run.requestId else { return }
        _ = try await gateway.call("conversation.cancel", ["requestId": activeRun])
    }
    func reattachRun() async throws {
        guard let id = run.requestId else { return }
        guard let owner = observationOwner, continuity["homeId"] as? String == owner.homeId,
              continuity["userId"] as? Int == owner.userId else {
            throw ClientFailure(message: "Saved run observation belongs to a different Home or account. Nothing was reattached.")
        }
        do {
            let result = try await gateway.call("conversation.subscribe", ["requestId": id, "afterSeq": run.sequence])
            run.subscribed(id, status: result["status"] as? String ?? "")
            try persistRunObservation()
        } catch let error as ClientFailure {
            if error.code == "NOT_FOUND" { run.clear(); try persistRunObservation() }
            throw error
        }
    }
    func nextArtifacts() async throws { guard let nextArtifactsOffset else { return }; artifactsOffset = nextArtifactsOffset; try await refreshContinuity() }
    func firstArtifacts() async throws { artifactsOffset = 0; try await refreshContinuity() }
    func readArtifact(_ id: String, version: Int? = nil) async throws {
        var params: [String: Any] = ["artifactId": id]
        if let version { params["version"] = version }
        artifact = try await gateway.call("artifacts.read", params)
        if selectedArtifact != id { selectedArtifact = id; versionsOffset = 0 }
        try await refreshArtifactVersions()
    }
    func refreshArtifactVersions() async throws {
        guard let selectedArtifact else { return }
        let result = try await gateway.call("artifacts.versions.list", ["artifactId": selectedArtifact, "offset": versionsOffset, "limit": 50])
        artifactVersions = result["versions"] as? [[String: Any]] ?? []
        nextVersionsOffset = result["nextOffset"] as? Int
    }
    func inspectVersion(_ version: Int) async throws { guard let selectedArtifact else { return }; try await readArtifact(selectedArtifact, version: version) }
    func nextVersions() async throws { guard let nextVersionsOffset else { return }; versionsOffset = nextVersionsOffset; try await refreshArtifactVersions() }
    func firstVersions() async throws { versionsOffset = 0; try await refreshArtifactVersions() }
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
        guard let projectId, let homeId = continuity["homeId"] as? String, let userId = continuity["userId"] as? Int else { throw ClientFailure(message: "Read canonical Home identity before retaining a notification intent.") }
        let intent = NotificationReadIntent(homeId: homeId, userId: userId, deviceId: try DeviceIdentity.loadOrCreate().id, projectId: projectId, notificationId: id)
        try notificationOutbox.enqueue(intent)
        if gateway.connected { try await replayNotificationReads(); try await refreshNotifications() }
    }
    func replayNotificationReads() async throws {
        guard !replayingReads, let homeId = continuity["homeId"] as? String, let userId = continuity["userId"] as? Int else { return }
        replayingReads = true
        defer { replayingReads = false }
        let deviceId = try DeviceIdentity.loadOrCreate().id
        for intent in notificationOutbox.items where intent.homeId == homeId && intent.userId == userId && intent.deviceId == deviceId {
            _ = try await gateway.call("notifications.read.replay", intent.params)
            try notificationOutbox.remove(intent)
        }
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
