import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArtifactComparison, ArtifactContent, ArtifactExportPlan, ArtifactRefreshSpec, SpreadsheetCellDiff } from "@shared/artifactContracts";
import type { ArtifactSemanticComparison } from "@shared/artifactSemanticDiffContracts";
import { decisionArtifactApprovalInspectionSchema, decisionArtifactApprovalOptionsSchema } from "@shared/artifactContracts";
import type { DecisionArtifactApprovalBaseInput, DecisionArtifactApprovalLinkInput } from "@shared/artifactContracts";
import type { TrustManifest } from "@shared/trustContracts";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import type { IntegratedModelAssumptions, SpecializedModelSchedules } from "@shared/integratedFinancialModel";
import type {
  ArtifactModelMaintenanceHead, ArtifactModelMaintenanceOptions, ArtifactModelMaintenanceRequest,
  ArtifactModelMaintenanceApplyRequest, ArtifactModelMaintenanceReview, ArtifactModelMaintenanceResult,
} from "@shared/artifactModelMaintenance";
import { apiRequest } from "./queryClient";

export interface ProjectArtifactRecord {
  id: string; projectId: number | null; owningChatId?: number | null; ownerUserId: number; organizationId: number | null;
  kind: ArtifactContent["kind"]; title: string; status: "active" | "archived";
  origin: "direct" | "conversation" | "import" | "fork" | "engine"; headVersion: number;
  forkedFromArtifactId: string | null; forkedFromVersion: number | null;
  createdAt: string; updatedAt: string; archivedAt: string | null; trashedAt: string | null;
  trashedByProjectId: number | null; trashedFromStatus: "active" | "archived" | null;
}
export interface ProjectArtifactVersionRecord {
  id: string; artifactId: string; version: number; parentVersionId: string | null;
  adapterId: string; content: ArtifactContent; contentHash: string; sourceRefs: string[];
  executionReceiptIds: string[]; assumptionRefs: string[];
  trustManifest: TrustManifest | null; dependencyRefs: string[]; refreshSpec: ArtifactRefreshSpec | null;
  note: string | null; createdByUserId: number; createdAt: string;
}
export interface ArtifactDetail { artifact: ProjectArtifactRecord; version: ProjectArtifactVersionRecord; }

export function useDecisionArtifactApproval(artifactId: string, version: number, contentHash: string) {
  return useQuery({
    queryKey: ["/api/artifacts", artifactId, "decision-approval", version, contentHash],
    queryFn: async () => decisionArtifactApprovalInspectionSchema.parse(await (await apiRequest("GET", `/api/artifacts/${encodeURIComponent(artifactId)}/decision-approval?version=${version}`)).json()),
  });
}

export function useDecisionArtifactApprovalOptions(artifactId: string, version: number, contentHash: string) {
  return useQuery({
    queryKey: ["/api/artifacts", artifactId, "decision-approval", "options", version, contentHash],
    queryFn: async () => decisionArtifactApprovalOptionsSchema.parse(await (await apiRequest("GET", `/api/artifacts/${encodeURIComponent(artifactId)}/decision-approval/options?version=${version}`)).json()),
  });
}

export async function linkDecisionArtifactApproval(artifactId: string, input: DecisionArtifactApprovalLinkInput) {
  return decisionArtifactApprovalInspectionSchema.parse(await (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/decision-approval/link`, input)).json());
}

export async function unlinkDecisionArtifactApproval(artifactId: string, input: DecisionArtifactApprovalBaseInput) {
  return decisionArtifactApprovalInspectionSchema.parse(await (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/decision-approval/unlink`, input)).json());
}

export async function restoreArtifactRevision(artifactId: string, baseVersion: number, targetVersion: number) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/restore-revision`, { baseVersion, targetVersion })).json() as Promise<ProjectArtifactVersionRecord>;
}

export async function proposeOfficeArtifactReturn(artifactId: string, input: {
  sourceArtifactId: string; sourceVersion: number; sourceHash: string;
  sourceContent: ArtifactContent; content: ArtifactContent; format: "docx" | "pptx";
  fileHash: string; warnings: string[];
}) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/office-return`, input)).json() as Promise<{
    proposal: ProjectArtifactProposalRecord | null; changed: boolean; changedKeys?: string[]; warnings: string[];
  }>;
}

export async function proposeArtifactBranchMerge(artifactId: string, input: {
  branchArtifactId: string; branchVersion: number; targetVersion: number;
  resolutions: Record<string, "target" | "branch">;
}) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/merge-branch`, input)).json() as Promise<{
    conflicts: string[]; changedKeys: string[]; proposal: ProjectArtifactProposalRecord | null;
    conflictPreviews: Record<string, { target: string; branch: string; truncated: boolean }>;
  }>;
}
export interface ArtifactReferenceRecord {
  id: string; projectId: number | null; owningChatId?: number | null; artifactId: string; version: number | null;
  targetType: "project" | "session" | "chat" | "resource" | "artifact";
  targetRef: string; label: string | null; createdAt: string;
}
export interface ProjectArtifactProposalRecord {
  id: string; artifactId: string; baseVersion: number;
  proposalType: "spreadsheet_ai_diff" | "document_edit" | "artifact_patch";
  status: "pending" | "accepted" | "rejected" | "cancelled"; summary: string;
  diffs: SpreadsheetCellDiff[]; patch: Record<string, unknown>; proposedContentHash: string;
  createdAt: string; decidedAt: string | null;
}

export function useOwnedArtifacts(scope: { projectId: number | null; owningChatId?: number | null }, status: "active" | "archived" | "trash" = "active") {
  const { projectId, owningChatId } = scope;
  const path = projectId ? `/api/projects/${projectId}/artifacts` : owningChatId ? `/api/chats/${owningChatId}/artifacts` : null;
  return useQuery<ProjectArtifactRecord[]>({
    queryKey: projectId ? ["/api/projects", projectId, "artifacts", status] : ["/api/chats", owningChatId ?? null, "artifacts", status],
    queryFn: async () => { const res = await fetch(`${path}?status=${status}&limit=500`); if (!res.ok) throw new Error("Failed to load saved Artifacts."); return res.json(); },
    enabled: path !== null,
  });
}

export function useProjectArtifacts(projectId: number | null, status: "active" | "archived" | "trash" = "active") {
  return useOwnedArtifacts({ projectId }, status);
}

export function useAllArtifacts(status: "active" | "archived" | "trash" = "active") {
  return useQuery<ProjectArtifactRecord[]>({
    queryKey: ["/api/artifacts", status],
    queryFn: async () => {
      const res = await fetch(`/api/artifacts?status=${status}&limit=500`);
      if (!res.ok) throw new Error("Failed to load Artifacts.");
      return res.json();
    },
  });
}
export function useArtifact(artifactId: string | null, version?: number | null) {
  return useQuery<ArtifactDetail>({
    queryKey: version ? ["/api/artifacts", artifactId, "version", version] : ["/api/artifacts", artifactId],
    queryFn: async () => { const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId!)}${version ? `?version=${version}` : ""}`); if (!res.ok) throw new Error("Failed to load Artifact."); return res.json(); },
    enabled: Boolean(artifactId),
    // No prior revision is safe to render as an exact requested P4 version.
    // Permission and version are rechecked by the authenticated GET.
  });
}
export function useArtifactVersions(artifactId: string | null) {
  return useQuery<ProjectArtifactVersionRecord[]>({
    queryKey: ["/api/artifacts", artifactId, "versions"],
    queryFn: async () => { const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId!)}/versions`); if (!res.ok) throw new Error("Failed to load Artifact versions."); return res.json(); },
    enabled: Boolean(artifactId),
  });
}
export function useArtifactProposals(artifactId: string | null) {
  return useQuery<ProjectArtifactProposalRecord[]>({
    queryKey: ["/api/artifacts", artifactId, "proposals"],
    queryFn: async () => { const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId!)}/proposals`); if (!res.ok) throw new Error("Failed to load Artifact proposals."); return res.json(); },
    enabled: Boolean(artifactId),
  });
}
export function useArtifactReferences(artifactId: string | null) {
  return useQuery<ArtifactReferenceRecord[]>({
    queryKey: ["/api/artifacts", artifactId, "references"],
    queryFn: async () => { const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId!)}/references`); if (!res.ok) throw new Error("Failed to load Artifact references."); return res.json(); },
    enabled: Boolean(artifactId),
  });
}
export function useInvalidateArtifacts() {
  const qc = useQueryClient();
  return useCallback((projectId?: number | null, artifactId?: string | null) => {
    qc.invalidateQueries({ queryKey: ["/api/artifacts"] });
    qc.invalidateQueries({ queryKey: ["/api/chats"] });
    if (projectId) {
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "artifacts"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", projectId, "continuity"] });
    }
    if (artifactId) {
      qc.invalidateQueries({ queryKey: ["/api/artifacts", artifactId] });
      qc.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "versions"] });
      qc.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "proposals"] });
      qc.invalidateQueries({ queryKey: ["/api/artifacts", artifactId, "references"] });
    }
  }, [qc]);
}
export async function createArtifact(projectId: number, input: {
  title: string;
  content: ArtifactContent;
  origin?: ProjectArtifactRecord["origin"];
  trustManifest?: TrustManifest | null;
  dependencyRefs?: string[];
  refreshSpec?: ArtifactRefreshSpec | null;
}) {
  return (await apiRequest("POST", `/api/projects/${projectId}/artifacts`, input)).json() as Promise<ArtifactDetail>;
}

export async function saveIntegratedModelRunArtifact(runId: string, destination: { projectId: number | null; owningChatId?: number }): Promise<ArtifactDetail> {
  return (await apiRequest("POST", `/api/financial-models/integrated/runs/${encodeURIComponent(runId)}/artifact`, destination)).json();
}

export interface IntegratedModelInputReview {
  artifactId: string;
  version: number;
  contentHash: string;
  reviewHash: string;
  engineRev: string;
  source: {
    runId: string;
    runResultHash: string;
    datasetSnapshotId: string;
    datasetContentHash: string;
    entitlementPolicyId: string;
    entitlementPolicyHash: string;
  };
  assumptions: IntegratedModelAssumptions;
  schedules: SpecializedModelSchedules;
  changedFields: Array<{
    sheetId: "assumptions" | "schedule-inputs";
    cell: string;
    path: string;
    before: string | number | boolean | null;
    after: string | number | boolean | null;
  }>;
  sourceRefs: string[];
  inputHash: string;
}

export interface IntegratedModelArtifactRunResult {
  review: IntegratedModelInputReview;
  outputArtifact: ProjectArtifactRecord;
  outputVersion: ProjectArtifactVersionRecord;
  receipt: {
    runId: string;
    resultHash: string;
    datasetSnapshotId: string;
    datasetContentHash: string;
    inputHash: string;
    calculatedAt: string;
    deterministic: true;
  };
  lineage: {
    modelInput: { id: string; datasetVersionId: string; sourceCellRefs: string[]; targetCellRefs: string[]; inputHash: string } | null;
  };
}

export async function reviewIntegratedModelArtifactInputs(artifactId: string, version: number): Promise<IntegratedModelInputReview> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/integrated-model-review`, { version })).json();
}

export async function runReviewedIntegratedModelArtifactInputs(artifactId: string, input: {
  version: number;
  contentHash: string;
  reviewHash: string;
}): Promise<IntegratedModelArtifactRunResult> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/integrated-model-run`, input)).json();
}

export function useArtifactModelMaintenanceOptions(artifactId: string, head: ArtifactModelMaintenanceHead, enabled: boolean) {
  return useQuery<ArtifactModelMaintenanceOptions>({
    queryKey: ["/api/artifacts", artifactId, "model-maintenance", "options", head.version, head.contentHash],
    queryFn: async () => (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/model-maintenance/options`, head)).json(),
    enabled,
    retry: false,
  });
}

export async function reviewArtifactModelMaintenance(artifactId: string, input: ArtifactModelMaintenanceRequest): Promise<ArtifactModelMaintenanceReview> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/model-maintenance/review`, input)).json();
}

export async function applyArtifactModelMaintenance(artifactId: string, input: ArtifactModelMaintenanceApplyRequest): Promise<ArtifactModelMaintenanceResult> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/model-maintenance/apply`, input)).json();
}

export interface SpreadsheetArtifactImportResult extends ArtifactDetail {
  import: {
    fileName: string;
    sha256: string;
    importedAt: string;
    unsupportedFeatures: Array<"charts" | "pivot_tables" | "external_links">;
    sheets: number;
  };
}

export async function importSpreadsheetArtifact(projectId: number, file: File): Promise<SpreadsheetArtifactImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/projects/${projectId}/artifacts/import-spreadsheet`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Spreadsheet import failed.");
  }
  return res.json() as Promise<SpreadsheetArtifactImportResult>;
}
export async function keepConversationDraft(target: number | { chatId: number }, draft: ConversationArtifactDraft, input?: {
  requestId?: string | null;
  sessionId?: string | null;
  trustManifest?: TrustManifest | null;
  dependencyRefs?: string[];
  refreshSpec?: ArtifactRefreshSpec | null;
}) {
  const path = typeof target === "number" ? `/api/projects/${target}/artifacts/keep-draft` : `/api/chats/${target.chatId}/artifacts/keep-draft`;
  return (await apiRequest("POST", path, {
    draft,
    requestId: input?.requestId ?? null,
    ...(typeof target === "number" ? { sessionId: input?.sessionId ?? null } : {}),
    trustManifest: input?.trustManifest ?? null,
    dependencyRefs: input?.dependencyRefs ?? [],
    refreshSpec: input?.refreshSpec ?? null,
  })).json() as Promise<ArtifactDetail>;
}
export async function keepConversationDraftVersion(artifactId: string, draft: ConversationArtifactDraft, input?: {
  requestId?: string | null;
  trustManifest?: TrustManifest | null;
  dependencyRefs?: string[];
  refreshSpec?: ArtifactRefreshSpec | null;
}) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/keep-draft-version`, {
    draft,
    requestId: input?.requestId ?? null,
    trustManifest: input?.trustManifest ?? null,
    dependencyRefs: input?.dependencyRefs ?? [],
    refreshSpec: input?.refreshSpec ?? null,
  })).json() as Promise<ArtifactDetail>;
}

export async function createArtifactVersion(artifactId: string, input: {
  baseVersion: number;
  content: ArtifactContent;
  actorType?: "user" | "conversation" | "system";
  requestId?: string | null;
  note?: string | null;
  trustManifest?: TrustManifest | null;
  dependencyRefs?: string[];
  refreshSpec?: ArtifactRefreshSpec | null;
}) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/versions`, input)).json() as Promise<ProjectArtifactVersionRecord>;
}
export async function compareArtifactVersions(artifactId: string, left: number, right: number): Promise<ArtifactComparison & { semantic?: ArtifactSemanticComparison | null }> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/compare/${left}/${right}`); if (!res.ok) throw new Error("Failed to compare Artifact versions."); return res.json();
}
export async function forkArtifact(artifactId: string, version?: number) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/fork`, version ? { version } : {})).json() as Promise<ArtifactDetail>;
}
export async function setArtifactStatus(artifactId: string, status: "active" | "archived") {
  return (await apiRequest("PATCH", `/api/artifacts/${encodeURIComponent(artifactId)}`, { status })).json() as Promise<ProjectArtifactRecord>;
}

export async function trashArtifact(artifactId: string): Promise<ProjectArtifactRecord> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/trash`, {})).json();
}

export async function restoreTrashedArtifact(artifactId: string): Promise<ProjectArtifactRecord> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/restore-trash`, {})).json();
}

export async function permanentlyDeleteArtifact(artifactId: string): Promise<void> {
  await apiRequest("DELETE", `/api/artifacts/${encodeURIComponent(artifactId)}/permanent`);
}
export async function undoArtifact(artifactId: string) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/undo`, {})).json() as Promise<ProjectArtifactVersionRecord>;
}
export async function createArtifactReference(artifactId: string, input: { version?: number | null; targetType: "project" | "session" | "chat" | "resource" | "artifact"; targetRef: string; label?: string | null }) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/references`, input)).json() as Promise<ArtifactReferenceRecord>;
}
export async function proposeArtifactChange(artifactId: string, input: { baseVersion: number; type: "spreadsheet_ai_diff" | "document_edit" | "artifact_patch"; summary: string; diffs?: SpreadsheetCellDiff[]; patch?: Record<string, unknown>; actorType?: "user" | "conversation"; requestId?: string | null }) {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/proposals`, input)).json() as Promise<ProjectArtifactProposalRecord>;
}
export async function decideArtifactProposal(proposalId: string, decision: "accept" | "reject") {
  return (await apiRequest("POST", `/api/artifact-proposals/${encodeURIComponent(proposalId)}/decision`, { decision })).json();
}
export async function getArtifactExportPlan(artifactId: string, version?: number): Promise<ArtifactExportPlan> {
  const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/export-plan${version ? `?version=${version}` : ""}`); if (!res.ok) throw new Error("Failed to load Artifact export plan."); return res.json();
}
export async function exportProjectArtifactPackage(projectId: number) {
  const res = await fetch(`/api/projects/${projectId}/artifact-package`); if (!res.ok) throw new Error("Failed to create Artifact package."); return res.json();
}

export interface DataArtifactQueryResult {
  mode: "duckdb" | "inline";
  rowCount: number;
  availableRowCount: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  columns?: unknown[];
  sample: Array<Record<string, unknown>>;
  summary?: unknown;
}

export async function queryDataArtifact(artifactId: string, input: { metric?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number } = {}): Promise<DataArtifactQueryResult> {
  return (await apiRequest("POST", `/api/artifacts/${encodeURIComponent(artifactId)}/data-query`, input)).json();
}

export async function importProjectArtifactPackage(projectId: number, pkg: unknown) {
  return (await apiRequest("POST", `/api/projects/${projectId}/artifact-package/import`, pkg)).json() as Promise<{
    importedArtifacts: number;
    importedSessions: number;
    artifactIdMap: Record<string, string>;
    sessionIdMap: Record<string, string>;
  }>;
}
