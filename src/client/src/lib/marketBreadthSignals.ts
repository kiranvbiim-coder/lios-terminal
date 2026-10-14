export type BreadthSignalTone = "positive" | "negative" | "neutral" | "unavailable";

export interface BreadthSignal {
  label: string;
  detail: string;
  tone: BreadthSignalTone;
}

export function interpretAdvanceDecline(advances: number, declines: number): BreadthSignal {
  const difference = advances - declines;
  if (difference > 0) {
    return { label: `ADVANCERS +${difference}`, detail: "More constituents advanced than declined", tone: "positive" };
  }
  if (difference < 0) {
    return { label: `DECLINERS +${Math.abs(difference)}`, detail: "More constituents declined than advanced", tone: "negative" };
  }
  return { label: "BALANCED", detail: "Advancers and decliners are even", tone: "neutral" };
}

export function interpretHighLow(newHighs: number, newLows: number): BreadthSignal {
  const difference = newHighs - newLows;
  if (difference > 0) {
    return { label: `HIGHS +${difference}`, detail: "New highs outnumber new lows", tone: "positive" };
  }
  if (difference < 0) {
    return { label: `LOWS +${Math.abs(difference)}`, detail: "New lows outnumber new highs", tone: "negative" };
  }
  return { label: "BALANCED", detail: "New highs and new lows are even", tone: "neutral" };
}

export function interpretTrin(value: number | null | undefined): BreadthSignal {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: "UNAVAILABLE", detail: "TRIN cannot be computed from the current observations", tone: "unavailable" };
  }
  if (value < 1) {
    return { label: "ADVANCER VOLUME LEAD", detail: "TRIN below 1.0: volume favors advancing constituents", tone: "positive" };
  }
  if (value > 1) {
    return { label: "DECLINER VOLUME LEAD", detail: "TRIN above 1.0: volume favors declining constituents", tone: "negative" };
  }
  return { label: "BALANCED VOLUME", detail: "TRIN equals 1.0: advancing and declining volume are balanced", tone: "neutral" };
}

export function interpretMcClellan(value: number | null | undefined): BreadthSignal {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: "UNAVAILABLE", detail: "McClellan oscillator cannot be computed from the current observations", tone: "unavailable" };
  }
  if (value > 0) {
    return { label: "MOMENTUM EXPANDING", detail: "Net-advance momentum is positive", tone: "positive" };
  }
  if (value < 0) {
    return { label: "MOMENTUM CONTRACTING", detail: "Net-advance momentum is negative", tone: "negative" };
  }
  return { label: "MOMENTUM FLAT", detail: "Net-advance momentum is neutral", tone: "neutral" };
}

export function breadthSignalClass(tone: BreadthSignalTone): string {
  if (tone === "positive") return "text-up border-border bg-white/[0.015]";
  if (tone === "negative") return "text-down border-border bg-white/[0.015]";
  return "text-muted-foreground border-border bg-white/[0.015]";
}
