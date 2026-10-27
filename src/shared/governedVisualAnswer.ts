import { z } from "zod";
import { chartArtifactContentSchema, tableArtifactContentSchema } from "./artifactContracts";

/**
 * AI/runtime events may request a PRESENTATION, never propose data or permission.
 * Only the authenticated saved Artifact endpoint can supply the exact values.
 */
export const governedVisualAnswerRequestSchema = z.object({
  artifactId: z.string().regex(/^artifact:[0-9a-f-]{36}$/i),
  version: z.number().int().positive(),
  projectId: z.number().int().positive().nullable(),
  kind: z.enum(["chart", "table"]),
  sourceRefs: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
}).strict();
export type GovernedVisualAnswerRequest = z.infer<typeof governedVisualAnswerRequestSchema>;

const remoteArtifactSchema = z.object({
  artifact: z.object({
    id: z.string(),
    projectId: z.number().int().positive().nullable(),
    kind: z.string(),
    title: z.string().trim().min(1).max(300),
    status: z.string(),
  }),
  version: z.object({
    artifactId: z.string(),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRefs: z.array(z.string()).max(2000),
    content: z.unknown(),
  }),
});

export type AuthorizedVisualAnswer =
  | { status: "ready"; kind: "chart"; title: string; version: number; sourceRefs: string[]; content: z.infer<typeof chartArtifactContentSchema> }
  | { status: "ready"; kind: "table"; title: string; version: number; sourceRefs: string[]; content: z.infer<typeof tableArtifactContentSchema> };
export type GovernedVisualAnswerDecision = AuthorizedVisualAnswer | { status: "blocked"; reason: string };

const BLOCKED = { status: "blocked", reason: "The saved Artifact, source scope, or exact revision could not be verified. No visual answer is displayed." } as const;

/**
 * This is a SECOND gate after the server's authenticated GET. It checks exact
 * identity/version/Project/source lineage and the P4 content schema. It cannot
 * authorize a caller to access something the endpoint itself denied.
 */
export function resolveGovernedVisualAnswer(
  rawRequest: unknown,
  rawServerDetail: unknown,
): GovernedVisualAnswerDecision {
  const request = governedVisualAnswerRequestSchema.safeParse(rawRequest);
  const detail = remoteArtifactSchema.safeParse(rawServerDetail);
  if (!request.success || !detail.success) return BLOCKED;
  const { artifact, version } = detail.data;
  if (artifact.id !== request.data.artifactId || version.artifactId !== artifact.id ||
    version.version !== request.data.version || artifact.projectId !== request.data.projectId ||
    artifact.status !== "active" || artifact.kind !== request.data.kind) return BLOCKED;

  const canonicalRefs = new Set(version.sourceRefs);
  if (!canonicalRefs.size || request.data.sourceRefs.some(ref => !canonicalRefs.has(ref))) return BLOCKED;

  if (request.data.kind === "chart") {
    const parsed = chartArtifactContentSchema.safeParse(version.content);
    if (!parsed.success || parsed.data.series.length > 12 ||
      parsed.data.series.reduce((sum, series) => sum + series.points.length, 0) > 5_000 ||
      parsed.data.series.every(series => !series.points.length) ||
      !["line", "area", "bar", "scatter"].includes(parsed.data.chartType) ||
      parsed.data.series.some(series => series.points.some(point =>
        (typeof point.x === "number" && !Number.isFinite(point.x)) || !Number.isFinite(point.y)))) return BLOCKED;
    return { status: "ready", kind: "chart", content: parsed.data, title: artifact.title,
      version: version.version, sourceRefs: request.data.sourceRefs };
  }
  const parsed = tableArtifactContentSchema.safeParse(version.content);
  if (!parsed.success || parsed.data.rows.length === 0 || parsed.data.columns.length === 0 ||
      parsed.data.columns.length > 100 || parsed.data.rows.length > 50_000) return BLOCKED;
  return { status: "ready", kind: "table", content: parsed.data, title: artifact.title,
    version: version.version, sourceRefs: request.data.sourceRefs };
}

/** A visual request may reference exact saved evidence but not submit arbitrary data. */
export function visualRequestFromRuntimeArtifact(value: {
  artifact: { artifactType: string; projectId: number | null; sourceRefs: string[] };
  persistedArtifact?: { id: string; version: number };
}): GovernedVisualAnswerRequest | null {
  if (!value.persistedArtifact || !["chart", "table"].includes(value.artifact.artifactType)) return null;
  const result = governedVisualAnswerRequestSchema.safeParse({
    artifactId: value.persistedArtifact.id,
    version: value.persistedArtifact.version,
    projectId: value.artifact.projectId,
    kind: value.artifact.artifactType,
    sourceRefs: value.artifact.sourceRefs,
  });
  return result.success ? result.data : null;
}
