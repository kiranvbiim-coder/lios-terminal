import XCTest
import CryptoKit
@testable import LiOS

final class DeviceProtocolTests: XCTestCase {
    func testLiOSProofUsesCanonicalEd25519Payload() throws {
        let key = Curve25519.Signing.PrivateKey()
        let identity = DeviceIdentity(key: key)
        let proof = try identity.proof(nonce: "owner-issued-challenge", token: "pairing-token", signedAt: 1234)
        XCTAssertEqual(identity.id.count, 32)
        XCTAssertEqual((proof["publicKey"] as? String)?.count, 43)
        let raw = try XCTUnwrap(proof["signature"] as? String)
        let padded = raw.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=="
        let signature = try XCTUnwrap(Data(base64Encoded: padded))
        let payload = "lios-device-v1|\(identity.id)|lios-ios|ui|read,write|1234|owner-issued-challenge|pairing-token"
        XCTAssertTrue(key.publicKey.isValidSignature(signature, for: Data(payload.utf8)))
        XCTAssertFalse(key.publicKey.isValidSignature(signature, for: Data((payload + "tamper").utf8)))
    }
    func testHomeRequiresPinnedTLSAndExactDeviceEndpoint() throws {
        let pin = String(repeating: "ab", count: 32)
        XCTAssertNoThrow(try HomeConfiguration.validated(address: "wss://home.example:5053/gateway/device", fingerprint: pin))
        for address in ["ws://home.example/gateway/device", "wss://home.example/gateway", "wss://owner:secret@home.example/gateway/device", "wss://home.example/gateway/device?token=secret"] {
            XCTAssertThrowsError(try HomeConfiguration.validated(address: address, fingerprint: pin))
        }
        XCTAssertThrowsError(try HomeConfiguration.validated(address: "wss://home.example/gateway/device", fingerprint: ""))
    }
    func testDraftRejectsCredentialsAndEmptyReview() {
        XCTAssertFalse(ReviewSubmission.validText("api_key=secret", max: 5000))
        XCTAssertFalse(ReviewSubmission.validText("Bearer token", max: 5000))
        XCTAssertFalse(ReviewSubmission.validText("   ", max: 5000))
        XCTAssertTrue(ReviewSubmission.validText("Reject because the current filing invalidates the thesis.", max: 5000))
    }
    func testAuthorityChangesCannotRebindDraft() {
        func binding(policy: String) -> ReviewBinding {
            ReviewBinding(homeId: "11111111-1111-4111-8111-111111111111", userId: 1,
                deviceId: String(repeating: "a", count: 32), decisionId: 2, receiptVersionId: 3,
                snapshotHash: String(repeating: "b", count: 64), decisionHead: String(repeating: "c", count: 64),
                policyDigest: policy, issuedAt: "2026-10-13T00:00:00Z", expiresAt: "2026-10-14T00:00:00Z")
        }
        XCTAssertTrue(binding(policy: "one").sameAuthority(binding(policy: "one")))
        XCTAssertFalse(binding(policy: "one").sameAuthority(binding(policy: "two")))
    }
    func testRunCursorAcceptsEarlyEventsAndIgnoresOtherRunsAndDuplicates() {
        var cursor = RunCursor()
        cursor.begin("one")
        XCTAssertTrue(cursor.receive(["requestId": "one", "runSeq": 0, "event": ["type": "delta"]]))
        XCTAssertFalse(cursor.receive(["requestId": "other", "runSeq": 99, "event": ["type": "done"]]))
        XCTAssertFalse(cursor.receive(["requestId": "one", "runSeq": 0]))
        XCTAssertEqual(cursor.sequence, 0)
        cursor.subscribed("other", status: "finished")
        XCTAssertEqual(cursor.requestId, "one")
        XCTAssertTrue(cursor.receive(["requestId": "one", "runSeq": 1, "event": ["type": "done"]]))
        XCTAssertNil(cursor.requestId)
        cursor.begin("two")
        XCTAssertEqual(cursor.sequence, -1)
        cursor.subscribed("two", status: "finished")
        XCTAssertNil(cursor.requestId)
    }
    func testWaitingApprovalKeepsRunIdentityForExplicitHomeReview() {
        var cursor = RunCursor()
        cursor.begin("waiting")
        XCTAssertTrue(cursor.receive(["requestId": "waiting", "runSeq": 4, "event": ["type": "done", "status": "waiting_approval"]]))
        XCTAssertEqual(cursor.requestId, "waiting")
        XCTAssertEqual(cursor.sequence, 4)
        cursor.subscribed("waiting", status: "running")
        XCTAssertEqual(cursor.requestId, "waiting")
    }
}
