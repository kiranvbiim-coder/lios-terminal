import assert from "node:assert/strict";
import test from "node:test";
import {
  PROVIDER_OPERATOR_USER,
  PROVIDER_OPERATOR_VENDOR,
  homeProfileProviderIds,
} from "@shared/runtimeProviderContracts";
import {
  EgressBlockedError,
  createGuardedFetch,
  parseEgressPolicy,
} from "./egressPolicy";
import {
  createHomeRuntimeSnapshot,
  homeProviderDescriptors,
} from "./runtimeProviders";

test("SI-01.15 Desktop Local remains user-operated with outbound egress disabled", () => {
  const snapshot = createHomeRuntimeSnapshot({ LIOS_EGRESS_MODE: "offline" });

  assert.equal(snapshot.mode, "desktop_local");
  assert.deepEqual(snapshot.egress, { mode: "offline", ruleCount: 0 });
  assert.equal(snapshot.conformance.conformant, true, JSON.stringify(snapshot.conformance.issues));

  assert.equal(snapshot.profile.database, "lios.database.pglite");
  assert.equal(snapshot.profile.storage, "lios.storage.local-fs");
  assert.equal(snapshot.profile.execution, "lios.execution.local");
  assert.equal(snapshot.profile.identity, "lios.identity.local-session");
  assert.equal(snapshot.profile.license, "lios.license.signed-offline-lease");
  assert.equal(snapshot.profile.network, "lios.network.loopback");
  assert.ok(snapshot.profile.backup.includes("lios.backup.portable-archive"));

  const byId = new Map(homeProviderDescriptors().map((descriptor) => [descriptor.id, descriptor]));
  for (const { providerId } of homeProfileProviderIds(snapshot.profile)) {
    const descriptor = byId.get(providerId);
    assert.ok(descriptor, `missing provider descriptor for ${providerId}`);
    assert.ok(descriptor.capabilities.includes(PROVIDER_OPERATOR_USER), `${providerId} is not user-operated`);
    assert.equal(
      descriptor.capabilities.includes(PROVIDER_OPERATOR_VENDOR),
      false,
      `${providerId} introduces a vendor-operated runtime dependency`,
    );
  }
});

test("SI-01.15 offline egress blocks remote provider calls before transport while keeping loopback available", async () => {
  const policy = parseEgressPolicy({ LIOS_EGRESS_MODE: "offline" });
  const calls: string[] = [];
  const native = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  const guarded = createGuardedFetch(native, policy);

  await assert.rejects(
    () => guarded("https://provider.example.invalid/data"),
    (error: unknown) => {
      assert.ok(error instanceof EgressBlockedError);
      assert.equal(error.reason, "offline");
      return true;
    },
  );
  assert.deepEqual(calls, [], "remote transport must not be called in offline mode");

  const response = await guarded("http://127.0.0.1:32123/health");
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "http://127.0.0.1:32123/health");
});
