import { z } from "zod";
import { conversationSourceScopeSchema } from "./sourceScope";

/** Presentation and authored inputs of an existing P4 screen, not data/permission authority. */
export const terminalScreenStateSchema = z.object({
  schemaVersion: z.literal(1),
  panelState: z.record(z.unknown()).default({}),
  sourceScope: conversationSourceScopeSchema.default("auto"),
  marketMode: z.enum(["live", "snapshot"]).default("live"),
  stockTape: z.boolean().default(false),
  macroTape: z.boolean().default(false),
  subject: z.object({
    symbol: z.string().trim().min(1).max(100).nullable(),
    securityId: z.string().trim().min(1).max(240).nullable().optional(),
    listingId: z.string().trim().min(1).max(240).nullable().optional(),
  }).strict(),
  portfolioId: z.string().trim().min(1).max(240).nullable().default(null),
  benchmarkId: z.string().trim().min(1).max(240).nullable().default(null),
  scenarioId: z.string().trim().min(1).max(240).nullable().default(null),
  asOf: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export type TerminalScreenState = z.infer<typeof terminalScreenStateSchema>;

/** Immutable target plus authored inputs captured by an explicit original-panel Run action. */
export const terminalExecutionTargetSchema = z.object({
  artifactId: z.string().trim().min(1).max(240),
  baseVersion: z.number().int().positive(),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  slot: z.string().trim().min(1).max(240).refine(value => !["__proto__", "constructor", "prototype"].includes(value)),
  authoredState: terminalScreenStateSchema,
}).strict();
export type TerminalExecutionTarget = z.infer<typeof terminalExecutionTargetSchema>;
export interface TerminalExecutionVersion {
  artifactId: string; baseVersion: number; version: number; contentHash: string;
}

export function initialTerminalScreenState(symbol: string | null, sourceScope: TerminalScreenState["sourceScope"] = "auto"): TerminalScreenState {
  return terminalScreenStateSchema.parse({ schemaVersion: 1, subject: { symbol }, sourceScope });
}
export function readTerminalScreenState(state: Record<string, unknown>): TerminalScreenState | null {
  const parsed = terminalScreenStateSchema.safeParse(state.terminal);
  return parsed.success ? parsed.data : null;
}

/** Explicit encoding preserves Set-based chart controls without storing executable state. */
export function encodeTerminalPanelValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new Error("Terminal panel state exceeds the nesting limit.");
  if (value === undefined) return { $terminalUndefined: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : { $terminalNumber: String(value) };
  if (value instanceof Set) return { $terminalSet: [...value].map(item => encodeTerminalPanelValue(item, depth + 1)) };
  if (value instanceof Date) return { $terminalDate: value.toISOString() };
  if (Array.isArray(value)) return value.map(item => encodeTerminalPanelValue(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Only authored JSON panel inputs can be retained.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe terminal panel state key.");
    return [key, encodeTerminalPanelValue(item, depth + 1)];
  }));
}
export function decodeTerminalPanelValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeTerminalPanelValue);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length === 1) {
      if (item.$terminalUndefined === true) return undefined;
      if (Array.isArray(item.$terminalSet)) return new Set(item.$terminalSet.map(decodeTerminalPanelValue));
      if (typeof item.$terminalDate === "string") return new Date(item.$terminalDate);
      if (item.$terminalNumber === "NaN") return NaN;
      if (item.$terminalNumber === "Infinity") return Infinity;
      if (item.$terminalNumber === "-Infinity") return -Infinity;
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, decodeTerminalPanelValue(child)]));
  }
  return value;
}
