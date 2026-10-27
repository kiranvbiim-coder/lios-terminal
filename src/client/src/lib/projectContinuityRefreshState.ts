/**
 * Presentation-only guards for an explicitly requested P6 continuity refresh.
 *
 * The authoritative Project scope and saved snapshot remain on the server.
 * These helpers neither authorize nor issue requests. They prevent a returned
 * message from one Project being presented in a different Project, and stop
 * duplicate clicks while that exact Project's request is pending.
 */
export interface ProjectRefreshNotice {
  projectId: number;
  text: string;
}

export function canBeginProjectRefresh(inFlight: ReadonlySet<number>, projectId: number): boolean {
  return Number.isSafeInteger(projectId) && projectId > 0 && !inFlight.has(projectId);
}

export function visibleProjectRefreshNotice(
  notice: ProjectRefreshNotice | null,
  projectId: number,
): string | null {
  return notice?.projectId === projectId ? notice.text : null;
}
