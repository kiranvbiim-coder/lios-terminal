import { z } from "zod";
import type { ArtifactContent, ArtifactRefreshSpec } from "@shared/artifactContracts";

const catalogueSchema = z.object({
  existingTemplates: z.array(z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string(),
  })).min(1),
});
export type ArtifactReportTemplate = z.infer<typeof catalogueSchema>["existingTemplates"][number];

/** Only reportEngine's catalogue is authoritative; Wave D's separate templates are not options. */
export function canonicalArtifactReportTemplates(payload: unknown): ArtifactReportTemplate[] {
  const templates = catalogueSchema.parse(payload).existingTemplates;
  if (new Set(templates.map((template) => template.id)).size !== templates.length) {
    throw new Error("Report structure catalogue contains duplicate identifiers.");
  }
  return templates;
}

/** These are recommendations, not a second template registry or an implicit user choice. */
export function recommendedArtifactReportTemplate(kind: ArtifactContent["kind"], templates: readonly ArtifactReportTemplate[]): string {
  const id = kind === "portfolio" ? "portfolio_review"
    : kind === "valuation" ? "dcf_model_pack"
    : kind === "decision" ? "decision_receipt_report"
    : "investment_memo";
  return templates.some((template) => template.id === id) ? id : "";
}

export interface ArtifactReportSource {
  artifactId: string;
  versionArtifactId: string;
  projectId: number;
  version: number;
  headVersion: number;
  contentHash: string;
}

export function artifactReportSourceError(captured: ArtifactReportSource, current: ArtifactReportSource): string | null {
  if (!captured.artifactId || captured.versionArtifactId !== captured.artifactId || captured.projectId <= 0
    || !Number.isInteger(captured.version) || captured.version < 1 || !captured.contentHash.trim()) {
    return "The saved Artifact source is incomplete. Reload before preparing a report request.";
  }
  if (captured.artifactId !== current.artifactId || captured.versionArtifactId !== current.versionArtifactId
    || captured.projectId !== current.projectId || captured.version !== current.version
    || captured.headVersion !== current.headVersion || captured.contentHash !== current.contentHash) {
    return "The selected Artifact revision changed. Review the current saved source before preparing a report request.";
  }
  if (current.version !== current.headVersion) {
    return "This saved version is not the current Artifact head. Reload before preparing a report request.";
  }
  return null;
}

export function prepareArtifactReportRequest(input: {
  templateId: string;
  templates: readonly ArtifactReportTemplate[];
  title: string;
  captured: ArtifactReportSource;
  current: ArtifactReportSource;
}): ArtifactRefreshSpec {
  const sourceError = artifactReportSourceError(input.captured, input.current);
  if (sourceError) throw new Error(sourceError);
  const template = input.templates.find((item) => item.id === input.templateId);
  if (!template) throw new Error("Choose a report structure from the current catalogue before preparing a request.");
  return {
    kind: "conversation",
    sourceScope: "my_data",
    executionMode: "deterministic_first",
    capabilityIds: ["research.report"],
    message: `Create ${template.name} from this Artifact`,
    selection: { kind: "artifact", id: input.captured.artifactId, label: input.title.slice(0, 300), view: null, symbol: null },
    engineRef: null,
  };
}
