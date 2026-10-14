import type { ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useGuidedMode } from "@/hooks/use-guided-mode";
import type { TerminalCapability } from "@/lib/terminalCatalog";

interface GuidedExplainerProps {
  /** Plain-language description, always shown when guidance is available. */
  description: string;
  /** The real question a user is trying to answer -- shown above the description when present. */
  userQuestion?: string;
  /** Why this matters to the decision the user is trying to make. */
  why?: string;
  /** What the user walks away with after using it. */
  outcome?: string;
  /** What can go wrong, or what the result does not mean. */
  risks?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a trigger element (a tile, a search result, a button) with a
 * "why this matters / what you get" explanation -- but ONLY when Guided
 * experience mode is on (Settings -> Experience). In Professional mode
 * (the default) this renders `children` completely unwrapped: zero visual
 * or DOM overhead, matching the terminal's existing density.
 *
 * Deliberately built on the hover-card primitive, not a forced-open modal
 * or popup -- Limuria's UX Philosophy explicitly warns against "unnecessary
 * popups"; this only ever appears on deliberate hover/focus, and only for
 * users who opted into Guided mode.
 */
export function GuidedExplainer({ description, userQuestion, why, outcome, risks, children, className }: GuidedExplainerProps) {
  const guided = useGuidedMode();
  if (!guided || (!why && !outcome)) return <>{children}</>;

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span className={className}>{children}</span>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        className="w-80 border border-[hsl(38,95%,50%)]/25 bg-[#0a0a0a] p-3 font-terminal text-[9px] leading-relaxed text-muted-foreground shadow-[0_4px_20px_rgba(0,0,0,0.7)]"
      >
        {userQuestion && <p className="italic text-foreground/90">"{userQuestion}"</p>}
        <p className={userQuestion ? "mt-2 text-foreground" : "text-foreground"}>{description}</p>
        {why && (
          <p className="mt-2">
            <span className="font-bold uppercase tracking-wide text-[hsl(38,95%,55%)]">Why it matters — </span>
            {why}
          </p>
        )}
        {outcome && (
          <p className="mt-1.5">
            <span className="font-bold uppercase tracking-wide text-cyan-400/90">What you get — </span>
            {outcome}
          </p>
        )}
        {risks && (
          <p className="mt-1.5">
            <span className="font-bold uppercase tracking-wide text-red-400/80">Worth knowing — </span>
            {risks}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/** Convenience wrapper for the common case of explaining a TerminalCapability. */
export function GuidedCapabilityExplainer({ capability, children, className }: { capability: TerminalCapability; children: ReactNode; className?: string }) {
  return (
    <GuidedExplainer
      description={capability.description}
      userQuestion={capability.guidance?.userQuestion}
      why={capability.guidance?.why}
      outcome={capability.guidance?.outcome}
      risks={capability.guidance?.risks}
      className={className}
    >
      {children}
    </GuidedExplainer>
  );
}
