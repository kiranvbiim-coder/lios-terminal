import { useState, type ReactNode } from "react";

interface FormulaTooltipProps {
  formula: string;
  children: ReactNode;
  className?: string;
}

// Small hover affordance that reveals the underlying formula for a computed
// value or ratio label -- lets a dense terminal panel stay dense while still
// answering "how is this calculated?" without a separate reference doc.
export function FormulaTooltip({ formula, children, className = "" }: FormulaTooltipProps) {
  const [show, setShow] = useState(false);
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="border-b border-dotted border-muted-foreground/50 cursor-help">{children}</span>
      {show && (
        <span className="absolute z-50 left-0 top-full mt-1 whitespace-nowrap bg-[#0c0c0c] border border-[hsl(38,95%,50%)/40%] px-2 py-1 font-terminal text-[8px] text-[hsl(38,95%,60%)] shadow-[0_2px_12px_rgba(0,0,0,0.6)] pointer-events-none">
          ƒ {formula}
        </span>
      )}
    </span>
  );
}
