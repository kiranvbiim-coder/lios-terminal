import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-qlib-challenger-"));
process.env.LIMURIA_DATA_DIR = root;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { qlibRiskChallengerTool, qlibRiskChallengerInputSchema } = await import("./qlibRiskChallengerTool");
const { GovernedToolRegistry } = await import("./governedTools");

test("governed manual Qlib risk challenger enforces exact Project ownership and false-source boundaries", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test", name: "Risk challenger owner", role: "internal_analyst",
  }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Qlib analysis" });
  const registry = new GovernedToolRegistry();
  registry.register(qlibRiskChallengerTool);
  const input = { returns: [0.1, -0.1, 0.1, -0.1], annualizationSessions: 238, mode: "product" };
  const call = {
    source: "agent" as const,
    tenant, userId: owner.id, projectId: project.id, requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const, resourceTransmissionAllowed: true,
  };
  const signal = new AbortController().signal;
  const result = await registry.invoke(qlibRiskChallengerTool.id, input, signal, call);
  const result2 = await registry.invoke(qlibRiskChallengerTool.id, input, signal, call);
  assert.deepEqual(result, result2, "fixed manual input must reproduce the same numeric output and hashes");
  const output = result.output as {
    validation: string; inputSha256: string; outputSha256: string;
    numerical: { annualizationSessions: number; informationRatio: number | null; inputTruth: string; maxDrawdown: number };
    upstream: { installedRuntime: boolean; repository: string };
    observedMarketData: boolean; brokerageExecution: boolean;
  };
  assert.equal(qlibRiskChallengerTool.access, "read");
  assert.equal(qlibRiskChallengerTool.sideEffect, "none");
  assert.equal(qlibRiskChallengerTool.replaySafe, true);
  assert.equal(output.validation, "experimental_challenger");
  assert.equal(output.numerical.inputTruth, "unknown");
  assert.equal(output.numerical.annualizationSessions, 238);
  assert.ok(output.numerical.maxDrawdown < 0);
  assert.match(output.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(output.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(output.upstream.repository, "microsoft/qlib");
  assert.equal(output.upstream.installedRuntime, false);
  assert.equal(output.observedMarketData, false);
  assert.equal(output.brokerageExecution, false);
  assert.equal(result.deterministic, true);
  assert.deepEqual(result.sourceRefs, [], "manual series must not be disguised as provider sources");

  await assert.rejects(registry.invoke(qlibRiskChallengerTool.id, input, signal, {
    ...call, userId: owner.id + 100,
  }), /owner and Project context/);
  await assert.rejects(registry.invoke(qlibRiskChallengerTool.id, input, signal, {
    ...call, resourceTransmissionAllowed: false,
  }), /transmission is disabled/);
  await assert.rejects(registry.invoke(qlibRiskChallengerTool.id, input, signal, {
    ...call, source: "workflow" as const,
  }), /governed agent request/);
  await assert.rejects(registry.invoke(qlibRiskChallengerTool.id, input, signal, {
    ...call, projectId: project.id + 99999,
  }));
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(registry.invoke(qlibRiskChallengerTool.id, input, aborted.signal, call));
});

test("invalid model inputs cannot enter the adapted risk computation", () => {
  for (const input of [
    { returns: [0.1], annualizationSessions: 252, mode: "sum" },
    { returns: [0.1, -1], annualizationSessions: 252, mode: "sum" },
    { returns: [0.1, 0.2], annualizationSessions: 0, mode: "sum" },
    { returns: [0.1, 0.2], annualizationSessions: 252, mode: "unknown" },
    { returns: [0.1, 0.2], annualizationSessions: 252, mode: "sum", fakeSourceRef: "provider:claimed" },
  ]) {
    assert.equal(qlibRiskChallengerInputSchema.safeParse(input).success, false);
  }
});
