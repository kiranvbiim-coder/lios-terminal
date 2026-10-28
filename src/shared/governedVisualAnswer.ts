import { z } from "zod";
import { artifactComparisonSchema, chartArtifactContentSchema, tableArtifactContentSchema, timelineArtifactContentSchema } from "./artifactContracts";
import { p8ScenarioComparisonSchema } from "./p8ScenarioContracts";
import { p7ContextGraphSchema, p7InsightSchema, p7TimelineEventSchema } from "./p7ResearchContracts";

const artifactId = z.string().regex(/^artifact:[0-9a-f-]{36}$/i);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const exactVisualArtifactRefSchema = z.object({
  artifactId, version: z.number().int().positive(), contentHash: digest,
}).strict();
const revision = z.object({ version: z.number().int().positive(), contentHash: digest }).strict();
export const savedArtifactVisualIntentSchema = exactVisualArtifactRefSchema.extend({
  owner: z.literal("p4"), kind: z.enum(["chart", "table", "table_map", "timeline"]),
}).strict();
const projectSnapshot = {
  owner: z.literal("p7"), snapshotId: z.string().trim().min(1).max(300),
  snapshotHash: digest, graphHash: digest,
};
/** References and presentation selection only. Model data, URLs and renderer code are forbidden. */
export const governedVisualIntentSchema = z.discriminatedUnion("kind", [
  savedArtifactVisualIntentSchema,
  z.object({ owner: z.literal("p4"), kind: z.literal("revision_comparison"), artifactId, left: revision, right: revision }).strict(),
  z.object({ owner: z.literal("p8"), kind: z.literal("scenario_comparison"),
    base: exactVisualArtifactRefSchema, branches: z.array(exactVisualArtifactRefSchema).min(1).max(20),
  }).strict(),
  z.object({ ...projectSnapshot, kind: z.literal("insight_graph"), insightId: z.string().trim().min(1).max(300) }).strict(),
  z.object({ ...projectSnapshot, kind: z.literal("insight_map"), insightId: z.string().trim().min(1).max(300) }).strict(),
  z.object({ ...projectSnapshot, kind: z.literal("project_timeline") }).strict(),
]);
export type GovernedVisualIntent = z.infer<typeof governedVisualIntentSchema>;
export type SavedArtifactVisualIntent = z.infer<typeof savedArtifactVisualIntentSchema>;

/** The server derives owner scope, full source references and projection identity. */
export const governedVisualAnswerRequestSchema = z.object({
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive(),
  intent: governedVisualIntentSchema,
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).min(1).max(2_000),
  projectionHash: digest,
}).strict();
export type GovernedVisualAnswerRequest = z.infer<typeof governedVisualAnswerRequestSchema>;

const remoteArtifactSchema = z.object({
  artifact: z.object({ id: z.string(), projectId: z.number().int().positive().nullable(),
    owningChatId: z.number().int().positive().nullable().optional(), kind: z.string(),
    title: z.string().trim().min(1).max(300), status: z.string(),
  }),
  version: z.object({ artifactId: z.string(), version: z.number().int().positive(), contentHash: digest,
    sourceRefs: z.array(z.string()).max(2_000),
    trustManifest: z.object({ evidence: z.array(z.object({ sourceRef: z.string(),
      access: z.object({ state: z.string(), entitlementRequired: z.boolean().nullable().optional() }).passthrough().nullable().optional(),
    }).passthrough()).max(1_000) }).passthrough().nullable().optional(),
    content: z.unknown(),
  }),
});

export type AuthorizedVisualAnswer =
  | { status: "ready"; kind: "chart"; title: string; version: number; sourceRefs: string[]; content: z.infer<typeof chartArtifactContentSchema> }
  | { status: "ready"; kind: "table"; title: string; version: number; sourceRefs: string[]; content: z.infer<typeof tableArtifactContentSchema> }
  | { status: "ready"; kind: "timeline"; title: string; version: number; sourceRefs: string[]; content: z.infer<typeof timelineArtifactContentSchema> };
export type GovernedVisualAnswerDecision = AuthorizedVisualAnswer | { status: "blocked"; reason: string };
const BLOCKED = { status: "blocked", reason: "The saved owner, source scope, exact revision or content hash could not be verified. No visual answer is displayed." } as const;

/** Secondary identity gate after a fresh canonical authenticated P4 read; never an authorization grant. */
export function resolveGovernedVisualAnswer(rawRequest: unknown, rawServerDetail: unknown): GovernedVisualAnswerDecision {
  const request = governedVisualAnswerRequestSchema.safeParse(rawRequest);
  const detail = remoteArtifactSchema.safeParse(rawServerDetail);
  if (!request.success || !detail.success) return BLOCKED;
  const intent = savedArtifactVisualIntentSchema.safeParse(request.data.intent);
  if (!intent.success) return BLOCKED;
  const { artifact, version } = detail.data;
  const kind = intent.data.kind === "table_map" ? "table" : intent.data.kind;
  if (artifact.id !== intent.data.artifactId || version.artifactId !== artifact.id ||
      version.version !== intent.data.version || version.contentHash !== intent.data.contentHash ||
      artifact.projectId !== request.data.projectId || artifact.status !== "active" || artifact.kind !== kind ||
      artifact.projectId === null && artifact.owningChatId !== request.data.chatId) return BLOCKED;
  const canonicalRefs = new Set(version.sourceRefs);
  const requestedRefs = new Set(request.data.sourceRefs);
  if (!canonicalRefs.size || requestedRefs.size !== canonicalRefs.size ||
      request.data.sourceRefs.some(ref => !canonicalRefs.has(ref))) return BLOCKED;
  // Historical trust only restricts a read. Current source rights remain server-owned.
  const manifest = version.trustManifest;
  if (manifest?.evidence.length) for (const ref of request.data.sourceRefs) {
    const observations = manifest.evidence.filter(item => item.sourceRef === ref);
    if (!observations.length || observations.some(({ access }) => access?.entitlementRequired === true ||
        access && /^(blocked|restricted|denied|unauthorized|not_entitled|expired)$/i.test(access.state))) return BLOCKED;
  }
  const identity = { status: "ready" as const, title: artifact.title, version: version.version, sourceRefs: request.data.sourceRefs };
  if (kind === "chart") {
    const parsed = chartArtifactContentSchema.safeParse(version.content);
    if (!parsed.success || parsed.data.series.length > 12 ||
        parsed.data.series.reduce((sum, series) => sum + series.points.length, 0) > 5_000 ||
        parsed.data.series.every(series => !series.points.length) ||
        !["line", "area", "bar", "scatter"].includes(parsed.data.chartType) ||
        parsed.data.series.some(series => series.points.some(point =>
          typeof point.x === "number" && !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return BLOCKED;
    return { ...identity, kind: "chart", content: parsed.data };
  }
  if (kind === "timeline") {
    const parsed = timelineArtifactContentSchema.safeParse(version.content);
    if (!parsed.success || !parsed.data.events.length) return BLOCKED;
    return { ...identity, kind: "timeline", content: parsed.data };
  }
  const parsed = tableArtifactContentSchema.safeParse(version.content);
  if (!parsed.success || !parsed.data.rows.length || !parsed.data.columns.length ||
      parsed.data.columns.length > 100 || parsed.data.rows.length > 50_000) return BLOCKED;
  return { ...identity, kind: "table", content: parsed.data };
}

export const governedVisualProjectionSchema = z.discriminatedUnion("kind",[
  z.object({kind:z.literal("artifact"),detail:remoteArtifactSchema}),
  z.object({kind:z.literal("revision_comparison"),comparison:artifactComparisonSchema}),
  z.object({kind:z.literal("scenario_comparison"),comparison:p8ScenarioComparisonSchema}),
  z.object({kind:z.literal("project"),graph:p7ContextGraphSchema,insight:p7InsightSchema.nullable(),timeline:z.array(p7TimelineEventSchema)}),
]);
export type GovernedVisualProjection = z.infer<typeof governedVisualProjectionSchema>;
