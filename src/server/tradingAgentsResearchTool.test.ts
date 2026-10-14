import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-ta-debate-review-"));
process.env.LIMURIA_DATA_DIR = dataDir;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { GovernedToolRegistry } = await import("./governedTools");
const { getConversationTool } = await import("./conversationRuntime");
const {
  tradingAgentsResearchTool,
  tradingAgentsResearchToolInputSchema,
} = await import("./tradingAgentsResearchTool");

test("TradingAgents donor research gate respects exact Project owner and source truth", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [user] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test",
    name: "TradingAgents research owner",
    role: "internal_analyst",
  }).returning();
  const tenant = { userId: user.id, organizationId: null, role: user.role };
  const project = await createProject(tenant, { name: "Research challenge" });
  const reg = new GovernedToolRegistry();
  reg.register(tradingAgentsResearchTool);
  const input = {
    decisionText: "Rating: Buy",
    turns: [
      { speaker: "bull", argument: "Potential growth, unverified." },
      { speaker: "bear", argument: "Valuation risk, unverified." },
    ],
    maxRounds: 1,
  };
  const call = {
    source: "agent" as const,
    tenant, userId: user.id, projectId: project.id,
    requestId: crypto.randomUUID(), sourceScope: "my_data" as const,
    resourceTransmissionAllowed: true,
  };
  const sig = new AbortController().signal;
  const a = await reg.invoke(tradingAgentsResearchTool.id, input, sig, call);
  const b = await reg.invoke(tradingAgentsResearchTool.id, input, sig, call);
  assert.deepEqual(a, b);
  const output = a.output as {
    interpretation: { rating: string; executable: boolean; outputTruth: string };
    debate: { next: string; complete: boolean };
    brokerageExecution: boolean;
    evidenceStatus: string;
    source: { importedRuntime: boolean; repository: string };
  };
  assert.equal(output.interpretation.rating, "Buy");
  assert.equal((a.output as { interpretation: { requiresHumanReview: boolean } }).interpretation.requiresHumanReview, true);
  assert.match(a.summary, /REQUIRES human review/);
  assert.equal(output.interpretation.outputTruth, "unverified_model_output");
  assert.equal(output.interpretation.executable, false);
  assert.equal(output.debate.next, "human_review");
  assert.equal(output.debate.complete, true);
  const risk = (a.output as {riskDebate: {next:string;complete:boolean;executable:boolean}}).riskDebate;
  assert.equal(risk.next, "aggressive");
  assert.equal(risk.complete, false);
  assert.equal(risk.executable, false);
  assert.equal(output.evidenceStatus, "not_source_verified");
  assert.equal(output.brokerageExecution, false);
  assert.equal(output.source.importedRuntime, false);
  assert.deepEqual(a.sourceRefs, []);
  assert.equal(tradingAgentsResearchTool.sideEffect, "none");
  assert.equal(tradingAgentsResearchTool.access, "read");
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, userId: user.id + 100,
  }), /Project owner context/);
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, projectId: project.id + 9999,
  }));
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, tenant: { ...tenant, organizationId: 997 },
  }), "Changing organization without changing owner must not reveal a private Project");
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, sourceScope: "web" as const,
  }), /permitted Project research scope/);
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, source: "workflow" as const,
  }), /governed agent request/);
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, sig, {
    ...call, resourceTransmissionAllowed: false,
  }), /permitted Project research scope/);
  const canceled = new AbortController();
  canceled.abort();
  await assert.rejects(reg.invoke(tradingAgentsResearchTool.id, input, canceled.signal, call));
});

test("forged evidence or unbounded debate input is rejected", () => {
  const base = {
    decisionText: "Rating: Hold",
    turns: [{ speaker: "bull", argument: "No observed source supplied." }],
    maxRounds: 1,
  };
  for (const item of [
    { ...base, sourceRefs: ["made-up:broker"] },
    { ...base, permissionGranted: true },
    { ...base, maxRounds: 0 },
    { ...base, maxRounds: 4 },
    { ...base, turns: [{ speaker: "bull", argument: "" }] },
    { ...base, turns: Array(7).fill({ speaker: "bull", argument: "claim" }) },
  ]) {
    assert.equal(tradingAgentsResearchToolInputSchema.safeParse(item).success, false);
  }
});

test("canonical conversation catalogue discovers the read-only TradingAgents research reviewer", () => {
  const registered = getConversationTool("lios.research.tradingagents_debate_review");
  assert.ok(registered, "TradingAgents reviewer must be registered with the canonical runtime");
  // The canonical registry snapshots/freeze-copies descriptors by design.
  // It must preserve the registered schema and invoke callback, not the object identity.
  assert.equal(registered.id, tradingAgentsResearchTool.id);
  assert.strictEqual(registered.inputSchema, tradingAgentsResearchTool.inputSchema);
  assert.strictEqual(registered.invoke, tradingAgentsResearchTool.invoke);
  assert.equal(registered.permissionClass, "safe_auto");
  assert.equal(registered.kind, "calculate");
  assert.equal(registered.access, "read");
  assert.equal(registered.sideEffect, "none");
  assert.equal(registered.replaySafe, true);
});

test("registered TradingAgents risk input parser refuses fabricated evidence and wrong role values", () => {
  const base = {decisionText:"Rating: REVIEW",turns:[],maxRounds:1,
    riskTurns:[{speaker:"aggressive",argument:"unverified risk"}],riskMaxRounds:1};
  for (const input of [
    {...base,riskMaxRounds:4},
    {...base,riskTurns:[{speaker:"trader",argument:"execute now"}]},
    {...base,riskTurns:[{speaker:"aggressive",argument:"  "}]},
    {...base,riskTurns:Array(10).fill({speaker:"aggressive",argument:"x"})},
    {...base,sourceEvidenceRefs:["fake:source"]},
  ]) assert.equal(tradingAgentsResearchToolInputSchema.safeParse(input).success, false);
});
