import assert from "node:assert/strict";
import test from "node:test";
import { conversationRequestSchema, workingContextSnapshotSchema } from "./conversationRuntime";
import type { WorkingContextSnapshot } from "./conversationRuntime";
import {
  deriveWorkingContext,
  extractExplicitSymbol,
  isReferentialFollowUp,
  resolveWorkingContextRequest,
  restoreWorkingContext,
  WORKING_CONTEXT_MAX_BYTES,
} from "./workingContext";
import type { DeriveWorkingContextInput } from "./workingContext";

const ARTIFACT_ID = "5f0f7a4e-6b1c-4d6e-9a32-0d4b7c1e9f10";
const RECEIPT_ID = "0b6c9d3e-1f2a-4b5c-8d7e-9f0a1b2c3d4e";
const REQUEST_ID = "d14d7195-2bac-4005-9c30-8350365c52c9";
const OWNER = { scope: "project", projectId: 7, chatId: 42 } as const;

function request(message: string, context?: Record<string, unknown>) {
  return conversationRequestSchema.parse({ requestId: REQUEST_ID, message, ...(context ? { context } : {}) });
}

const plan: DeriveWorkingContextInput["plan"] = {
  intent: { action: "research", confidence: 0.9, entityRefs: [], parameters: {}, requiresAI: false, requiresDeterministicCompute: false },
  capabilities: [],
};
const emptyResult = { receiptIds: [] };

function snapshot(overrides: Partial<WorkingContextSnapshot> = {}): WorkingContextSnapshot {
  return workingContextSnapshotSchema.parse({
    version: 1, scope: "project", projectId: 7, chatId: 42, turn: 1, updatedAt: "2026-10-03T10:00:00.000Z",
    entities: [{ symbol: "NVDA", source: "message" }], activeArtifact: null, selectedElement: null, objective: "Value NVDA",
    sourcePosture: "auto", assumptionRefs: [], asOf: null, capabilityIds: [], aiPosture: { executionMode: "deterministic_first", providerId: null },
    receiptRefs: [], workspaceSessionRef: null, confidence: 0.95, ...overrides,
  });
}

function derive(message: string, overrides: Partial<DeriveWorkingContextInput> = {}, context?: Record<string, unknown>, carried: WorkingContextSnapshot | null = null) {
  const resolution = resolveWorkingContextRequest(request(message, context), carried);
  return deriveWorkingContext({ previous: carried, owner: OWNER, resolution, plan, result: emptyResult, providerId: null, now: new Date("2026-10-03T11:00:00Z"), ...overrides });
}

test("explicit symbols are accepted only in high-precision forms, never from bare words or acronyms", () => {
  const cases: Array<[string, string | null]> = [
    ["analyse $msft now", "MSFT"],
    ["use ticker aapl for this", "AAPL"],
    ["what moved 5009.HK today", "5009.HK"],
    ["analyse MSFT margins", "MSFT"],
    ["analyse apple margins", null],
    ["analyse GDP trends", null],
    ["what does the FED mean for rates", null],
    ["what is a ticker symbol", null],
    ["make WACC more conservative", null],
    ["ROI and EBITDA explained", null],
  ];
  for (const [message, expected] of cases) assert.equal(extractExplicitSymbol(message), expected, message);
});

test("follow-ups that refer back are detected, unrelated and conceptual questions are not", () => {
  for (const message of [
    "compare this", "make it more conservative", "why did this number change?", "what about its margins?",
    "re-run the same valuation", "update that analysis", "what changed", "and the P/E ratio?",
  ]) assert.equal(isReferentialFollowUp(message), true, message);
  for (const message of [
    "what is a DCF?", "explain how WACC works", "what is the weather in Pune", "analyse $MSFT", "tell me about inflation",
    "change the language to Hindi", "summarise my project files",
  ]) assert.equal(isReferentialFollowUp(message), false, message);
});

test("entity precedence: explicit ticker, then selection, then carried (follow-ups only), then the ambient workbench symbol", () => {
  const carried = snapshot();
  const ambient = { symbol: "AAPL" };

  const explicit = resolveWorkingContextRequest(request("analyse $MSFT", { ...ambient, selection: { kind: "security", symbol: "TSLA" } }), carried);
  assert.deepEqual(explicit.entity, { symbol: "MSFT", source: "message" });
  assert.equal(explicit.request.context?.symbol, "MSFT", "the ambient symbol no longer overrides an explicit ticker");

  const selected = resolveWorkingContextRequest(request("compare this", { ...ambient, selection: { kind: "security", symbol: "TSLA" } }), carried);
  assert.deepEqual(selected.entity, { symbol: "TSLA", source: "selection" });

  const carriedWins = resolveWorkingContextRequest(request("compare this", ambient), carried);
  assert.deepEqual(carriedWins.entity, { symbol: "NVDA", source: "carried" });
  assert.equal(carriedWins.request.context?.symbol, "NVDA");

  const notFollowUp = request("what is a DCF?", ambient);
  const ambientOnly = resolveWorkingContextRequest(notFollowUp, carried);
  assert.deepEqual(ambientOnly.entity, { symbol: "AAPL", source: "workspace" });
  assert.equal(ambientOnly.request, notFollowUp, "nothing to change, so the request is returned untouched");

  const nothing = resolveWorkingContextRequest(request("what is a DCF?"), carried);
  assert.equal(nothing.entity, null, "a carried entity is never applied to a question that does not refer back");
});

test("the carried Artifact is applied only to a follow-up that has no active Artifact of its own", () => {
  const carried = snapshot({ activeArtifact: `artifact:${ARTIFACT_ID}` });
  const applied = resolveWorkingContextRequest(request("make this more conservative"), carried);
  assert.deepEqual(applied.request.context?.activeObjectRefs, [`artifact:${ARTIFACT_ID}`]);

  const other = "artifact:11111111-1111-4111-8111-111111111111";
  const own = resolveWorkingContextRequest(request("make this more conservative", { activeObjectRefs: [other] }), carried);
  assert.deepEqual(own.request.context?.activeObjectRefs, [other]);

  const unrelated = resolveWorkingContextRequest(request("what is a DCF?"), carried);
  assert.equal(unrelated.request.context?.activeObjectRefs, undefined);
});

test("restore is bounded and fails closed on anything unexpected", () => {
  const good = snapshot();
  assert.deepEqual(restoreWorkingContext(JSON.parse(JSON.stringify(good)), OWNER), good);

  const rejected: Array<[string, unknown]> = [
    ["null", null], ["string", "AAPL"], ["number", 5], ["array", []],
    ["unknown version", { ...good, version: 2 }],
    ["unknown key", { ...good, extra: true }],
    ["bad symbol", { ...good, entities: [{ symbol: "not a ticker", source: "message" }] }],
    ["credential-shaped objective", { ...good, objective: "use api_key=abcdef1234567890abcdef" }],
    ["other chat", { ...good, chatId: 43 }],
    ["other project", { ...good, projectId: 8 }],
    ["temporary snapshot in a saved chat", { ...good, scope: "temporary", projectId: null, chatId: null }],
    ["oversize", { ...good, padding: "x".repeat(WORKING_CONTEXT_MAX_BYTES) }],
  ];
  for (const [label, value] of rejected) assert.equal(restoreWorkingContext(value, OWNER), null, label);

  const quick = snapshot({ scope: "quick", projectId: null });
  assert.deepEqual(restoreWorkingContext(quick, OWNER), { ...quick, scope: "project", projectId: OWNER.projectId }, "only the same Quick chat moved into this Project keeps its context");
  const quickOwner = { scope: "quick", projectId: null, chatId: OWNER.chatId } as const;
  assert.equal(restoreWorkingContext(good, quickOwner), null, "Project context cannot leak into a Quick chat");
  assert.equal(restoreWorkingContext({ ...good, scope: "quick" }, OWNER), null, "Quick metadata with a Project id is inconsistent");
  assert.equal(restoreWorkingContext({ ...good, projectId: null }, OWNER), null, "Project metadata must name its owner");
});

test("a Temporary chat only accepts a Temporary snapshot and never carries an Artifact", () => {
  const temporary = { scope: "temporary", projectId: null, chatId: null } as const;
  const forged = snapshot({ scope: "temporary", projectId: null, chatId: null, activeArtifact: `artifact:${ARTIFACT_ID}` });
  assert.equal(restoreWorkingContext(forged, temporary), null, "an Artifact in client-carried Temporary metadata is unsafe, not merely stripped");
  assert.equal(restoreWorkingContext(snapshot(), temporary), null, "a saved chat's snapshot must not leak into a Temporary chat");
});

test("derive builds a valid turn-local subject snapshot and honours its limits", () => {
  const first = derive("analyse $MSFT", {}, { sessionId: "ws-1" });
  assert.ok(first);
  assert.equal(first.turn, 1);
  assert.deepEqual(first.entities, [{ symbol: "MSFT", source: "message" }]);
  assert.equal(first.confidence, 0.95);
  assert.equal(first.workspaceSessionRef, "ws-1");
  assert.equal(first.objective, "analyse $MSFT");
  assert.equal(first.asOf, null);
  assert.equal(first.updatedAt, "2026-10-03T11:00:00.000Z");

  const second = derive("analyse $TSLA", {}, undefined, first);
  assert.deepEqual(second?.entities, [{ symbol: "TSLA", source: "message" }], "prior unrelated tickers are not the current subject set");
  assert.equal(second?.turn, 2);
  assert.equal(second?.workspaceSessionRef, "ws-1", "an unchanged workspace session is remembered");

  const followUp = derive("make this more conservative", {}, undefined, second);
  assert.equal(followUp?.objective, "analyse $TSLA", "a follow-up refines the objective, it does not replace it");
  assert.equal(followUp?.entities[0]?.symbol, "TSLA");
  assert.equal(followUp?.entities[0]?.source, "carried");

  let crowded: WorkingContextSnapshot | null = null;
  for (const symbol of ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH", "II", "JJ"]) crowded = derive(`analyse $${symbol}`, {}, undefined, crowded);
  assert.equal(crowded?.entities.length, 1);
  assert.equal(crowded?.entities[0]?.symbol, "JJ");
});

test("derive keeps credentials out and never stores an Artifact for a Temporary chat", () => {
  const secret = derive("remember my password: hunter2hunter2 for $MSFT");
  assert.ok(secret);
  assert.equal(secret.objective, null);
  assert.equal(JSON.stringify(secret).includes("hunter2"), false);

  const saved = derive("build a DCF for $MSFT", { result: { receiptIds: [RECEIPT_ID, "not-a-uuid", RECEIPT_ID] } });
  assert.equal(saved?.activeArtifact, null, "draft UUIDs are not canonical Artifact identities");
  const focused = derive("build a DCF for $MSFT", {}, { activeObjectRefs: [`artifact:${ARTIFACT_ID}`] });
  assert.equal(focused?.activeArtifact, `artifact:${ARTIFACT_ID}`, "an active ref is a hint, still checked by the server's Artifact store");
  assert.deepEqual(saved?.receiptRefs, [RECEIPT_ID]);

  const temporary = derive("build a DCF for $MSFT", { owner: { scope: "temporary", projectId: null, chatId: null } }, { activeObjectRefs: [`artifact:${ARTIFACT_ID}`] });
  assert.equal(temporary?.activeArtifact, null);
  assert.equal(temporary?.chatId, null);
});

test("material ambiguity asks only for a genuinely ambiguous follow-up; a single explicit ticker resolves it", () => {
  const multiple = derive("Compare $MSFT and $NVDA");
  assert.ok(multiple);
  assert.deepEqual(multiple.entities.map((entity) => entity.symbol), ["MSFT", "NVDA"]);
  const ambiguous = resolveWorkingContextRequest(request("Why did this number change?", { symbol: "AAPL" }), multiple);
  assert.deepEqual(ambiguous.clarification?.symbols, ["MSFT", "NVDA"]);
  assert.equal(ambiguous.entity, null);
  assert.equal(ambiguous.request.context?.symbol, undefined, "no guessed or ambient entity is left for calculation");
  assert.equal(deriveWorkingContext({ previous: multiple, owner: OWNER, resolution: ambiguous, plan, result: emptyResult, providerId: null }), null);

  const resolved = resolveWorkingContextRequest(request("Explain this number for $NVDA", { symbol: "AAPL", selection: { kind: "security", symbol: "MSFT" } }), multiple);
  assert.equal(resolved.clarification, null);
  assert.equal(resolved.entity?.symbol, "NVDA");
  assert.deepEqual(derive("Explain this number for $NVDA", {}, undefined, multiple)?.entities, [{ symbol: "NVDA", source: "message" }]);
  assert.equal(resolveWorkingContextRequest(request("What is a DCF?"), multiple).clarification, null);
  assert.equal(resolveWorkingContextRequest(request("Compare this", { selection: { kind: "security", symbol: "NVDA" } }), multiple).clarification, null);
});

test("conflicting deliberate selection referents ask, but a different ambient symbol never does", () => {
  const selected = { symbol: "AAPL", selection: { kind: "security", symbol: "MSFT", text: "Forecast for $NVDA" } };
  const conflict = resolveWorkingContextRequest(request("Update this forecast", selected), snapshot());
  assert.deepEqual(conflict.clarification?.symbols, ["MSFT", "NVDA"]);
  assert.equal(resolveWorkingContextRequest(request("Update this forecast for $TSLA", selected), snapshot()).entity?.symbol, "TSLA");
  const carried = resolveWorkingContextRequest(request("Update this forecast", { symbol: "AAPL", activeObjectRefs: ["security:AAPL"] }), snapshot());
  assert.equal(carried.clarification, null);
  assert.equal(carried.entity?.symbol, "NVDA");
});

test("legacy accumulated tickers are history, not material ambiguity", () => {
  const legacy = snapshot({ objective: "Analyse $MSFT", entities: [{ symbol: "MSFT", source: "message" }, { symbol: "NVDA", source: "carried" }] });
  const followUp = derive("Compare this", {}, undefined, legacy);
  assert.deepEqual(followUp?.entities, [{ symbol: "MSFT", source: "carried" }]);
  const legacyFollowUp = { ...legacy, entities: legacy.entities.map((entity) => ({ ...entity, source: "carried" as const })) };
  assert.equal(resolveWorkingContextRequest(request("Compare this"), legacyFollowUp).clarification, null);
  assert.equal(resolveWorkingContextRequest(request("Compare this"), legacyFollowUp).entity?.symbol, "MSFT");
  assert.equal(resolveWorkingContextRequest(request("Compare this"), { ...legacyFollowUp, objective: null }).clarification, null, "legacy accumulated carried history without an objective is not a current entity set");
  const legacyComparison = { ...legacy, objective: "Compare $MSFT and $NVDA" };
  assert.deepEqual(resolveWorkingContextRequest(request("Compare this"), legacyComparison).clarification?.symbols, ["MSFT", "NVDA"], "the existing objective can establish a real comparison set");
  assert.equal(resolveWorkingContextRequest(request("Compare this"), derive("What is a DCF?", {}, undefined, legacy)).entity, null);
});

test("the snapshot byte cap counts UTF-8, accepts its exact boundary, and rejects the next byte", () => {
  const boundary = snapshot({ assumptionRefs: Array.from({ length: 24 }, () => "") });
  const bytes = () => new TextEncoder().encode(JSON.stringify(boundary)).byteLength;
  for (let index = 0; index < boundary.assumptionRefs.length; index += 1) {
    while (boundary.assumptionRefs[index]!.length < 160 && bytes() + 3 <= WORKING_CONTEXT_MAX_BYTES) boundary.assumptionRefs[index] += "界";
    while (boundary.assumptionRefs[index]!.length < 160 && bytes() < WORKING_CONTEXT_MAX_BYTES) boundary.assumptionRefs[index] += "x";
  }
  assert.equal(bytes(), WORKING_CONTEXT_MAX_BYTES);
  assert.ok(JSON.stringify(boundary).length < WORKING_CONTEXT_MAX_BYTES);
  assert.deepEqual(restoreWorkingContext(boundary, OWNER), boundary);
  const oversized = { ...boundary, objective: `${boundary.objective}x` };
  assert.equal(new TextEncoder().encode(JSON.stringify(oversized)).byteLength, WORKING_CONTEXT_MAX_BYTES + 1);
  assert.equal(restoreWorkingContext(oversized, OWNER), null);
});

test("reserved metadata is not fabricated from unproduced request references", () => {
  const carried = snapshot({ assumptionRefs: ["assumption:unverified"], asOf: { posture: "latest", date: null } });
  const result = derive("Analyse $MSFT", {}, { activeObjectRefs: ["assumption:client-assertion"] }, carried);
  assert.deepEqual(result?.assumptionRefs, []);
  assert.equal(result?.asOf, null);
});

test("an analysis verb plus a bare pronoun is a follow-up, so the pronoun is never mistaken for a ticker", () => {
  for (const message of ["Analyse this", "Review it", "Value that", "Chart them", "Backtest this"]) {
    assert.equal(isReferentialFollowUp(message), true, message);
  }
  const carried = snapshot();
  const resolution = resolveWorkingContextRequest(conversationRequestSchema.parse({ requestId: "7f1e9a3c-6b52-4e3a-9d4c-2a1b8c0d5e6f", message: "Analyse this" }), carried);
  assert.equal(resolution.referential, true);
  assert.equal(resolution.entity?.source, "carried");
  assert.equal(isReferentialFollowUp("Analyse the quarterly report structure"), false);
});
