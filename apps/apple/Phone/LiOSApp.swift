import SwiftUI
import UserNotifications

@main struct LiOSApp: App {
    @StateObject private var model = HomeModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            HomeView(model: model, gateway: model.gateway, outbox: model.outbox)
                .onChange(of: scenePhase) { _, phase in model.foreground(phase == .active) }
                .task { model.foreground(true) }
        }
    }
}
struct HomeView: View {
    @ObservedObject var model: HomeModel
    @ObservedObject var gateway: HomeGateway
    @ObservedObject var outbox: ReviewOutbox
    @State private var releaseId: String?
    var body: some View {
        NavigationStack {
            List {
                Section("Your Home") {
                    Text(gateway.status).accessibilityIdentifier("home-status")
                    TextField("wss://home:port/gateway/device", text: $model.homeAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Owner-shown certificate SHA-256", text: $model.fingerprint).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("One-time pairing token (first connection)", text: $model.pairingToken)
                    Button("Connect / Request owner pairing") { do { try model.connect() } catch { model.error = error.localizedDescription } }
                    Button("Disconnect") { gateway.disconnect() }
                    Button("Enable local notifications") {
                        Task { await model.perform { _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) } }
                    }
                    Text("Only the user-owned Home authorizes pairing and actions. Background/disconnected updates are not live; open and reconnect on the phone.").font(.caption)
                }
                if let error = model.error { Section("Action not completed") { Text(error).foregroundStyle(.red) } }
                Section("Projects") {
                    Button("Refresh Projects") { Task { await model.perform { try await model.refreshProjects() } } }.disabled(!gateway.connected)
                    ForEach(Array(model.projects.enumerated()), id: \.offset) { _, row in
                        if let id = row["id"] as? Int {
                            Button(row["name"] as? String ?? "Project \(id)") { Task { await model.perform { try await model.selectProject(id) } } }
                        }
                    }
                }
                if model.projectId != nil {
                    Section("Chats") {
                        Button("Create Chat") { Task { await model.perform { try await model.createChat() } } }.disabled(!gateway.connected)
                        ForEach(Array((model.continuity["chats"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, row in
                            if let id = row["id"] as? Int {
                                Button(row["title"] as? String ?? "Chat \(id)") { Task { await model.perform { try await model.selectChat(id) } } }
                            }
                        }
                    }
                    Section("Canonical Chat messages") {
                        ForEach(Array((model.continuity["messages"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, row in
                            VStack(alignment: .leading) {
                                Text(row["role"] as? String ?? "Message").font(.caption)
                                Text(row["content"] as? String ?? HomeModel.pretty(row)).textSelection(.enabled)
                            }
                        }
                        Button("First page") { Task { await model.perform { try await model.firstMessages() } } }
                        Button("Next page") { Task { await model.perform { try await model.nextMessages() } } }
                        TextField("Ask LiOS", text: $model.message, axis: .vertical)
                        Button("Send to selected Chat") { Task { await model.perform { try await model.send() } } }.disabled(!gateway.connected || model.chatId == nil)
                        Button("Cancel current run") { Task { await model.perform { try await model.cancelRun() } } }.disabled(!gateway.connected)
                        if !model.runEvents.isEmpty {
                            NavigationLink("Current run / trust / approval status") { RecordView(title: "Home run events", record: model.runEvents) }
                        }
                    }
                    Section("Artifacts — canonical revision heads") {
                        ForEach(Array((model.continuity["artifacts"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, row in
                            if let id = row["id"] as? String {
                                Button(row["title"] as? String ?? id) { Task { await model.perform { try await model.readArtifact(id) } } }
                            }
                        }
                        if !model.artifact.isEmpty { NavigationLink("Inspect Artifact / revision / sources") { RecordView(title: "Canonical Artifact", record: model.artifact) } }
                    }
                    Section("Home notifications") {
                        Button("Refresh notifications") { Task { await model.perform { try await model.refreshNotifications() } } }.disabled(!gateway.connected)
                        ForEach(Array(model.notifications.enumerated()), id: \.offset) { _, row in
                            VStack(alignment: .leading) {
                                Text(row["title"] as? String ?? "Home notification")
                                Text(row["body"] as? String ?? HomeModel.pretty(row)).font(.caption)
                                if let id = row["id"] as? String { Button("Mark read on Home") { Task { await model.perform { try await model.markRead(id) } } }.disabled(!gateway.connected) }
                            }
                        }
                    }
                }
                Section("Financial Decision review") {
                    TextField("Canonical Decision ID", text: $model.decisionId).keyboardType(.numberPad)
                    Button("Read current receipt and review authority") {
                        Task { await model.perform {
                            guard let id = Int(model.decisionId), id > 0 else { throw ClientFailure(message: "Enter a valid Decision ID.") }
                            try await model.readDecision(id)
                        } }
                    }.disabled(!gateway.connected)
                    if !model.review.isEmpty {
                        NavigationLink("Inspect Decision / receipt / binding") { RecordView(title: "Decision review", record: model.review) }
                        Picker("Outcome", selection: $model.outcome) { Text("Approve").tag("approved"); Text("Reject").tag("rejected") }
                        TextField("Final decision", text: $model.finalDecision, axis: .vertical)
                        TextField("Rationale", text: $model.rationale, axis: .vertical)
                        Button("Save review draft — does not authorize execution") {
                            do { try model.saveDraft() } catch { model.error = error.localizedDescription }
                        }
                    }
                }
                Section("Review outbox — explicit release only") {
                    ForEach(outbox.items) { draft in
                        VStack(alignment: .leading) {
                            Text("Decision \(draft.submission.binding.decisionId): \(draft.submission.outcome)")
                            Text("\(draft.status) · \(draft.submission.finalDecision)").font(.caption)
                            Text(draft.submission.rationale).font(.caption)
                            if let error = draft.error { Text(error).foregroundStyle(.red).font(.caption) }
                            if let id = draft.approvalId { Text("Home approval receipt \(id)") }
                            Button("Release after Home reread") { releaseId = draft.id }
                                .disabled(!gateway.connected || !["pending", "unconfirmed"].contains(draft.status))
                            Button("Remove draft", role: .destructive) { do { try outbox.remove(draft.id) } catch { model.error = error.localizedDescription } }
                                .disabled(draft.status == "sending")
                        }
                    }
                }
            }
            .navigationTitle("LiOS")
            .confirmationDialog("Submit this exact review draft to Home? Home rechecks identity, current receipt, policy and authority. This is not an execution approval.", isPresented: Binding(get: { releaseId != nil }, set: { if !$0 { releaseId = nil } })) {
                Button("Release exact review") {
                    guard let id = releaseId else { return }; releaseId = nil
                    Task { await model.perform { try await outbox.release(id, gateway: gateway) } }
                }
            }
            .alert("Watch requests Decision review", isPresented: Binding(get: { model.requestedWatchDecision != nil }, set: { if !$0 { model.requestedWatchDecision = nil } })) {
                Button("Read on phone") {
                    guard let id = model.requestedWatchDecision else { return }; model.requestedWatchDecision = nil
                    Task { await model.perform { try await model.readDecision(id) } }
                }
                Button("Cancel", role: .cancel) { model.requestedWatchDecision = nil }
            } message: { Text("The watch cannot approve or release a draft. Review the current canonical receipt on this phone.") }
        }
    }
}
struct RecordView: View {
    let title: String
    let record: Any
    var body: some View { ScrollView { Text(HomeModel.pretty(record)).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding() }.navigationTitle(title) }
}
