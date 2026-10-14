import { useEffect, useState } from "react";
import { loadTerminalUxPreferences, subscribeTerminalUxPreferences } from "@/lib/terminalUxPreferences";

/**
 * Whether the terminal is currently in Guided experience mode (Settings ->
 * Experience). Guided mode is opt-in and defaults to off (Professional) --
 * see DEFAULT_TERMINAL_UX_PREFERENCES. Components use this to decide
 * whether to surface additional "why this matters / what you'll get"
 * explanation without changing Professional mode's density at all.
 */
export function useGuidedMode(): boolean {
  const [guided, setGuided] = useState(() => loadTerminalUxPreferences().experienceMode === "guided");

  useEffect(() => {
    setGuided(loadTerminalUxPreferences().experienceMode === "guided");
    return subscribeTerminalUxPreferences((preferences) => setGuided(preferences.experienceMode === "guided"));
  }, []);

  return guided;
}
