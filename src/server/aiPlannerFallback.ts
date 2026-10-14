import { conversationRequestSchema, type ConversationRequest } from "@shared/conversationRuntime";

/**
 * AI planner fallback. When the deterministic router finds nothing for a request that looks like it is
 * about a named company, the configured AI may pick ONE tool from a fixed, checked catalog and name the
 * company. The pick is turned into a canonical request that the deterministic router then plans, so the
 * AI never invents a tool, a parameter or an execution path, and the entity must appear in the user's
 * own words. AI proposes; deterministic routing and engines still decide and compute.
 */
export const PLANNER_CATALOG = {
  "company.research": { label: "research a company (fundamentals, technicals, sources)", template: (entity: string) => `Research ${entity}` },
  "market.technical": { label: "technical analysis / chart / price action for a security", template: (entity: string) => `Show technicals for ${entity}` },
  "company.valuation": { label: "value a company (DCF / fair value)", template: (entity: string) => `Build a DCF for ${entity}` },
} as const;

export type PlannerCapabilityId = keyof typeof PLANNER_CATALOG;

export interface PlannerChoice {
  capability: PlannerCapabilityId;
  entity: string;
}

/** Cheap gate so plain concept questions never pay for an extra AI call. */
export function looksLikeNamedSecurityRequest(message: string): boolean {
  const text = message.trim();
  if (text.length < 4 || text.length > 240) return false;
  if (/[\[\]{}<>]/.test(text)) return false;
  const words = text.split(/\s+/);
  const properNoun = words.slice(1).some((word) => /^[A-Z][a-z][A-Za-z&.'\-]+$/.test(word.replace(/[?,.!]+$/, "")));
  const ticker = /\$[A-Za-z]{1,6}\b|\b[A-Z]{2,5}\b/.test(text.replace(/\b(?:AI|DCF|RSI|MACD|EPS|ETF|GDP|CPI|USD|EUR|FX|VAR)\b/g, ""));
  return properNoun || ticker;
}

export function plannerMessages(message: string): { system: string; user: string } {
  const tools = Object.entries(PLANNER_CATALOG).map(([id, tool]) => `- ${id}: ${tool.label}`).join("\n");
  return {
    system: [
      "You route a finance request to one tool. Reply with ONLY compact JSON: {\"capability\": <id or \"none\">, \"entity\": <company or ticker exactly as the user wrote it, or null>}.",
      "Tools:",
      tools,
      "Choose \"none\" for general questions, explanations, opinions or anything not about a specific named company or security.",
      "The entity must be copied from the user's message. Never invent one.",
    ].join("\n"),
    user: message,
  };
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parsePlannerChoice(text: string, userMessage: string): PlannerChoice | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { capability, entity } = parsed as { capability?: unknown; entity?: unknown };
  if (typeof capability !== "string" || !(capability in PLANNER_CATALOG)) return null;
  if (typeof entity !== "string") return null;
  const name = entity.trim();
  if (name.length < 1 || name.length > 60 || /[\n\[\]{}<>]/.test(name)) return null;
  // The company must come from the user's own words, never from the model's memory.
  if (!` ${normalise(userMessage)} `.includes(` ${normalise(name)} `)) return null;
  return { capability: capability as PlannerCapabilityId, entity: name };
}

export function routedRequest(request: ConversationRequest, choice: PlannerChoice): ConversationRequest {
  return conversationRequestSchema.parse({ ...request, message: PLANNER_CATALOG[choice.capability].template(choice.entity) });
}
