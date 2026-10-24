import type { ArtifactComparison } from "@shared/artifactContracts";
import type { ArtifactDetail, ProjectArtifactVersionRecord } from "./useArtifacts";

/** Exact identity to bind asynchronous history actions to one displayed P4 revision. */
export interface ArtifactHistoryAnchor {
  artifactId: string;
  displayedVersion: number;
  headVersion: number;
  contentHash: string;
}

/** A prior placeholder, another Chat's content or a different revision is never displayable. */
export function exactArtifactHistoryDetail(
  detail: ArtifactDetail | undefined,
  artifactId: string,
  requestedVersion: number | null | undefined,
  projectId: number | null,
  owningChatId: number | null | undefined,
  isPlaceholder: boolean,
): ArtifactDetail | null {
  if (!detail || isPlaceholder || detail.artifact.id !== artifactId
    || detail.version.artifactId !== artifactId
    || (requestedVersion !== null && requestedVersion !== undefined && detail.version.version !== requestedVersion)
    || detail.version.version > detail.artifact.headVersion
    || detail.artifact.kind !== detail.version.content.kind
    || (projectId !== null && detail.artifact.projectId !== projectId)
    || (projectId === null && owningChatId != null
      && (detail.artifact.projectId !== null || detail.artifact.owningChatId !== owningChatId))) return null;
  return detail;
}

export function artifactHistoryAnchor(detail: ArtifactDetail): ArtifactHistoryAnchor {
  return {
    artifactId: detail.artifact.id,
    displayedVersion: detail.version.version,
    headVersion: detail.artifact.headVersion,
    contentHash: detail.version.contentHash,
  };
}

export function sameArtifactHistoryAnchor(a: ArtifactHistoryAnchor, b: ArtifactHistoryAnchor): boolean {
  return a.artifactId === b.artifactId
    && a.displayedVersion === b.displayedVersion
    && a.headVersion === b.headVersion
    && a.contentHash === b.contentHash;
}

export function canRestoreArtifactHistory(
  anchor: ArtifactHistoryAnchor,
  target: ProjectArtifactVersionRecord | undefined,
  hasUnsavedEdits: boolean,
  busy: boolean,
): boolean {
  return !busy && !hasUnsavedEdits
    && anchor.displayedVersion === anchor.headVersion
    && anchor.headVersion > 1
    && target !== undefined && target.artifactId === anchor.artifactId
    && Number.isSafeInteger(target.version)
    && target.version > 0 && target.version < anchor.headVersion;
}

/**
 * Validate server comparison against both immutable saved hashes. The
 * versions list is the access-checked catalog, not a source of new content.
 */
export function exactArtifactHistoryComparison(
  comparison: ArtifactComparison,
  anchor: ArtifactHistoryAnchor,
  left: ProjectArtifactVersionRecord | undefined,
  right: ProjectArtifactVersionRecord | undefined,
): boolean {
  return !!left && !!right
    && comparison.artifactId === anchor.artifactId
    && left.artifactId === anchor.artifactId
    && right.artifactId === anchor.artifactId
    && comparison.leftVersion === left.version
    && comparison.rightVersion === right.version
    && right.version === anchor.displayedVersion
    && right.contentHash === anchor.contentHash
    && comparison.leftHash === left.contentHash
    && comparison.rightHash === right.contentHash;
}
