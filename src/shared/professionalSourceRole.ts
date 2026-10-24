import type { ArtifactContent } from "./artifactContracts";

/** A report source role is presentation metadata, not permission. A caller
 * cannot relabel an unrelated Artifact as a Decision just to imply review. */
export function isProfessionalDecisionSourceRoleAccurate(
  kind: ArtifactContent["kind"],
  role: string,
): boolean {
  return role !== "decision" || kind === "decision";
}

export function assertProfessionalDecisionSourceRole(
  kind: ArtifactContent["kind"],
  role: string,
): void {
  if (!isProfessionalDecisionSourceRoleAccurate(kind, role)) {
    throw new Error("Only a Decision Artifact can be labeled as a decision source. Select evidence or another accurate source role.");
  }
}
