import Foundation
import Combine

// Wire mirror of src/shared/deviceOutbox.ts; no execution payloads or credentials.
struct ReviewBinding: Codable, Equatable {
    let homeId: String
    let userId: Int
    let deviceId: String?
    let decisionId: Int
    let receiptVersionId: Int
    let snapshotHash: String
    let decisionHead: String
    let policyDigest: String
    let issuedAt: String
    let expiresAt: String
    func sameAuthority(_ other: ReviewBinding) -> Bool {
        return homeId == other.homeId && userId == other.userId && deviceId == other.deviceId &&
            decisionId == other.decisionId && receiptVersionId == other.receiptVersionId &&
            snapshotHash == other.snapshotHash && decisionHead == other.decisionHead && policyDigest == other.policyDigest
    }
    func sameIdentityPolicyReceipt(_ other: ReviewBinding) -> Bool {
        return homeId == other.homeId && userId == other.userId && deviceId == other.deviceId &&
            decisionId == other.decisionId && receiptVersionId == other.receiptVersionId &&
            snapshotHash == other.snapshotHash && policyDigest == other.policyDigest
    }
    var expired: Bool {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt) else { return true }
        return date <= Date()
    }
}
struct ReviewSubmission: Codable {
    let requestId: String
    let binding: ReviewBinding
    let outcome: String
    let finalDecision: String
    let rationale: String
    static func validText(_ value: String, max: Int) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= max else { return false }
        let pattern = #"(?i)(?:\b(?:api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|password|secret|private[_\s-]?key)\b\s*[:=]\s*\S+|\bbearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)"#
        return value.range(of: pattern, options: .regularExpression) == nil
    }
}
struct ReviewDraft: Codable, Identifiable {
    var id: String { submission.requestId }
    let schemaVersion: Int
    let kind: String
    let submission: ReviewSubmission
    let createdAt: String
    var status: String
    var error: String?
    var approvalId: Int?
}
@MainActor final class ReviewOutbox: ObservableObject {
    @Published private(set) var items: [ReviewDraft] = []
    let file: URL
    private var releasing = Set<String>()
    init() {
        file = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LiOS/review-outbox.json")
    }
    func load() throws {
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        let data = try Data(contentsOf: file)
        guard data.count <= 1_000_000 else { throw ClientFailure(message: "Outbox exceeds its storage bound.") }
        var loaded = try JSONDecoder().decode([ReviewDraft].self, from: data)
        guard loaded.count <= 50, loaded.allSatisfy({ $0.schemaVersion == 1 && $0.kind == "decision_review" && ["approved", "rejected"].contains($0.submission.outcome) && UUID(uuidString: $0.id) != nil && ReviewSubmission.validText($0.submission.finalDecision, max: 5000) && ReviewSubmission.validText($0.submission.rationale, max: 10000) }) else {
            throw ClientFailure(message: "Outbox schema rejected; drafts were not released.")
        }
        for i in loaded.indices where loaded[i].status == "sending" {
            loaded[i].status = "unconfirmed"; loaded[i].error = "Interrupted submission. Reread Home before explicit retry."
        }
        try persist(loaded)
    }
    private func persist(_ replacement: [ReviewDraft]) throws {
        let bytes = try JSONEncoder().encode(replacement)
        guard replacement.count <= 50, bytes.count <= 1_000_000 else { throw ClientFailure(message: "Outbox full; remove a completed draft first.") }
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try bytes.write(to: file, options: [.atomic, .completeFileProtection])
        items = replacement
    }
    func save(binding: ReviewBinding, outcome: String, finalDecision: String, rationale: String) throws {
        guard !binding.expired, ["approved", "rejected"].contains(outcome),
              ReviewSubmission.validText(finalDecision, max: 5000), ReviewSubmission.validText(rationale, max: 10000) else {
            throw ClientFailure(message: "Draft expired, contains credentials or has invalid review text.")
        }
        let submission = ReviewSubmission(requestId: UUID().uuidString.lowercased(), binding: binding, outcome: outcome,
            finalDecision: finalDecision.trimmingCharacters(in: .whitespacesAndNewlines), rationale: rationale.trimmingCharacters(in: .whitespacesAndNewlines))
        let draft = ReviewDraft(schemaVersion: 1, kind: "decision_review", submission: submission,
            createdAt: ISO8601DateFormatter().string(from: Date()), status: "pending", error: nil, approvalId: nil)
        try persist(items + [draft])
    }
    func remove(_ id: String) throws {
        guard !releasing.contains(id) else { throw ClientFailure(message: "Cannot remove a draft during its release attempt.") }
        try persist(items.filter { $0.id != id })
    }
    func release(_ id: String, gateway: HomeGateway) async throws {
        guard releasing.insert(id).inserted else { throw ClientFailure(message: "This draft already has a release attempt in progress.") }
        defer { releasing.remove(id) }
        guard let draft = items.first(where: { $0.id == id }), ["pending", "unconfirmed"].contains(draft.status) else {
            throw ClientFailure(message: "Draft is not releasable.")
        }
        guard !draft.submission.binding.expired else { try update(id, status: "refused", error: "Expired; create a fresh review."); return }
        let read = try await gateway.call("decision.review.read", ["decisionId": draft.submission.binding.decisionId])
        let current = try JSONDecoder().decode(ReviewBinding.self, from: JSONSerialization.data(withJSONObject: read["binding"] ?? NSNull()))
        let approval = read["approval"] as? [String: Any] ?? [:]
        let decision = read["decision"] as? [String: Any] ?? [:]
        let exactPriorSubmission = draft.status == "unconfirmed" &&
            (approval["reviewRequestId"] as? String) == id &&
            (approval["receiptVersionId"] as? Int) == draft.submission.binding.receiptVersionId &&
            (approval["snapshotHash"] as? String) == draft.submission.binding.snapshotHash &&
            (approval["outcome"] as? String) == draft.submission.outcome &&
            (decision["finalDecision"] as? String) == draft.submission.finalDecision &&
            (decision["decisionRationale"] as? String) == draft.submission.rationale &&
            draft.submission.binding.sameIdentityPolicyReceipt(current)
        let freshReview = draft.submission.binding.sameAuthority(current) && (read["canReview"] as? Bool) == true
        guard freshReview || exactPriorSubmission else {
            try update(id, status: "refused", error: "Home identity, receipt, decision head, authority or policy changed. Create a fresh draft."); return
        }
        try update(id, status: "sending", error: nil)
        do {
            let params = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.submission)) as! [String: Any]
            let result = try await gateway.call("decision.review.submit", params)
            guard result["requestId"] as? String == id, let approvalId = result["approvalId"] as? Int else {
                throw ClientFailure(message: "Home receipt did not confirm this request.")
            }
            try update(id, status: "submitted", error: nil, approvalId: approvalId)
        } catch {
            try update(id, status: "unconfirmed", error: "Submission unconfirmed. Explicit retry uses the same request ID; never assumes success.")
            throw error
        }
    }
    private func update(_ id: String, status: String, error: String?, approvalId: Int? = nil) throws {
        var replacement = items
        guard let index = replacement.firstIndex(where: { $0.id == id }) else { return }
        replacement[index].status = status; replacement[index].error = error; replacement[index].approvalId = approvalId
        try persist(replacement)
    }
}
