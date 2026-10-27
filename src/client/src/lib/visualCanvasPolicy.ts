import type { VisualIntensity } from "./visualEnvironment";

/** Visual-only budget; never changes source, permissions, model, or finance data. */
export interface VisualCanvasPolicyInput {
  enabled: boolean;
  intensity: VisualIntensity;
  lowResourceMode: boolean;
  softwareRendered: boolean;
}

export interface VisualCanvasPolicy {
  renderScene: boolean;
  useLowResourceAsset: boolean;
  preloadScene: boolean;
}

/**
 * Focus and explicit visual opt-out are a truly solid backdrop, not a nearly
 * invisible full-screen decoded SVG. Software rendering gets the smaller SVG
 * and no speculative decode. OS/app motion preferences remain separately
 * governed by ambientMotionAllowed + CSS, not by this asset policy.
 */
export function resolveVisualCanvasPolicy(input: VisualCanvasPolicyInput): VisualCanvasPolicy {
  const renderScene = input.enabled && input.intensity !== "focus";
  const useLowResourceAsset = input.lowResourceMode || input.softwareRendered;
  return {
    renderScene,
    useLowResourceAsset,
    preloadScene: renderScene && !useLowResourceAsset,
  };
}

export type VisualIntensityPreference = "auto" | "immersive" | "contextual" | "focus";

/**
 * The user can lower environmental intensity at any time. Even an explicit
 * Immersive selection cannot escalate an active reading/Workbench view beyond
 * its semantic baseline: charts and text always take priority over a scene.
 */
export function resolveVisualIntensity(
  baseline: VisualIntensity,
  preference: VisualIntensityPreference,
  forceFocus: boolean,
): VisualIntensity {
  if (forceFocus || preference === "focus") return "focus";
  if (preference === "contextual") return "contextual";
  if (preference === "immersive") return baseline === "immersive" ? "immersive" : "contextual";
  return baseline;
}
