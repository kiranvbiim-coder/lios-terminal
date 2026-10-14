import { z } from "zod";

const trimmedNullableString = z.string().trim().min(1).max(300).nullable();

export const liosEntityContextSchema = z.object({
  entityId: trimmedNullableString.default(null),
  symbol: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  name: trimmedNullableString.default(null),
  exchange: trimmedNullableString.default(null),
  region: trimmedNullableString.default(null),
  assetClass: trimmedNullableString.default(null),
}).strict();

export const liosTimeContextSchema = z.object({
  mode: z.enum(["latest", "as-known-on"]).default("latest"),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "as-known-on" && !value.asOfDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asOfDate"], message: "as-known-on context requires an asOfDate." });
  }
  if (value.mode === "latest" && value.asOfDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["asOfDate"], message: "latest context cannot carry an asOfDate." });
  }
});

export const liosContextSchema = z.object({
  entity: liosEntityContextSchema.nullable().default(null),
  portfolioId: trimmedNullableString.default(null),
  region: trimmedNullableString.default(null),
  time: liosTimeContextSchema.default({ mode: "latest", asOfDate: null }),
  scenarioId: trimmedNullableString.default(null),
  benchmarkId: trimmedNullableString.default(null),
  workspaceId: trimmedNullableString.default(null),
  viewId: trimmedNullableString.default(null),
  revision: z.number().int().nonnegative().default(0),
}).strict();

export type LiOSEntityContext = z.infer<typeof liosEntityContextSchema>;
export type LiOSTimeContext = z.infer<typeof liosTimeContextSchema>;
export type LiOSContext = z.infer<typeof liosContextSchema>;

export type LiOSContextPatch = Partial<Omit<LiOSContext, "revision">>;

function normalizeNullable(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEntity(entity: LiOSContextPatch["entity"]): LiOSContextPatch["entity"] {
  if (entity === undefined || entity === null) return entity;
  return {
    entityId: normalizeNullable(entity.entityId) ?? null,
    symbol: entity.symbol.trim().toUpperCase(),
    name: normalizeNullable(entity.name) ?? null,
    exchange: normalizeNullable(entity.exchange) ?? null,
    region: normalizeNullable(entity.region) ?? null,
    assetClass: normalizeNullable(entity.assetClass) ?? null,
  };
}

function semanticContext(context: LiOSContext): Omit<LiOSContext, "revision"> {
  const { revision: _revision, ...semantic } = context;
  return semantic;
}

function semanticEqual(left: LiOSContext, right: LiOSContext): boolean {
  return JSON.stringify(semanticContext(left)) === JSON.stringify(semanticContext(right));
}

export function createLiOSContext(seed: LiOSContextPatch = {}): LiOSContext {
  return liosContextSchema.parse({
    entity: normalizeEntity(seed.entity) ?? null,
    portfolioId: normalizeNullable(seed.portfolioId) ?? null,
    region: normalizeNullable(seed.region) ?? null,
    time: seed.time ?? { mode: "latest", asOfDate: null },
    scenarioId: normalizeNullable(seed.scenarioId) ?? null,
    benchmarkId: normalizeNullable(seed.benchmarkId) ?? null,
    workspaceId: normalizeNullable(seed.workspaceId) ?? null,
    viewId: normalizeNullable(seed.viewId) ?? null,
    revision: 0,
  });
}

/**
 * Apply a semantic context patch. Revision changes only when meaning changes,
 * which lets consumers cheaply detect real context transitions without
 * reacting to duplicate navigation events or equivalent normalized values.
 */
export function patchLiOSContext(current: LiOSContext, patch: LiOSContextPatch): LiOSContext {
  const base = liosContextSchema.parse(current);
  const candidate = liosContextSchema.parse({
    ...base,
    ...(patch.entity !== undefined ? { entity: normalizeEntity(patch.entity) } : {}),
    ...(patch.portfolioId !== undefined ? { portfolioId: normalizeNullable(patch.portfolioId) } : {}),
    ...(patch.region !== undefined ? { region: normalizeNullable(patch.region) } : {}),
    ...(patch.time !== undefined ? { time: patch.time } : {}),
    ...(patch.scenarioId !== undefined ? { scenarioId: normalizeNullable(patch.scenarioId) } : {}),
    ...(patch.benchmarkId !== undefined ? { benchmarkId: normalizeNullable(patch.benchmarkId) } : {}),
    ...(patch.workspaceId !== undefined ? { workspaceId: normalizeNullable(patch.workspaceId) } : {}),
    ...(patch.viewId !== undefined ? { viewId: normalizeNullable(patch.viewId) } : {}),
    revision: base.revision,
  });

  return semanticEqual(base, candidate)
    ? candidate
    : { ...candidate, revision: base.revision + 1 };
}

export function clearLiOSContext(current: LiOSContext): LiOSContext {
  return patchLiOSContext(current, {
    entity: null,
    portfolioId: null,
    region: null,
    time: { mode: "latest", asOfDate: null },
    scenarioId: null,
    benchmarkId: null,
    workspaceId: null,
    viewId: null,
  });
}
