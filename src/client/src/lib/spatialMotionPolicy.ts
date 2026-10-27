/**
 * Phase 2 decorative motion budget for the existing spatial research surface.
 * One shared renderer; no WebGL loops or event-driven background processes.
 */
export type SpatialMotionBudget = "still" | "subtle";

export interface SpatialMotionInput {
  visualEnvironmentsEnabled: boolean;
  visualEnvironmentMotion: boolean;
  reducedMotion: boolean;
  lowResourceMode: boolean;
  softwareRendered: boolean;
}

export function resolveSpatialMotionBudget(input: SpatialMotionInput): SpatialMotionBudget {
  if (!input.visualEnvironmentsEnabled || !input.visualEnvironmentMotion) return "still";
  if (input.reducedMotion || input.lowResourceMode || input.softwareRendered) return "still";
  return "subtle";
}
