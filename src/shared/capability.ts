import { z } from "zod";

export const capabilitySurfaceSchema = z.enum([
  "api",
  "command_palette",
  "master_ai",
  "automation",
  "workspace",
  "artifact",
  "mcp",
]);

export const capabilityExecutionTargetSchema = z.enum([
  "typescript",
  "python_sidecar",
  "client",
  "desktop",
  "data_service",
  "ai_provider",
  "external_provider",
]);

export const capabilityAvailabilitySchema = z.object({
  state: z.enum(["available", "configurable", "experimental", "disabled", "degraded"]),
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict();

export const capabilityExecutionSchema = z.object({
  target: capabilityExecutionTargetSchema,
  endpoint: z.string().trim().min(1).max(500).optional(),
  handlerId: z.string().trim().min(1).max(300).optional(),
  deterministic: z.boolean().default(false),
  seeded: z.boolean().default(false),
}).strict();

export const capabilitySourceSchema = z.object({
  kind: z.enum(["internal", "connector", "plugin", "generated", "external"]),
  sourceId: z.string().trim().min(1).max(300).optional(),
  files: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
}).strict();

export const capabilityUiHintsSchema = z.object({
  existingSurfaces: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  /** Preferred existing terminal destination when discovery should navigate
   * instead of executing immediately. Kept as a string here so the shared
   * capability contract stays independent from the React client's ViewMode. */
  preferredView: z.string().trim().min(1).max(200).optional(),
}).strict();

export const capabilityAiHintsSchema = z.object({
  invocable: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
}).strict();

/**
 * The small, provider-neutral contract that lets one LiOS action be discovered
 * by many product surfaces without duplicating its implementation.
 *
 * Domain-specific registries remain authoritative for their specialist
 * metadata. They adapt into this contract instead of being replaced by it.
 */
export const liosCapabilitySchema = z.object({
  id: z.string().trim().min(1).max(300).regex(/^[a-z0-9][a-z0-9._:-]*$/),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(2_000),
  category: z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9._:-]*$/),
  version: z.string().trim().min(1).max(100),
  availability: capabilityAvailabilitySchema,
  execution: capabilityExecutionSchema,
  surfaces: z.array(capabilitySurfaceSchema).min(1).max(20),
  permissions: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  entitlements: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  contextRequirements: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  schemaRefs: z.object({
    input: z.string().trim().min(1).max(500).optional(),
    output: z.string().trim().min(1).max(500).optional(),
  }).strict().default({}),
  uiHints: capabilityUiHintsSchema.default({ existingSurfaces: [] }),
  aiHints: capabilityAiHintsSchema.default({ invocable: false, requiresConfirmation: false }),
  source: capabilitySourceSchema,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.surfaces).size !== value.surfaces.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["surfaces"], message: "Capability surfaces must be unique." });
  }
  if (value.execution.seeded && !value.execution.deterministic) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "seeded"], message: "Seeded execution must also be marked deterministic." });
  }
});

export type CapabilitySurface = z.infer<typeof capabilitySurfaceSchema>;
export type CapabilityExecutionTarget = z.infer<typeof capabilityExecutionTargetSchema>;
export type LiOSCapability = z.infer<typeof liosCapabilitySchema>;
