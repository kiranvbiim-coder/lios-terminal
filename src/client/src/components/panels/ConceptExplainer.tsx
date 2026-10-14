import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";

interface ConceptExplainerProps {
  /** e.g. "UNDERSTANDING FRACTALS", "WHAT IS TUNNELING?" */
  title: string;
  children: ReactNode;
}

/**
 * Shared "what is this concept" block for dense quant panels -- a permanent
 * (not hover-only) plain-English explanation of the model/statistic on the
 * panel, placed at the bottom of the panel sidebar so it doesn't compete
 * with the numbers themselves. Originally hand-copied into four panels
 * (Entropy, Fractal, Portfolio Optimizer, Quantum Finance); extracted here
 * so new panels reuse the same pattern instead of re-copying markup.
 *
 * Always visible, not gated on Guided mode -- unlike GuidedExplainer's
 * hover cards, this isn't a popup: it's a stable, always-present part of
 * these panels' own layout, same as the original hand-rolled version.
 */
export function ConceptExplainer({ title, children }: ConceptExplainerProps) {
  return (
    <div className="border border-border/80 bg-[#080808] p-3 text-[8.5px] font-terminal text-muted-foreground leading-normal space-y-1">
      <div className="flex items-center gap-1 text-[9px] text-foreground font-bold border-b border-border/60 pb-1">
        <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
