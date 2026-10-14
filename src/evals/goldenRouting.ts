/**
 * H0 golden routing harness.
 *
 * Plans each golden prompt with the real Conversation Runtime planner (no network, no database)
 * and compares the resolved capabilities, entity and readiness with the *intended* behaviour in
 * evals/golden/routing.json. Expectations describe what the product should do; a case that the
 * planner gets wrong is recorded as a known_gap, never quietly rewritten to match.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { conversationRequestSchema, type ConversationCapabilityMatch } from "../shared/conversationRuntime";
import { planConversationWorkflow } from "../server/conversationRuntime";

export interface GoldenExpect {
  includes?: string[];
  includesAny?: string[];
  only?: string[];
  forbids?: string[];
  entity?: string;
  entityPrefix?: string;
  noEntity?: boolean;
  availability?: Record<string, string>;
}

export interface GoldenCase {
  id: string;
  category: string;
  prompt: string;
  expect: GoldenExpect;
  status: "must_pass" | "known_gap";
  gapReason?: string;
}

export interface GoldenResult {
  id: string;
  category: string;
  prompt: string;
  status: GoldenCase["status"];
  passed: boolean;
  failures: string[];
  capabilities: string[];
  entities: string[];
  planMs: number;
}

const GOLDEN_PATH = path.resolve(process.cwd(), "evals", "golden", "routing.json");

export function loadGoldenCases(): GoldenCase[] {
  return (JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8")) as { cases: GoldenCase[] }).cases;
}

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function entitiesOf(capabilities: ConversationCapabilityMatch[]): string[] {
  const values = new Set<string>();
  for (const capability of capabilities) {
    if (capability.entityQuery) values.add(capability.entityQuery);
    if (capability.symbol) values.add(capability.symbol);
  }
  return [...values];
}

export function evaluateCase(golden: GoldenCase): GoldenResult {
  const request = conversationRequestSchema.parse({
    requestId: crypto.randomUUID(),
    message: golden.prompt,
    executionMode: "deterministic_first",
    sourceScope: "auto",
  });
  const started = performance.now();
  const plan = planConversationWorkflow(request);
  const planMs = performance.now() - started;

  const ids = plan.capabilities.map((capability) => capability.id as string);
  const entities = entitiesOf(plan.capabilities);
  const failures: string[] = [];
  const expect = golden.expect;

  for (const id of expect.includes ?? []) if (!ids.includes(id)) failures.push(`missing capability ${id}`);
  if (expect.includesAny && !expect.includesAny.some((id) => ids.includes(id))) failures.push(`none of [${expect.includesAny.join(", ")}] selected`);
  if (expect.only && (ids.length !== expect.only.length || !expect.only.every((id) => ids.includes(id)))) failures.push(`expected only [${expect.only.join(", ")}] but got [${ids.join(", ")}]`);
  for (const id of expect.forbids ?? []) if (ids.includes(id)) failures.push(`forbidden capability ${id} selected`);
  if (expect.entity && !entities.some((entity) => norm(entity) === norm(expect.entity))) failures.push(`entity "${expect.entity}" not extracted (got ${entities.length ? entities.map((e) => `"${e}"`).join(", ") : "none"})`);
  if (expect.entityPrefix && !entities.some((entity) => norm(entity).startsWith(norm(expect.entityPrefix)))) failures.push(`no entity starting with "${expect.entityPrefix}" (got ${entities.length ? entities.map((e) => `"${e}"`).join(", ") : "none"})`);
  if (expect.noEntity && entities.length) failures.push(`unexpected entity ${entities.map((e) => `"${e}"`).join(", ")}`);
  for (const [id, state] of Object.entries(expect.availability ?? {})) {
    const capability = plan.capabilities.find((item) => item.id === id);
    if (capability && capability.availability !== state) failures.push(`${id} availability ${capability.availability}, expected ${state}`);
  }

  // Universal invariants: unresolved template text must never become an entity or a plan label.
  for (const entity of entities) if (/[\[\]{}<>]/.test(entity)) failures.push(`template text became entity "${entity}"`);
  for (const step of plan.steps) if (/[\[\]]/.test(step.label)) failures.push(`template text in step label "${step.label}"`);

  return { id: golden.id, category: golden.category, prompt: golden.prompt, status: golden.status, passed: failures.length === 0, failures, capabilities: ids, entities, planMs };
}

export interface Scorecard {
  generatedAt: string;
  total: number;
  passed: number;
  mustPass: { total: number; passed: number };
  knownGaps: { total: number; stillFailing: number; nowPassing: string[] };
  byCategory: Record<string, { total: number; passed: number }>;
  planMs: { p50: number; p95: number; max: number };
  failures: Array<{ id: string; prompt: string; status: string; failures: string[] }>;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0;
}

export function buildScorecard(results: GoldenResult[]): Scorecard {
  const must = results.filter((result) => result.status === "must_pass");
  const gaps = results.filter((result) => result.status === "known_gap");
  const byCategory: Scorecard["byCategory"] = {};
  for (const result of results) {
    const entry = (byCategory[result.category] ??= { total: 0, passed: 0 });
    entry.total += 1;
    if (result.passed) entry.passed += 1;
  }
  const times = results.map((result) => result.planMs);
  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    mustPass: { total: must.length, passed: must.filter((result) => result.passed).length },
    knownGaps: { total: gaps.length, stillFailing: gaps.filter((result) => !result.passed).length, nowPassing: gaps.filter((result) => result.passed).map((result) => result.id) },
    byCategory,
    planMs: { p50: Number(percentile(times, 50).toFixed(2)), p95: Number(percentile(times, 95).toFixed(2)), max: Number(Math.max(...times, 0).toFixed(2)) },
    failures: results.filter((result) => !result.passed).map((result) => ({ id: result.id, prompt: result.prompt, status: result.status, failures: result.failures })),
  };
}
