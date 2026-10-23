export const LIOS_FIRST_USE_CONTRACT = Object.freeze({
  identityIsOnlyEntryGate: true,
  connectionsRequiredToEnter: false,
  primaryAction: "ask" as const,
  optionalConnectionAction: "Connect data or AI (optional)",
  continueAction: "Continue to LiOS",
  noConnectionStatus: "Ready without setup",
  connectedStatus: "Sources ready",
  noConnectionDetail: "Start now. Connect data or AI only when a task needs it.",
  connectedDetail: "Your connected sources are ready. You can adjust source order or add more at any time.",
  shellHint: "Ask in your own words. Sources and AI are optional to configure now; LiOS will show unavailable evidence or capabilities rather than invent an answer.",
  recoveryPreservesTask: true,
});

export type FirstUseConnectionState = "unconfigured" | "connected";

export function firstUseConnectionState(connectedCount: number): FirstUseConnectionState {
  return Number.isFinite(connectedCount) && connectedCount > 0 ? "connected" : "unconfigured";
}

/**
 * First-use examples are safe drafts, not simulated answers or unapproved
 * provider calls. Universal topics precede specialist finance examples.
 * A sample request must never assume the account has a model or connected data.
 */
export const FIRST_USE_UNIVERSAL_STARTERS = [
  {
    id: "explain-any-topic",
    label: "Explain a topic",
    description: "Build a simple explanation and identify what needs checking.",
    prompt: "Explain [topic] in plain language, with a clear example. Distinguish established facts from anything that needs verification or a connected source.",
  },
  {
    id: "plan-a-project",
    label: "Plan a task",
    description: "Break a goal into practical steps, risks and decisions.",
    prompt: "Help me plan [goal]. Ask for essential missing context, propose practical next steps, and flag any decisions that require my approval.",
  },
  {
    id: "explore-an-idea",
    label: "Compare approaches",
    description: "Explore tradeoffs without needing a file or account connection.",
    prompt: "Compare two approaches to [problem]. Show tradeoffs, assumptions and what information would change the recommendation.",
  },
] as const;

/** Only known recovery actions enter optional setup. Never execute arbitrary text. */
export function firstUseRecoveryDestination(action: string): "connections" | "compose" {
  const normalized = action.trim().toLowerCase().replace(/\s+/g, " ");
  return /^(?:connect\b.*|configure ai\b.*|set up ai\b.*|open connection center|open connections|open connect)$/.test(normalized)
    ? "connections"
    : "compose";
}
