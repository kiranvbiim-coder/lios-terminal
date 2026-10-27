import type { P6ChangeSummary } from "@shared/p6ContinuityContracts";

/**
 * Read-only UI projection of the existing P6 retained snapshot comparison.
 * Counts are aggregates: sourceRefs MUST NOT be assigned an added/changed/removed
 * status, because the P6 contract does not carry a per-source delta.
 */
export function projectChangePresentation(summary: P6ChangeSummary | null) {
  if (!summary) return {
    status: "unavailable" as const,
    total: null,
    added: null,
    changed: null,
    removed: null,
    sourceRefs: [] as string[],
    fromSnapshotId: null,
    toSnapshotId: null,
  };
  const { added, changed, removed } = summary;
  return {
    status: added + changed + removed > 0 ? "changed" as const : "unchanged" as const,
    total: added + changed + removed,
    added,
    changed,
    removed,
    // Keep recorded references exactly; display pagination is owned by the UI.
    sourceRefs: [...summary.sourceRefs],
    fromSnapshotId: summary.fromSnapshotId,
    toSnapshotId: summary.toSnapshotId,
  };
}
