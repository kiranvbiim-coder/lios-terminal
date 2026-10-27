import type { ArtifactDetail } from "./useArtifacts";

/** A reviewed save is bound to one completed P11 engine receipt AND one
 * explicitly selected P4 destination. Never to editable input state. */
export interface ReviewedModelRunReceipt {
  runId: string;
  resultHash: string;
  datasetSnapshotId: string;
  datasetContentHash: string;
  inputHash?: string;
  deterministic: boolean;
}
export interface ModelRunSnapshotIdentity {
  receipt: ReviewedModelRunReceipt;
  result: { datasetSnapshotId: string; checks: { passed: boolean; circularConverged: boolean } };
}
export interface ReviewedModelDestination {
  projectId: number | null;
  owningChatId?: number;
  destinationLabel: string;
}
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns null for incomplete, nonconverged or untraceable engine work. */
export function modelRunReviewKey(
  model: ModelRunSnapshotIdentity | null | undefined,
  destination: ReviewedModelDestination | null | undefined,
): string | null {
  if (!model || !destination) return null;
  const { receipt, result } = model;
  if (!UUID.test(receipt.runId) || !UUID.test(receipt.datasetSnapshotId) ||
    !SHA.test(receipt.resultHash) || !SHA.test(receipt.datasetContentHash) ||
    (receipt.inputHash !== undefined && !SHA.test(receipt.inputHash)) ||
    receipt.deterministic !== true || result.datasetSnapshotId !== receipt.datasetSnapshotId ||
    !result.checks.passed || !result.checks.circularConverged ||
    (destination.projectId === null
      ? !Number.isSafeInteger(destination.owningChatId) || (destination.owningChatId ?? 0) <= 0
      : !Number.isSafeInteger(destination.projectId) || destination.projectId <= 0 || destination.owningChatId !== undefined)) return null;
  return JSON.stringify([
    receipt.runId, receipt.resultHash, receipt.datasetSnapshotId, receipt.datasetContentHash,
    receipt.inputHash ?? null, destination.projectId, destination.owningChatId ?? null,
  ]);
}

/** The reopening endpoint performs owner/source/entitlement and hash verification.
 * Compare the returned receipt against the exact reviewed visible version before
 * calling the save endpoint. No stale historical permission is granted here. */
export function verifiedReopenedModelRun(
  visible: ModelRunSnapshotIdentity,
  reopened: ModelRunSnapshotIdentity,
): boolean {
  const a = visible.receipt, b = reopened.receipt;
  return a.runId === b.runId && a.resultHash === b.resultHash &&
    a.datasetSnapshotId === b.datasetSnapshotId &&
    a.datasetContentHash === b.datasetContentHash &&
    (a.inputHash === undefined || a.inputHash === b.inputHash) &&
    a.deterministic === true && b.deterministic === true &&
    b.result.datasetSnapshotId === b.datasetSnapshotId &&
    b.result.checks.passed && b.result.checks.circularConverged;
}

/** Verify P4 returned the requested exact run/dataset receipt. A server POST
 * may already have committed when verification fails, so never auto-retry. */
export function savedModelArtifactMatchesReceipt(
  detail: ArtifactDetail,
  receipt: ReviewedModelRunReceipt,
  destination: ReviewedModelDestination,
): boolean {
  const artifact = detail.artifact;
  const version = detail.version;
  const refSet = new Set(version.sourceRefs);
  return artifact.id === version.artifactId &&
    artifact.projectId === destination.projectId &&
    (destination.projectId !== null || artifact.owningChatId === destination.owningChatId) &&
    artifact.kind === "spreadsheet" && artifact.origin === "engine" &&
    artifact.status === "active" && version.version > 0 && version.content.kind === "spreadsheet" &&
    refSet.has(`financial-model-run:${receipt.runId}`) &&
    refSet.has(`financial-model-result-sha256:${receipt.resultHash}`) &&
    refSet.has(`dataset-snapshot:${receipt.datasetSnapshotId}`) &&
    refSet.has(`dataset-content-sha256:${receipt.datasetContentHash}`);
}
