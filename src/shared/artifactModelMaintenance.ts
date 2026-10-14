import type { IntegratedModelAssumptions, SpecializedModelSchedules } from "./integratedFinancialModel";
import type { ProjectArtifact, ProjectArtifactVersion } from "./schema";

export interface ArtifactModelMaintenanceHead { version: number; contentHash: string }
export interface ArtifactModelMaintenanceRequest extends ArtifactModelMaintenanceHead { targetDatasetSnapshotId: string; targetContentHash: string }
export interface ArtifactModelMaintenanceApplyRequest extends ArtifactModelMaintenanceRequest { reviewHash: string }
export interface ArtifactModelMaintenancePeriod { fiscalYear: string; period: string; periodEnd: string }
export interface ArtifactModelMaintenanceTarget {
  id: string; contentHash: string; symbol: string; currency: string | null; availableAt: string; provider: string; source: string;
  periods: ArtifactModelMaintenancePeriod[]; entitlementPolicyId: string; entitlementPolicyHash: string;
}
export interface ArtifactModelMaintenanceSource { runId: string; datasetSnapshotId: string; datasetContentHash: string; periods: ArtifactModelMaintenancePeriod[] }
export interface ArtifactModelMaintenanceOptions extends ArtifactModelMaintenanceHead {
  artifactId: string; engineRev: string; source: ArtifactModelMaintenanceSource; targets: ArtifactModelMaintenanceTarget[]; canApply: true;
}
export interface ArtifactModelMaintenanceChange {
  kind: "added" | "changed"; periodKey: string; path: string; before: string | number | null; after: string | number | null; oldSourceHash: string; newSourceHash: string;
}
export interface ArtifactModelMaintenancePreservedCell {
  sheetId: string; cell: string; raw: string; format: string | null; reason: "formula" | "user_override" | "custom";
}
export interface ArtifactModelMaintenanceReview extends ArtifactModelMaintenanceRequest {
  artifactId: string; reviewHash: string; engineRev: string; source: ArtifactModelMaintenanceSource; target: ArtifactModelMaintenanceTarget;
  assumptions: IntegratedModelAssumptions; schedules: SpecializedModelSchedules; inputHash: string;
  changes: ArtifactModelMaintenanceChange[]; preservedCells: ArtifactModelMaintenancePreservedCell[]; sourceRefs: string[];
}
export interface ArtifactModelMaintenanceResult {
  review: ArtifactModelMaintenanceReview; artifact: ProjectArtifact; version: ProjectArtifactVersion;
  receipt: { runId: string; resultHash: string; datasetSnapshotId: string; datasetContentHash: string; reviewHash: string; replayed: boolean };
}
