/**
 * H0 journey harness: runs full conversations through the real Conversation Runtime with fixture
 * tools and checks what the user would receive — artifacts, receipts, trust record, honest gaps —
 * plus wall-clock time. Complements the routing set; live-provider timing is measured separately.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { executeConversationRuntime } from "../server/conversationRuntime";
import { installJourneyFixtures, type FixtureCalls } from "./journeyFixtures";

export interface JourneyExpect {
  artifactTypes?: string[];
  textIncludes?: string[];
  textExcludes?: string[];
  minReceipts?: number;
  trustManifest?: boolean;
  toolStarts?: string[];
  forbidToolStarts?: string[];
  noErrorEvent?: boolean;
  doneStatus?: string;
  dataGap?: boolean;
  /** Every step announced in the plan must have a result by the end of a completed run. */
  allPlanStepsSettled?: boolean;
}
export interface JourneyCase { id: string; prompt: string; aiText?: string; expect: JourneyExpect; maxMs: number; status: "must_pass" | "known_gap"; gapReason?: string }
export interface JourneyResult { id: string; prompt: string; status: JourneyCase["status"]; passed: boolean; failures: string[]; ms: number; firstEventMs: number | null }

export function loadJourneyCases(): JourneyCase[] {
  return (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "evals", "golden", "journeys.json"), "utf8")) as { cases: JourneyCase[] }).cases;
}

export async function runJourney(journey: JourneyCase): Promise<JourneyResult> {
  const calls: FixtureCalls = { started: [] };
  installJourneyFixtures(calls);
  const events: Array<{ type: string; stepId?: string; status?: string; plan?: { steps: Array<{ id: string; label: string }> } }> = [];
  const started = performance.now();
  let firstEventMs: number | null = null;
  const failures: string[] = [];
  let text = "";
  let artifactTypes: string[] = [];
  let receipts = 0;
  let trust = false;
  try {
    const result = await executeConversationRuntime({
      tenant: { userId: 1, organizationId: null, role: "internal_analyst" },
      scope: "project", chatId: 900, projectId: 900, projectName: "Eval", history: [],
      request: { requestId: crypto.randomUUID(), message: journey.prompt, executionMode: "deterministic_first", sourceScope: "auto" },
      emit: (event) => { if (firstEventMs === null) firstEventMs = performance.now() - started; events.push(event as never); },
      ...(journey.aiText ? { aiCompletion: async () => ({ provider: "openai" as const, model: "eval-model", text: journey.aiText, attribution: { provider: "openai", model: "eval-model", promptHash: "0".repeat(64), outputHash: "1".repeat(64), generatedAt: new Date().toISOString() } as never }) } : {}),
    } as never);
    text = result.text;
    artifactTypes = result.artifacts.map((artifact) => artifact.artifactType);
    receipts = result.receiptIds.length;
    trust = Boolean(result.trustManifest);
  } catch {
    // A governed gap or refusal throws after emitting events; the events below are the record.
  }
  const ms = performance.now() - started;
  const expect = journey.expect;
  const done = events.filter((event) => event.type === "done").at(-1);

  for (const type of expect.artifactTypes ?? []) if (!artifactTypes.includes(type)) failures.push(`missing artifact ${type} (got ${artifactTypes.join(", ") || "none"})`);
  if (expect.artifactTypes?.length === 0 && artifactTypes.length) failures.push(`unexpected artifacts ${artifactTypes.join(", ")}`);
  for (const pattern of expect.textIncludes ?? []) if (!new RegExp(pattern, "i").test(text)) failures.push(`text lacks /${pattern}/`);
  for (const pattern of expect.textExcludes ?? []) if (new RegExp(pattern, "i").test(text)) failures.push(`text contains forbidden /${pattern}/`);
  if (expect.minReceipts !== undefined && receipts < expect.minReceipts) failures.push(`receipts ${receipts} < ${expect.minReceipts}`);
  if (expect.trustManifest && !trust && !events.some((event) => event.type === "trust")) failures.push("no trust manifest");
  for (const tool of expect.toolStarts ?? []) if (!calls.started.includes(tool)) failures.push(`tool ${tool} never ran`);
  for (const tool of expect.forbidToolStarts ?? []) if (calls.started.includes(tool)) failures.push(`tool ${tool} ran but must not`);
  if (expect.noErrorEvent && events.some((event) => event.type === "error")) failures.push("runtime emitted an error event");
  if (expect.doneStatus && done?.status !== expect.doneStatus) failures.push(`done status ${done?.status ?? "none"}, expected ${expect.doneStatus}`);
  if (expect.allPlanStepsSettled) {
    const planned = events.filter((event) => event.type === "plan").at(-1)?.plan?.steps ?? [];
    const settled = new Set(events.filter((event) => event.type === "tool_result" || event.type === "status").map((event) => event.stepId));
    for (const step of planned) if (!settled.has(step.id)) failures.push(`plan step "${step.id}" never settled`);
  }
  if (expect.dataGap && !events.some((event) => event.type === "data_gap")) failures.push("no governed data_gap event");
  if (ms > journey.maxMs) failures.push(`took ${Math.round(ms)} ms, budget ${journey.maxMs} ms`);
  for (const step of events.filter((event) => event.type === "tool_start")) if (/\[|\]/.test(String(step.stepId))) failures.push("template text in step id");

  return { id: journey.id, prompt: journey.prompt, status: journey.status, passed: failures.length === 0, failures, ms: Math.round(ms), firstEventMs: firstEventMs === null ? null : Math.round(firstEventMs) };
}
