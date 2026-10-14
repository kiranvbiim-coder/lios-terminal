import type { ReactNode } from "react";

export type SourceSnapshot = {
  id: string;
  entityKey: string;
  provider: string;
  contentHash: string;
  availableAt: string;
  effectiveAt?: string | null;
  retrievedAt?: string;
  source?: string;
  datasetKey?: string;
};

export type SnapshotSelection = {
  selected: SourceSnapshot[];
  missing: string[];
  mismatched: string[];
};

export type ProvenanceStatus = {
  mode: "source-bound" | "manual-override";
  label: "SOURCE-BOUND" | "MANUAL OVERRIDE";
  missing: string[];
  mismatched: string[];
  snapshotIds: string[];
};

/** Select only snapshots that belong to the requested entities. A response
 * containing an unexpected entity is a mismatch, not a usable fallback. */
export function selectSnapshotsForEntities(entities: readonly string[], snapshots: readonly SourceSnapshot[]): SnapshotSelection {
  const byEntity = new Map<string, SourceSnapshot>();
  const mismatched: string[] = [];
  for (const snapshot of snapshots) {
    const key = snapshot.entityKey.trim().toUpperCase();
    if (!key) continue;
    const existing = byEntity.get(key);
    if (!existing || snapshot.availableAt > existing.availableAt) byEntity.set(key, snapshot);
  }
  const selected: SourceSnapshot[] = [];
  const missing: string[] = [];
  for (const entity of entities) {
    const key = entity.trim().toUpperCase();
    const snapshot = byEntity.get(key);
    if (!snapshot) {
      missing.push(entity);
    } else if (snapshot.entityKey.trim().toUpperCase() !== key) {
      mismatched.push(entity);
    } else {
      selected.push(snapshot);
    }
  }
  for (const snapshot of snapshots) {
    const key = snapshot.entityKey.trim().toUpperCase();
    if (!entities.some((entity) => entity.trim().toUpperCase() === key)) mismatched.push(snapshot.entityKey);
  }
  return { selected, missing: [...new Set(missing)], mismatched: [...new Set(mismatched)] };
}

export function resolveProvenanceStatus(input: {
  entities: readonly string[];
  snapshots: readonly SourceSnapshot[];
  manualOverride?: boolean;
}): ProvenanceStatus {
  const selection = selectSnapshotsForEntities(input.entities, input.snapshots);
  const complete = selection.missing.length === 0 && selection.mismatched.length === 0 && selection.selected.length === input.entities.length;
  const manual = Boolean(input.manualOverride) || !complete;
  return {
    mode: manual ? "manual-override" : "source-bound",
    label: manual ? "MANUAL OVERRIDE" : "SOURCE-BOUND",
    missing: selection.missing,
    mismatched: selection.mismatched,
    snapshotIds: selection.selected.map((snapshot) => snapshot.id),
  };
}

export function sourceBindingForSnapshot(snapshot: SourceSnapshot, field: string, contractFamily: string, priority: "primary" | "secondary" | "fallback" | "manual_override" = "primary") {
  const asOf = snapshot.effectiveAt ?? snapshot.availableAt;
  return {
    contractFamily,
    field,
    connectorId: `${snapshot.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-snapshot`,
    provider: snapshot.provider,
    priority,
    sourceReference: snapshot.source ?? `${snapshot.datasetKey ?? snapshot.entityKey}:${snapshot.contentHash}`,
    asOf,
    retrievedAt: snapshot.retrievedAt ?? snapshot.availableAt,
    freshness: "immutable_snapshot",
    snapshot: { id: snapshot.id, contentHash: snapshot.contentHash },
    transformations: [],
  } as const;
}

/** Add the shared advanced-quant provenance envelope without mutating the
 * submitted parameter object. */
export function withSourceBoundProvenance<T extends Record<string, unknown>>(
  parameters: T,
  snapshots: readonly SourceSnapshot[],
  contractFamily: string,
  fieldPrefix: string,
): T & { inputProvenance: Record<string, unknown> } {
  const sourceBindings = snapshots.map((snapshot, index) => sourceBindingForSnapshot(snapshot, `${fieldPrefix}[${index}]`, contractFamily));
  return {
    ...parameters,
    inputProvenance: {
      dataClassification: "historical",
      sourceBindings,
      transformations: ["selected immutable market snapshots for the active basket"],
    },
  };
}

export function SnapshotProvenanceStatus({
  status,
  snapshots,
  warning,
  children,
}: {
  status: ProvenanceStatus;
  snapshots?: readonly SourceSnapshot[];
  warning?: string;
  children?: ReactNode;
}) {
  const sourceBound = status.mode === "source-bound";
  const visibleSnapshots = snapshots ?? [];
  return (
    <div data-testid="snapshot-provenance-status" className={`border px-2 py-1.5 font-mono text-[7px] ${sourceBound ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className={sourceBound ? "text-emerald-300" : "text-amber-300"}>{status.label}</strong>
        <span className="text-muted-foreground">{status.snapshotIds.length} SNAPSHOT{status.snapshotIds.length === 1 ? "" : "S"}</span>
        {visibleSnapshots.slice(0, 3).map((snapshot) => (
          <span key={snapshot.id} className="text-muted-foreground" title={snapshot.contentHash}>
            {snapshot.provider} · SOURCE {snapshot.source ?? snapshot.datasetKey ?? "UNAVAILABLE"} · AS OF {(snapshot.effectiveAt ?? snapshot.availableAt).slice(0, 10)} · HASH {snapshot.contentHash.slice(0, 12)}
          </span>
        ))}
        {children}
      </div>
      {status.missing.length > 0 && <div className="mt-1 text-amber-200">MISSING SNAPSHOT INPUTS: {status.missing.join(", ")}</div>}
      {status.mismatched.length > 0 && <div className="mt-1 text-rose-300">SNAPSHOT CONTEXT MISMATCH: {status.mismatched.join(", ")}</div>}
      {warning && <div className="mt-1 text-amber-200">{warning}</div>}
    </div>
  );
}
