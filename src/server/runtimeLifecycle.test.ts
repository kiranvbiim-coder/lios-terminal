import assert from "node:assert/strict";
import test from "node:test";
import { applyRuntimeLifecycle, previewRuntimeLifecycle, RuntimeLifecycleRefusal, type RuntimeLifecycleDependencies } from "./runtimeLifecycle";

const actor = { id: 1, role: "internal_admin", organizationId: null };
const input = { operation: "install" as const, releasePackIds: ["core" as const], additionalPackIds: [] };
function fixture() {
  let now = 1_800_000_000_000;
  let current = { ...actor, active: true, mustChangePassword: false, lockedUntil: null as Date | null };
  let custody = { sourceStateHash: "1".repeat(64), targetManifestHash: "2".repeat(64), custodyHash: "3".repeat(64), rollbackAvailable: false, supportedPlatform: true, releaseLocks: [{ packId: "core", sha256: "4".repeat(64) as string | null }] };
  let consent = true;
  const forbiddenMutation = async (): Promise<never> => { throw new Error("Denied lifecycle operation reached a mutation authority"); };
  const dependencies: RuntimeLifecycleDependencies = { readActor: async id => ({ ...current, id }), readState: () => null, inspectCustody: () => custody, pythonAvailable: () => false, unconsentedPacks: async () => consent ? [] : ["core"], now: () => now, strictProvisioningAuthority: { provisionManagedRuntime: forbiddenMutation }, install: forbiddenMutation, repair: forbiddenMutation, lazyInstall: forbiddenMutation, upgrade: forbiddenMutation, rollback: forbiddenMutation };
  return { dependencies, revoke: () => { current = { ...current, active: false }; }, drift: () => { custody = { ...custody, custodyHash: "5".repeat(64) }; }, missingLock: () => { custody.releaseLocks[0].sha256 = null; }, revokeConsent: () => { consent = false; }, expire: () => { now += 300_001; } };
}
const refuses = (code: string) => (error: unknown) => error instanceof RuntimeLifecycleRefusal && error.code === code;

test("confirmed lifecycle requests remain bound to current actor, custody, consent, operation and expiring server confirmation", async t => {
  for (const scenario of ["revoked", "custody", "consent", "expired", "other-actor", "operation", "forged-token", "unconfirmed"] as const) await t.test(scenario, async () => {
    const f = fixture();
    const preview = await previewRuntimeLifecycle(actor, input, f.dependencies);
    assert.deepEqual(preview.blockers, []);
    let principal = actor;
    let approval = { ...preview, confirmed: true };
    let expected = "preview_stale";
    if (scenario === "revoked") { f.revoke(); expected = "current_administrator_required"; }
    if (scenario === "custody") f.drift();
    if (scenario === "consent") f.revokeConsent();
    if (scenario === "expired") { f.expire(); expected = "preview_expired"; }
    if (scenario === "other-actor") principal = { ...actor, id: 2 };
    if (scenario === "operation") approval = { ...approval, request: { operation: "repair" } };
    if (scenario === "forged-token") approval.confirmationToken = "0".repeat(64);
    if (scenario === "unconfirmed") { approval.confirmed = false; expected = "confirmation_required"; }
    await assert.rejects(applyRuntimeLifecycle(principal, approval, f.dependencies), refuses(expected));
  });
});
test("missing governed runner, unverified release locks and unsupported rollback never invoke mutation", async t => {
  for (const scenario of ["runner", "lock", "rollback"] as const) await t.test(scenario, async () => {
    const f = fixture();
    if (scenario === "runner") delete f.dependencies.strictProvisioningAuthority;
    if (scenario === "lock") f.missingLock();
    const preview = await previewRuntimeLifecycle(actor, scenario === "rollback" ? { operation: "rollback" } : input, f.dependencies);
    assert.equal(preview.blockers.some(blocker => blocker.startsWith(scenario === "runner" ? "strict_provisioning_authority_missing" : scenario === "lock" ? "unverified_release_hashes" : "rollback_snapshot_unavailable")), true);
    await assert.rejects(applyRuntimeLifecycle(actor, { ...preview, confirmed: true }, f.dependencies), refuses("prerequisites_blocked"));
  });
});
