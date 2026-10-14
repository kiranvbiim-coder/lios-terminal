export type TerminalExperienceMode = "guided" | "professional";
export type TerminalDensity = "terminal" | "compact" | "standard" | "comfortable";
export type TerminalTextScale = "small" | "normal" | "large";

export interface TerminalUxPreferences {
  experienceMode: TerminalExperienceMode;
  density: TerminalDensity;
  focusMode: boolean;
  presentationMode: boolean;
  comfortMode: boolean;
  adaptiveCalm: boolean;
  ambientContext: boolean;
  visualEnvironmentsEnabled: boolean;
  visualEnvironmentMotion: boolean;
  lowResourceMode: boolean;
  showImmersiveDock: boolean;
  reducedMotion: boolean;
  textScale: TerminalTextScale;
  showTickerTape: boolean;
  showMacroTickerTape: boolean;
  showJourneyPrompts: boolean;
  contextRailAutoOpen: boolean;
  /**
   * Opt-in ambient badge (default off) surfacing the Wave D Action Inbox
   * count from anywhere in the shell, including the clean Projects
   * landing -- LIOS_EXECUTION_ROADMAP.md LIOS-P9-09, "notification
   * relevance/threshold policy so automation does not become noisy".
   * Off by default so it is never noise until a user deliberately opts in.
   */
  proactivePulseEnabled: boolean;
}

export const TERMINAL_UX_STORAGE_KEY = "limuria-terminal-ux-preferences-v2";
export const LEGACY_TERMINAL_UX_STORAGE_KEYS = ["limuria-terminal-ux-preferences-v1"] as const;
const EVENT_NAME = "lios:ux-preferences";

export const DEFAULT_TERMINAL_UX_PREFERENCES: TerminalUxPreferences = {
  experienceMode: "professional",
  density: "standard",
  focusMode: false,
  presentationMode: false,
  comfortMode: false,
  adaptiveCalm: true,
  ambientContext: true,
  visualEnvironmentsEnabled: false,
  visualEnvironmentMotion: true,
  lowResourceMode: false,
  showImmersiveDock: false,
  reducedMotion: false,
  textScale: "normal",
  showTickerTape: false,
  showMacroTickerTape: false,
  showJourneyPrompts: false,
  contextRailAutoOpen: false,
  proactivePulseEnabled: false,
};

/**
 * Retail starts quiet. Depth is still available from Settings/shortcuts, but
 * a first-time customer should see the analytical canvas before terminal
 * chrome. Existing saved preferences always win over these defaults.
 */
export const DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES: TerminalUxPreferences = {
  ...DEFAULT_TERMINAL_UX_PREFERENCES,
  showImmersiveDock: false,
  showTickerTape: false,
  showMacroTickerTape: false,
  showJourneyPrompts: false,
};

function isPreferences(value: unknown): value is Partial<TerminalUxPreferences> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeTerminalUxPreferences(
  value: unknown,
  defaults: TerminalUxPreferences = DEFAULT_TERMINAL_UX_PREFERENCES,
): TerminalUxPreferences {
  const candidate = isPreferences(value) ? value : {};
  const rawDensity = (candidate as { density?: unknown }).density;
  const density: TerminalDensity = rawDensity === "terminal"
    ? "terminal"
    : rawDensity === "compact"
      ? "compact"
      : rawDensity === "comfortable" || rawDensity === "spacious"
        ? "comfortable"
        : rawDensity === "standard"
          ? "standard"
          : defaults.density;
  const booleanOrDefault = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;

  return {
    experienceMode: candidate.experienceMode === "guided" || candidate.experienceMode === "professional"
      ? candidate.experienceMode
      : defaults.experienceMode,
    density,
    focusMode: booleanOrDefault(candidate.focusMode, defaults.focusMode),
    presentationMode: booleanOrDefault(candidate.presentationMode, defaults.presentationMode),
    comfortMode: booleanOrDefault(candidate.comfortMode, defaults.comfortMode),
    adaptiveCalm: booleanOrDefault(candidate.adaptiveCalm, defaults.adaptiveCalm),
    ambientContext: booleanOrDefault(candidate.ambientContext, defaults.ambientContext),
    visualEnvironmentsEnabled: booleanOrDefault(candidate.visualEnvironmentsEnabled, defaults.visualEnvironmentsEnabled),
    visualEnvironmentMotion: booleanOrDefault(candidate.visualEnvironmentMotion, defaults.visualEnvironmentMotion),
    lowResourceMode: booleanOrDefault(candidate.lowResourceMode, defaults.lowResourceMode),
    showImmersiveDock: booleanOrDefault(candidate.showImmersiveDock, defaults.showImmersiveDock),
    reducedMotion: booleanOrDefault(candidate.reducedMotion, defaults.reducedMotion),
    textScale: candidate.textScale === "small" || candidate.textScale === "normal" || candidate.textScale === "large" ? candidate.textScale : defaults.textScale,
    showTickerTape: booleanOrDefault(candidate.showTickerTape, defaults.showTickerTape),
    showMacroTickerTape: booleanOrDefault(candidate.showMacroTickerTape, defaults.showMacroTickerTape),
    showJourneyPrompts: booleanOrDefault(candidate.showJourneyPrompts, defaults.showJourneyPrompts),
    contextRailAutoOpen: booleanOrDefault(candidate.contextRailAutoOpen, defaults.contextRailAutoOpen),
    proactivePulseEnabled: booleanOrDefault(candidate.proactivePulseEnabled, defaults.proactivePulseEnabled),
  };
}

export function loadTerminalUxPreferences(
  defaults: TerminalUxPreferences = DEFAULT_TERMINAL_UX_PREFERENCES,
): TerminalUxPreferences {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const stored = window.localStorage.getItem(TERMINAL_UX_STORAGE_KEY);
    if (stored) {
      try {
        return normalizeTerminalUxPreferences(JSON.parse(stored), defaults);
      } catch {
        try { window.localStorage.removeItem(TERMINAL_UX_STORAGE_KEY); } catch {}
      }
    }

    for (const legacyKey of LEGACY_TERMINAL_UX_STORAGE_KEYS) {
      const legacyRaw = window.localStorage.getItem(legacyKey);
      if (!legacyRaw) continue;

      let legacy: TerminalUxPreferences;
      try {
        legacy = normalizeTerminalUxPreferences(JSON.parse(legacyRaw), defaults);
      } catch {
        try { window.localStorage.removeItem(legacyKey); } catch {}
        continue;
      }
      const migrated: TerminalUxPreferences = {
        ...legacy,
        focusMode: false,
        presentationMode: false,
        showImmersiveDock: defaults.showImmersiveDock,
        showTickerTape: defaults.showTickerTape,
        showMacroTickerTape: defaults.showMacroTickerTape,
        showJourneyPrompts: defaults.showJourneyPrompts,
      };
      window.localStorage.setItem(TERMINAL_UX_STORAGE_KEY, JSON.stringify(migrated));
      for (const key of LEGACY_TERMINAL_UX_STORAGE_KEYS) window.localStorage.removeItem(key);
      return migrated;
    }

    return { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function saveTerminalUxPreferences(preferences: TerminalUxPreferences): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeTerminalUxPreferences(preferences);
  try {
    window.localStorage.setItem(TERMINAL_UX_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Hardened/private browser context: keep the current in-memory preference state.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function patchTerminalUxPreferences(
  current: TerminalUxPreferences,
  patch: Partial<TerminalUxPreferences>,
): TerminalUxPreferences {
  return normalizeTerminalUxPreferences({ ...current, ...patch });
}

export function subscribeTerminalUxPreferences(listener: (preferences: TerminalUxPreferences) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    listener(normalizeTerminalUxPreferences(detail));
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
