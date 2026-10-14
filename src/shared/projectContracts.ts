import { z } from "zod";
import { isAnalyticalWorkspaceStateV2 } from "./analyticalWorkspaceState";

const paneIdSchema = z.enum(["primary", "secondary", "tertiary", "quaternary"]);
const linkedTimeSchema = z.object({
  enabled: z.boolean(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  mode: z.enum(["latest", "as-known-on"]),
}).strict();

const linkedContextSchema = z.object({
  instrument: z.string().trim().max(120).optional(),
  time: linkedTimeSchema.optional(),
  scenarioId: z.string().trim().max(200).nullable().optional(),
  portfolioId: z.string().trim().max(200).nullable().optional(),
  benchmarkId: z.string().trim().max(200).nullable().optional(),
}).strict();

export const projectLinkedContextStateSchema = z.object({
  contexts: z.record(linkedContextSchema).default({}),
  channels: z.object({
    A: linkedContextSchema.optional(),
    B: linkedContextSchema.optional(),
    C: linkedContextSchema.optional(),
    D: linkedContextSchema.optional(),
  }).strict().default({}),
}).strict();

export const projectFocusedObjectSchema = z.object({
  kind: z.enum(["panel", "artifact", "entity", "chat", "project"]),
  id: z.string().trim().max(240).nullable().default(null),
  label: z.string().trim().max(240).nullable().default(null),
  view: z.string().trim().max(120).nullable().default(null),
  symbol: z.string().trim().max(120).nullable().default(null),
  paneId: paneIdSchema.nullable().default(null),
}).strict();

const SENSITIVE_SESSION_KEY = /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|authorization)/i;

function containsSensitiveSessionKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveSessionKey(item, depth + 1));
  if (typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_SESSION_KEY.test(key)) return true;
    if (containsSensitiveSessionKey(nested, depth + 1)) return true;
  }
  return false;
}

export const projectSessionProvenanceSchema = z.object({
  layoutStateRef: z.string().trim().max(500).nullable().default(null),
  sourcePolicyRef: z.string().trim().max(500).nullable().default(null),
  strategyRef: z.string().trim().max(500).nullable().default(null),
  backtestRef: z.string().trim().max(500).nullable().default(null),
  assumptionRefs: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  artifactVersionRefs: z.array(z.string().trim().min(1).max(500)).max(1_000).default([]),
}).strict();

export const projectVisualEnvironmentStateSchema = z.object({
  projectId: z.string().trim().max(200).nullable().default(null),
  environmentId: z.enum([
    "neutral",
    "global-intelligence",
    "company-intelligence",
    "markets",
    "valuation",
    "portfolio-risk",
    "quant-strategy",
    "research-knowledge",
    "personal-finance",
    "economic-intelligence",
  ]),
  intensity: z.enum(["immersive", "contextual", "focus"]),
  semanticContext: z.enum([
    "general",
    "company",
    "markets",
    "valuation",
    "portfolio",
    "risk",
    "quant",
    "research",
    "macro",
    "personal-finance",
  ]),
}).strict();

export const projectWorkspaceSessionStateSchema = z.object({
  version: z.literal(1),
  workspaceEngine: z.enum(["legacy-resizable", "dockview"]),
  analyticalState: z.custom<unknown>((value) => isAnalyticalWorkspaceStateV2(value), {
    message: "Session analyticalState must be a valid LiOS AnalyticalWorkspaceStateV2.",
  }),
  dockviewLayout: z.record(z.unknown()).nullable().default(null),
  linkedContext: projectLinkedContextStateSchema,
  focusedObject: projectFocusedObjectSchema,
  savedViewName: z.string().trim().max(200).nullable().default(null),
  visualEnvironment: projectVisualEnvironmentStateSchema.nullable().optional(),
  provenance: projectSessionProvenanceSchema.optional(),
}).strict().superRefine((value, ctx) => {
  try {
    const size = JSON.stringify(value).length;
    if (size > 220_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analyticalState"],
        message: "Session workspace state exceeds the 220KB P1 persistence limit.",
      });
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Session workspace state must be JSON-serializable.",
    });
  }
  if (containsSensitiveSessionKey(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Session workspace state must not contain credentials, secrets, passwords or authorization tokens.",
    });
  }
});

export type ProjectWorkspaceSessionState = z.infer<typeof projectWorkspaceSessionStateSchema>;
export type ProjectFocusedObject = z.infer<typeof projectFocusedObjectSchema>;
export type ProjectSessionProvenance = z.infer<typeof projectSessionProvenanceSchema>;

export const createProjectSessionSchema = z.object({
  projectId: z.number().int().positive(),
  chatId: z.number().int().positive().nullable().optional(),
  parentSessionId: z.string().trim().min(1).max(200).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  workspaceState: projectWorkspaceSessionStateSchema,
}).strict();

export const updateProjectSessionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  workspaceState: projectWorkspaceSessionStateSchema.optional(),
}).strict();

export const safeWorkspaceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("open-panel"),
    view: z.string().trim().min(1).max(120),
    symbol: z.string().trim().max(120).optional(),
    placement: z.enum(["primary", "secondary", "tab", "floating"]).default("secondary"),
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("focus-panel"),
    paneId: paneIdSchema,
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("close-panel"),
    paneId: paneIdSchema,
    reason: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    type: z.literal("propose-layout"),
    preset: z.enum(["conversation-artifact", "research", "modeling", "quant", "portfolio", "personal-finance"]),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
]);

export type SafeWorkspaceAction = z.infer<typeof safeWorkspaceActionSchema>;

export function workspaceActionNeedsConfirmation(action: SafeWorkspaceAction): boolean {
  return action.type === "propose-layout";
}
