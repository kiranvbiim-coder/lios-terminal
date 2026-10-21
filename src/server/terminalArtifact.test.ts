import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initialTerminalScreenState } from "@shared/terminalArtifact";
import { applyTerminalArtifactOperations, parseTerminalArtifactInstruction } from "@shared/terminalArtifactOperations";
import { normalizeConversationDraft } from "./artifactDiff";
import { savedMessageArtifactRefs } from "@shared/conversationArtifactRefs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-terminal-artifacts-"));
process.env.LIOS_DATA_ROOT = dataDir; process.env.LIMURIA_DATA_DIR = dataDir; delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projects } = await import("@shared/schema");
const { createProjectChat, listProjectChatMessages } = await import("./projectChatStore");
const { openTerminalArtifact } = await import("./terminalArtifact");
const { updateTerminalArtifact, admitTerminalExecutionSources } = await import("./terminalArtifactTool");
const { getArtifact, getArtifactVersion, createArtifactVersion, createArtifactProposal, createArtifact, createTerminalArtifactEngineVersion, undoArtifactHead } = await import("./artifactStore");

test("existing terminal work is a Chat-owned immutable Artifact, not a shadow session", { timeout: 90_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  await initDb();
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Terminal owner", role: "internal_analyst" as const, organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Other terminal owner", role: "internal_analyst" as const, organizationId: null },
  ]).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const foreign = { userId: stranger.id, organizationId: null, role: stranger.role };
  const chat = await createProjectChat(tenant, { scope: "quick" });
  const otherChat = await createProjectChat(tenant, { scope: "quick" });
  const before = await getDb().select({ id: projects.id }).from(projects);
  const request = { requestId: crypto.randomUUID(), view: "chart", title: "Chart · IBM", symbol: "IBM", state: initialTerminalScreenState("IBM"), message: "show chart for IBM" };
  const retained = await openTerminalArtifact(tenant, chat.id, request);
  assert.equal(retained.artifact.kind, "screen");
  assert.equal(retained.artifact.projectId, null); assert.equal(retained.artifact.owningChatId, chat.id);
  assert.deepEqual(await getDb().select({ id: projects.id }).from(projects), before);
  const messages = await listProjectChatMessages(tenant, chat.id);
  assert.equal(messages[0].content, request.message);
  assert.equal(savedMessageArtifactRefs(messages[1].metadata)[0].id, retained.artifact.id);
  const replay = await openTerminalArtifact(tenant, chat.id, request);
  assert.equal(replay.artifact.id, retained.artifact.id);
  assert.equal((await listProjectChatMessages(tenant, chat.id)).length, 2);
  await Promise.all(Array.from({ length: 4 }, () => openTerminalArtifact(tenant, chat.id, request)));
  assert.equal((await listProjectChatMessages(tenant, chat.id)).length, 2, "concurrent retention retries append only one atomic message pair");
  const update = { artifactId: retained.artifact.id, baseVersion: 1, baseHash: retained.version.contentHash, operations: [{ type: "chart.settings", settings: { chartType: "CANDLE", range: "3M", oscillator: "RSI", overlays: ["SMA20"] } }] };
  const result = await updateTerminalArtifact(tenant, chat.id, update, new AbortController().signal);
  assert.equal(result.artifactId, retained.artifact.id); assert.equal(result.version, 2);
  const current = await getArtifactVersion(tenant, retained.artifact.id, 2);
  assert.equal(current.content.kind, "screen");
  if (current.content.kind !== "screen") throw new Error("Expected terminal screen");
  const panel = (current.content.state.terminal as { panelState: Record<string, unknown> }).panelState;
  assert.equal(panel["chart.chartType"], "CANDLE"); assert.equal(panel["chart.range"], "3M"); assert.equal(panel["chart.oscillator"], "RSI");
  assert.deepEqual(panel["chart.overlays"], { $terminalSet: ["SMA20"] });
  assert.deepEqual((await getArtifactVersion(tenant, retained.artifact.id, 1)).content, retained.version.content);
  await assert.rejects(updateTerminalArtifact(tenant, chat.id, update, new AbortController().signal), /changed/);
  await assert.rejects(updateTerminalArtifact(tenant, chat.id, { ...update, baseVersion: 2 }, new AbortController().signal), /hash/);
  await assert.rejects(updateTerminalArtifact(tenant, otherChat.id, { ...update, baseVersion: 2, baseHash: current.contentHash }, new AbortController().signal), /owned/);
  await assert.rejects(getArtifact(foreign, retained.artifact.id));
  await assert.rejects(createArtifactProposal(tenant, { artifactId: retained.artifact.id, baseVersion: 2, type: "artifact_patch", summary: "Attempt to bypass typed source control", patch: { state: { terminal: { ...initialTerminalScreenState("IBM"), sourceScope: "web" } } }, actorType: "conversation" }), /typed operations/);
  await assert.rejects(createArtifactVersion(tenant, { artifactId: retained.artifact.id, baseVersion: 2, content: { ...current.content, symbol: "AAPL" } }), /subject|invalid/i);
  const forged = { ...current.content, state: { ...current.content.state, terminalExecutions: { forged: { receipt: { runId: crypto.randomUUID() }, price: 999 } } } };
  await assert.rejects(createArtifactVersion(tenant, { artifactId: retained.artifact.id, baseVersion: 2, content: forged }), /native results are immutable/);
  await assert.rejects(createArtifact(tenant, { projectId: null, owningChatId: chat.id, title: "Forged engine output", content: forged }), /owned native engine run/);
  await assert.rejects(createTerminalArtifactEngineVersion(tenant, { artifactId: retained.artifact.id, baseVersion: 2, baseHash: current.contentHash, slot: "forged", authoredState: initialTerminalScreenState("IBM") }, { result: { price: 999 }, receipt: {} } as never), /actual native execution/);
  const plain = await createArtifact(tenant, { projectId: null, owningChatId: chat.id, title: "Plain screen transition", content: { kind: "screen", view: "chart", symbol: "IBM", state: {} } });
  await assert.rejects(createArtifactProposal(tenant, { artifactId: plain.artifact.id, baseVersion: 1, type: "artifact_patch", summary: "Forge terminal results through plain screen", patch: { state: forged.state } }), /cannot mint terminal execution state/);
  const { resolveAdvancedQuantInputProvenance } = await import("@shared/quantModelRegistry");
  const declared = resolveAdvancedQuantInputProvenance({ marketPrice: 123 }, { dataClassification: "cached", sourceBindings: [{ contractFamily: "fixed-income-credit", field: "marketPrice", connectorId: "private-import", provider: "private", priority: "manual_override", sourceReference: "user-supplied:missing", asOf: "2026-01-01T00:00:00.000Z", retrievedAt: "2026-01-01T00:00:00.000Z", freshness: "cached", snapshot: { id: crypto.randomUUID(), contentHash: "0".repeat(64) }, transformations: [] }] });
  assert.equal(declared.success, true);
  if (declared.success) await assert.rejects(admitTerminalExecutionSources(tenant, declared.data, { marketPrice: 123 }, undefined, true, undefined, "fixed-income/spread-analytics"), /snapshot is unavailable/);
  const [client] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "fixture-only", name: "Client chart owner", role: "client_user", organizationId: null }).returning();
  const clientTenant = { userId: client.id, organizationId: null, role: client.role };
  const clientChat = await createProjectChat(clientTenant, { scope: "quick" });
  const clientScreen = await openTerminalArtifact(clientTenant, clientChat.id, { ...request, requestId: crypto.randomUUID() });
  if (clientScreen.version.content.kind !== "screen") throw new Error("Expected the original client chart screen.");
  const clientContent = { ...clientScreen.version.content, state: { ...clientScreen.version.content.state, terminal: { ...initialTerminalScreenState("IBM"), stockTape: true } } } as typeof current.content;
  await createArtifactVersion(clientTenant, { artifactId: clientScreen.artifact.id, baseVersion: 1, content: clientContent });
  const restored = await undoArtifactHead(clientTenant, clientScreen.artifact.id);
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.content, clientScreen.version.content, "Restoring an owned chart is not internal numerical execution.");
  await closeDb(); await initDb();
  assert.deepEqual((await getArtifactVersion(tenant, retained.artifact.id, 2)).content, current.content);
});

test("typed terminal operations cannot fabricate snapshots, target other tools or accept injected fields", () => {
  const state = initialTerminalScreenState("IBM");
  assert.throws(() => applyTerminalArtifactOperations("quote", state, [{ type: "chart.settings", settings: { chartType: "CANDLE" } }]), /active chart/);
  assert.throws(() => applyTerminalArtifactOperations("chart", state, [{ type: "source.settings", marketMode: "snapshot", asOf: "2026-01-01T00:00:00Z" }]), /snapshot/);
  assert.throws(() => applyTerminalArtifactOperations("chart", state, [{ type: "chart.settings", settings: { chartType: "CANDLE", price: 123 } } as never]));
  assert.deepEqual(parseTerminalArtifactInstruction("set this chart to candlesticks"), [{ type: "chart.settings", settings: { chartType: "CANDLE" } }]);
  assert.equal(parseTerminalArtifactInstruction("set this chart to candlesticks and transfer money"), null);
  assert.equal(parseTerminalArtifactInstruction("calculate IBM value"), null);
  assert.throws(() => applyTerminalArtifactOperations("screener", state, [{ type: "screener.settings", settings: { minPe: "20", maxPe: "10" } }]), /minimum/);
});

test("calculated technical work reopens the original chart without relabeling recorded numbers as current observations", () => {
  const recorded = { symbol: "IBM", sourceScope: "web", quote: { price: 123.4567, currency: "USD" }, snapshot: { rsi: 63.333333 }, asOf: "2026-01-02", barsUsed: 120 };
  const content = normalizeConversationDraft({ schemaVersion: "1", artifactId: crypto.randomUUID(), artifactType: "analysis.technical", title: "Recorded technical analysis", projectId: null, sourceRefs: ["provider:test"], executionReceiptIds: [], data: recorded, persistence: "chat_candidate" });
  assert.equal(content.kind, "screen");
  if (content.kind !== "screen") throw new Error("Expected original terminal screen");
  assert.equal(content.view, "chart");
  assert.deepEqual(content.state.recordedAnalysis, recorded);
  const terminal = content.state.terminal as { marketMode: string; asOf: string | null; sourceScope: string };
  assert.equal(terminal.marketMode, "live");
  assert.equal(terminal.asOf, null, "a recorded result is not automatically an authorized historical market snapshot");
  assert.equal(terminal.sourceScope, "web");
});
