import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";

/**
 * Pure summary of a Conversation Runtime run for the chat: what state it ended in, how much work it
 * did, which data sources it used, and which follow-up requests are safe to offer. No rendering here.
 */
export type TraceStatus = "idle" | "running" | "completed" | "needs_input" | "failed" | "cancelled";

export interface TraceSummary {
  status: TraceStatus;
  stepCount: number;
  settledSteps: number;
  sources: string[];
  durationMs: number | null;
  resolvedSymbol: string | null;
  capabilityIds: string[];
}

const ACRONYMS = new Set(["sec", "edgar", "fred", "ecb", "lse", "imf", "bls", "fx", "ai", "api", "etf", "ecb"]);
const NON_SOURCE_PREFIXES = ["ai-provider:", "engine:", "model:", "fixture:"];
const STRIP_PREFIXES = ["provider:", "lios:", "project:"];

/** "provider:sec_edgar" -> "SEC EDGAR". Returns null for references that are not user-facing data sources. */
export function humanizeSourceRef(ref: string): string | null {
  const value = ref.trim();
  if (!value || NON_SOURCE_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  let name = value;
  for (const prefix of STRIP_PREFIXES) if (name.startsWith(prefix)) name = name.slice(prefix.length);
  name = name.split("@")[0].trim();
  if (!name) return null;
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => (ACRONYMS.has(token.toLowerCase()) ? token.toUpperCase() : token.charAt(0).toUpperCase() + token.slice(1)))
    .join(" ");
}

export function summarizeRuntimeTrace(events: readonly ConversationRuntimeEvent[], busy: boolean): TraceSummary {
  const plan = [...events].reverse().find((event) => event.type === "plan");
  const planSteps = plan?.type === "plan" ? plan.plan.steps : [];
  const done = [...events].reverse().find((event) => event.type === "done");
  const hasGap = events.some((event) => event.type === "data_gap");
  const hasError = events.some((event) => event.type === "error");

  const settled = new Set<string>();
  const sources: string[] = [];
  let resolvedSymbol: string | null = null;
  for (const event of events) {
    if (event.type === "tool_result" || (event.type === "status" && event.state === "completed" && event.stepId)) {
      if (event.stepId) settled.add(event.stepId);
    }
    if (event.type === "tool_result") {
      for (const ref of event.sourceRefs ?? []) {
        const label = humanizeSourceRef(ref);
        if (label && !sources.includes(label)) sources.push(label);
      }
      if (event.stepId === "resolve-security") {
        const match = /→\s*([A-Z0-9][A-Z0-9.\-]{0,11})\b/.exec(event.summary);
        if (match) resolvedSymbol = match[1];
      }
    }
  }

  let status: TraceStatus;
  if (done?.type === "done") {
    if (done.status === "completed") status = "completed";
    else if (done.status === "cancelled") status = "cancelled";
    else if (hasGap && !hasError) status = "needs_input";
    else if (done.status === "failed") status = "failed";
    else status = "needs_input";
  } else {
    status = busy ? "running" : events.length ? "running" : "idle";
  }

  const times = events.map((event) => Date.parse(event.at)).filter((value) => Number.isFinite(value));
  const durationMs = times.length >= 2 ? Math.max(...times) - Math.min(...times) : null;

  return {
    status,
    stepCount: planSteps.length,
    settledSteps: planSteps.filter((step) => settled.has(step.id)).length,
    sources,
    durationMs,
    resolvedSymbol,
    capabilityIds: plan?.type === "plan" ? plan.plan.capabilities.map((capability) => capability.id as string) : [],
  };
}

/**
 * Follow-ups are requests the router is known to complete (see evals/golden/routing.json), so a chip
 * never leads to a dead end. They prefill the composer for review; nothing is sent automatically.
 */
export function followUpPrompts(summary: TraceSummary): string[] {
  const symbol = summary.resolvedSymbol;
  if (summary.status !== "completed" || !symbol) return [];
  const ids = new Set(summary.capabilityIds);
  const hasCompanyWork = ["company.research", "company.fundamentals", "company.valuation", "security.overview"].some((id) => ids.has(id));
  const hasTechnical = ids.has("market.technical");
  if (!hasCompanyWork && !hasTechnical) return [];
  const prompts: string[] = [];
  if (hasCompanyWork && !hasTechnical) prompts.push(`Show RSI and MACD for ${symbol}`);
  if (hasTechnical && !hasCompanyWork) prompts.push(`Research ${symbol}`);
  if (!ids.has("strategy.backtest")) prompts.push(`Backtest an RSI strategy on ${symbol}`);
  return prompts.slice(0, 3);
}

export function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 950) return `${Math.max(1, Math.round(durationMs))} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}
