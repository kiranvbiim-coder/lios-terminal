/** Keep a usable Chat column when a resizable Artifact is beside it.
 * Narrow viewports use the CSS stacked layout and suppress the resize handle.
 * This helper never changes an Artifact, revision, Project or saved layout.
 */
export const MIN_CONVERSATION_WIDTH = 360;
export const MIN_ARTIFACT_WIDTH = 320;

export function clampConversationSidecarWidth(requested: number, containerWidth: number): number {
  const safeAvailable = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
  const maxAllowed = Math.max(
    MIN_ARTIFACT_WIDTH,
    Math.min(safeAvailable * 0.8, safeAvailable - MIN_CONVERSATION_WIDTH),
  );
  const desired = Number.isFinite(requested) ? requested : MIN_ARTIFACT_WIDTH;
  return Math.max(MIN_ARTIFACT_WIDTH, Math.min(Math.floor(maxAllowed), Math.round(desired)));
}
