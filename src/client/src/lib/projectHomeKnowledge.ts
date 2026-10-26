import type { ProjectChat, ProjectResource, ProjectSession } from "./useProjects";

export type ProjectResourceContextMode = ProjectResource["contextMode"];

export const PROJECT_RESOURCE_CONTEXT_OPTIONS = [
  { value: "project", label: "Include in Project context", detail: "Eligible for automatic Project context retrieval, subject to current owner, source rights and policy." },
  { value: "on_demand", label: "Use only when requested", detail: "Not automatically included; a later explicit task may request it under current server rights." },
  { value: "excluded", label: "Exclude from Project context", detail: "Kept as a saved Project resource but excluded from routine Project context. This does not delete external source data." },
] as const;

export function projectResourceContextOption(mode: ProjectResourceContextMode) {
  return PROJECT_RESOURCE_CONTEXT_OPTIONS.find(x => x.value === mode)!;
}

/** Read-only local discovery over already owner-authorized ProjectHome input.
 * Refuse foreign Project records even if the caller accidentally passes
 * cached rows from another selected Project. No cross-Project search API. */
export function findProjectHomeItems(
  projectId: number,
  chats: readonly ProjectChat[],
  resources: readonly ProjectResource[],
  sessions: readonly ProjectSession[],
  text: string,
) {
  const needle = text.trim().toLocaleLowerCase();
  const matches = (...parts: string[]) =>
    !needle || parts.some(part => part.toLocaleLowerCase().includes(needle));
  return {
    chats: chats.filter(item => item.projectId === projectId && item.scope === "project"
      && item.status === "active" && matches(item.title)),
    resources: resources.filter(item => item.projectId === projectId && item.status === "active"
      && matches(item.label, item.kind, projectResourceContextOption(item.contextMode).label, item.contextMode.replaceAll("_", " "))),
    sessions: sessions.filter(item => item.projectId === projectId && item.status === "active"
      && matches(item.name)),
  };
}

/** The view may propose a single context-mode change, but the existing
 * project-bound PATCH route is the only mutation authority. */
export function mayEditProjectResourceContext(
  projectId: number,
  resource: ProjectResource | undefined,
  mode: ProjectResourceContextMode,
): boolean {
  return Number.isSafeInteger(projectId) && projectId > 0
    && !!resource && resource.projectId === projectId
    && resource.status === "active"
    && resource.contextMode !== mode
    && PROJECT_RESOURCE_CONTEXT_OPTIONS.some(option => option.value === mode);
}

export function contextChangeConfirmation(
  resourceLabel: string,
  from: ProjectResourceContextMode,
  to: ProjectResourceContextMode,
) {
  const destination = projectResourceContextOption(to);
  return `Change the saved resource "${resourceLabel}" from "${projectResourceContextOption(from).label}" to "${destination.label}"? ${destination.detail} This changes only this Project resource after server authorization and does not authorize a workflow rerun.`;
}