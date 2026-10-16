import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderEntitlementDecision, StreamingLifecycle } from "@shared/universalDataFabric";
import { guardProviderStreamEntitlement } from "./providerStreamEntitlement";

const allowed = (policyId = "policy:v1", uses = ["internal_research"]): ProviderEntitlementDecision => ({
  decision: "allowed",
  policyId,
  permittedUses: uses,
  reasons: [],
});
const fixture = (stopImpl: () => Promise<void> = async () => {}) => {
  const lifecycle = {
    state: "streaming",
    reason: null,
  } as StreamingLifecycle;
  let stops = 0;
  const source = {
    lifecycle,
    async stop() {
      stops += 1;
      await stopImpl();
    },
  };
  return { source, lifecycle, get stops() { return stops; } };
};

test("SI-06.31 an active stream closes on revoked entitlement without logging provider details", async () => {
  const f = fixture();
  let decision: ProviderEntitlementDecision = allowed();
  const managed = guardProviderStreamEntitlement(f.source, async () => decision, allowed());
  assert.equal(await managed.recheckEntitlement(), true);
  assert.equal(f.stops, 0);
  decision = { decision: "denied", policyId: "policy:v1", permittedUses: [], reasons: ["secret=PRIVATE_CREDENTIAL"] };
  assert.equal(await managed.recheckEntitlement(), false);
  assert.equal(f.stops, 1);
  assert.equal(f.lifecycle.state, "stopped");
  assert.match(f.lifecycle.reason ?? "", /entitlement/);
  assert.doesNotMatch(f.lifecycle.reason ?? "", /PRIVATE_CREDENTIAL|secret=/);
  assert.equal(await managed.recheckEntitlement(), false);
  await managed.stop();
  assert.equal(f.stops, 1, "the underlying stream must stop once");
});

test("SI-06.31 missing, changed, unknown or throwing grant shuts down a stream", async () => {
  for (const mode of ["unknown", "wrong-uses", "new-policy", "error"] as const) {
    const f = fixture();
    const grant = async (): Promise<ProviderEntitlementDecision> => {
      if (mode === "error") throw new Error("token=DO_NOT_EXPOSE");
      if (mode === "unknown") return { decision: "unknown", policyId: null, permittedUses: [], reasons: [] };
      if (mode === "wrong-uses") return allowed("policy:v1", ["redistribution"]);
      return allowed("policy:v2");
    };
    const subscription = guardProviderStreamEntitlement(f.source, grant, allowed());
    assert.equal(await subscription.recheckEntitlement(), false, mode);
    assert.equal(f.stops, 1, mode);
    assert.equal(f.lifecycle.state, "stopped");
    assert.doesNotMatch(f.lifecycle.reason ?? "", /DO_NOT_EXPOSE|token=/);
  }
});

test("SI-06.31 recheck calls are deduplicated and manual stop wins an in-flight rights check", async () => {
  const f = fixture();
  let resolve!: (decision: ProviderEntitlementDecision) => void;
  let checks = 0;
  const guard = guardProviderStreamEntitlement(f.source, () => {
    checks += 1;
    return new Promise<ProviderEntitlementDecision>((res) => { resolve = res; });
  }, allowed());
  const first = guard.recheckEntitlement();
  const second = guard.recheckEntitlement();
  assert.equal(checks, 1);
  await guard.stop();
  resolve(allowed());
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(f.stops, 1);
  assert.equal(f.lifecycle.state, "stopped");
  assert.equal(await guard.recheckEntitlement(), false);
});

test("SI-06.31 failed underlying stop is degraded, never misrepresented as safely stopped", async () => {
  const f = fixture(async () => { throw new Error("secret=PRIVATE_STREAM_STOP_FAILURE"); });
  const guard = guardProviderStreamEntitlement(f.source, async () => ({
    decision: "denied", policyId: null, permittedUses: [], reasons: [],
  }), allowed());
  await assert.rejects(guard.recheckEntitlement(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /could not be confirmed/);
    assert.doesNotMatch(error.message, /PRIVATE_STREAM_STOP_FAILURE|secret=/);
    return true;
  });
  assert.equal(f.lifecycle.state, "degraded");
  assert.match(f.lifecycle.reason ?? "", /manual recovery/);
  assert.equal(f.stops, 1);
  await assert.rejects(guard.stop(), /could not be confirmed/);
  assert.equal(f.stops, 1);
});

test("SI-06.31 timer rechecks entitlement while the stream remains active", async () => {
  const f = fixture();
  let revoke = false;
  let checks = 0;
  const subscription = guardProviderStreamEntitlement(f.source, async () => {
    checks += 1;
    return revoke
      ? { decision: "denied", policyId: "policy:v1", permittedUses: [], reasons: [] }
      : allowed();
  }, allowed(), 1_000);
  try {
    revoke = true;
    const cutoff = Date.now() + 3_500;
    while (!f.stops && Date.now() < cutoff) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(f.stops, 1, "timer must enforce eventual revocation without a caller poll");
    assert.ok(checks >= 1);
    assert.equal(f.lifecycle.state, "stopped");
  } finally {
    await subscription.stop();
  }
});

test("SI-06.31 refuses invalid or too-frequent recheck intervals", () => {
  for (const ms of [0, 1, 999, -1, 1.5, Number.NaN, Infinity]) {
    const f = fixture();
    assert.throws(() => guardProviderStreamEntitlement(f.source, async () => allowed(), allowed(), ms), RangeError);
  }
});
