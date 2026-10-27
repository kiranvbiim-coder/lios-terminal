/** WS-36: limit the Artifact resize to the real remaining Chat/Artifact surface. */
export const ARTIFACT_MIN_WIDTH = 320;
export const CHAT_MIN_WIDTH = 360;
export const ARTIFACT_MAX_FRACTION = 0.8;
export const ARTIFACT_KEYBOARD_STEP = 40;

export interface ArtifactSidecarBounds { min: number; max: number }

/**
 * Caller supplies measured inner conversation width (not window width).
 * If the surface is too narrow for a side-by-side layout, CSS/Focus owns
 * the single-pane display; never produce a negative or inverted drag range.
 */
export function artifactSidecarBounds(containerWidth: number): ArtifactSidecarBounds {
  const available = Number.isFinite(containerWidth) ? Math.max(0, Math.floor(containerWidth)) : 0;
  const max = Math.max(0, Math.min(Math.floor(available * ARTIFACT_MAX_FRACTION), available - CHAT_MIN_WIDTH));
  const min = Math.min(ARTIFACT_MIN_WIDTH, max);
  return { min, max };
}

export function clampArtifactSidecarWidth(width: number, containerWidth: number): number {
  const { min, max } = artifactSidecarBounds(containerWidth);
  const proposed = Number.isFinite(width) ? width : min;
  return Math.max(min, Math.min(max, Math.round(proposed)));
}

export function keyboardArtifactSidecarWidth(
  key: string, currentWidth: number, containerWidth: number, largeStep = false,
): number | null {
  const { min, max } = artifactSidecarBounds(containerWidth);
  if (key === "Home") return min;
  if (key === "End") return max;
  const step = largeStep ? ARTIFACT_KEYBOARD_STEP * 2 : ARTIFACT_KEYBOARD_STEP;
  // Width grows leftward because the sidecar docks on the right.
  if (key === "ArrowLeft") return clampArtifactSidecarWidth(currentWidth + step, containerWidth);
  if (key === "ArrowRight") return clampArtifactSidecarWidth(currentWidth - step, containerWidth);
  return null;
}

/** An exact loaded revision, not a current-head guess, may enter Workbench. */
export function canExpandArtifactRevision(
  actual: { artifactId: string; requestedVersion: number | null; version: number } | null,
  artifactId: string, requestedVersion: number | null, dirty: boolean,
): actual is { artifactId: string; requestedVersion: number | null; version: number } {
  return !dirty && actual !== null && actual.artifactId === artifactId
    && actual.requestedVersion === requestedVersion
    && Number.isSafeInteger(actual.version) && actual.version > 0
    && (requestedVersion === null || requestedVersion === actual.version);
}

/**
 * A load notification is presentation authority only for the exact object and
 * requested revision currently selected in Chat. In "latest" mode (null) the
 * revision must still be an actual positive saved version. No stale callback
 * can replace the parent shell's recorded Workbench handoff target.
 */
export function isCurrentArtifactLoad(
  loadedArtifactId: string,
  loadedRequest: number | null,
  loadedVersion: number,
  activeArtifactId: string,
  activeRequest: number | null,
): boolean {
  return loadedArtifactId === activeArtifactId
    && loadedRequest === activeRequest
    && Number.isSafeInteger(loadedVersion) && loadedVersion > 0
    && (activeRequest === null || loadedVersion === activeRequest);
}
