/**
 * UI-only lookup for the exact saved P9 workflow displayed in the current
 * Project. P6 continuity must never turn an opaque workflow ID into an
 * unscoped document query or imply a review occurred by scrolling to a generic
 * Automations panel. These functions do not fetch, change or execute anything.
 */
export function findProjectWorkflowRow(
  root: ParentNode,
  projectId: number,
  workflowId: string,
): HTMLElement | null {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 ||
      !workflowId || workflowId.trim() !== workflowId) return null;
  for (const panel of root.querySelectorAll<HTMLElement>(
    "[data-p9-continuous-intelligence][data-p9-project-id]",
  )) {
    if (panel.getAttribute("data-p9-project-id") !== String(projectId)) continue;
    for (const row of panel.querySelectorAll<HTMLElement>("[data-p9-workflow-id]")) {
      if (row.getAttribute("data-p9-workflow-id") === workflowId) return row;
    }
  }
  return null;
}

/**
 * A focus handoff only after an exact current Project + workflow match.
 * No fallback to another Project, generic section or inferred row. Focus is
 * screen-reader observable and the scroll respects OS reduced-motion choice.
 */
export function focusProjectWorkflowRow(
  root: ParentNode,
  projectId: number,
  workflowId: string,
  reducedMotion: boolean,
): boolean {
  const row = findProjectWorkflowRow(root, projectId, workflowId);
  if (!row) return false;
  row.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
  row.focus({ preventScroll: true });
  return true;
}
