export function belongsToOrganization(
  resourceOrganizationId: number | null | undefined,
  actorOrganizationId: number | null | undefined,
): boolean {
  return actorOrganizationId != null && resourceOrganizationId === actorOrganizationId;
}
