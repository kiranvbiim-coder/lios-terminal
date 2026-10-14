/**
 * The desktop shell reports how the window is composited. In software mode every animated
 * full-viewport layer repaints the whole window on the CPU, so ambient (decorative) motion
 * is suppressed there. Functional feedback (spinners, progress) is unaffected.
 */
export function isSoftwareRendered(
  desktop: { renderMode?: unknown } | undefined = typeof window === "undefined"
    ? undefined
    : (window as unknown as { limuriaDesktop?: { renderMode?: unknown } }).limuriaDesktop,
): boolean {
  return desktop?.renderMode === "software";
}

export function ambientMotionAllowed(
  preferences: { visualEnvironmentMotion: boolean; reducedMotion: boolean; lowResourceMode: boolean },
  softwareRendered: boolean,
): boolean {
  return preferences.visualEnvironmentMotion && !preferences.reducedMotion && !preferences.lowResourceMode && !softwareRendered;
}
