import type { Quote } from "./finance";

export type ScanType = "golden_cross" | "breakout_52w" | "rsi_oversold" | "rsi_overbought" | "high_volume" | "momentum";

export interface ScanConditionResult {
  id: string;
  label: string;
  value: string;
  pass: boolean | null;
  gap: number;
}

export interface ScanEvaluation {
  quote: Quote;
  conditions: ScanConditionResult[];
  match: boolean;
  passed: number;
  available: number;
  gap: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function condition(id: string, label: string, value: number | null, formatter: (value: number) => string, pass: (value: number) => boolean, gap: (value: number) => number): ScanConditionResult {
  if (value === null || !finite(value)) return { id, label, value: "UNAVAILABLE", pass: null, gap: 10 };
  return { id, label, value: formatter(value), pass: pass(value), gap: Math.max(0, gap(value)) };
}

export function rangePosition(quote: Pick<Quote, "price" | "high52" | "low52">): number | null {
  if (!finite(quote.price) || !finite(quote.high52) || !finite(quote.low52) || quote.high52 <= quote.low52) return null;
  return (quote.price - quote.low52) / (quote.high52 - quote.low52);
}

export function distanceFromHigh(quote: Pick<Quote, "price" | "high52">): number | null {
  if (!finite(quote.price) || !finite(quote.high52) || quote.high52 <= 0) return null;
  return ((quote.price / quote.high52) - 1) * 100;
}

export function relativeVolume(quote: Pick<Quote, "volume" | "avgVolume">): number | null {
  if (!finite(quote.volume) || !finite(quote.avgVolume) || quote.avgVolume <= 0) return null;
  return quote.volume / quote.avgVolume;
}

export function evaluateScanQuote(quote: Quote, scan: ScanType): ScanEvaluation {
  const change = finite(quote.changePercent) ? quote.changePercent : null;
  const distHigh = distanceFromHigh(quote);
  const position = rangePosition(quote);
  const rvol = relativeVolume(quote);
  let conditions: ScanConditionResult[];

  switch (scan) {
    case "breakout_52w":
      conditions = [condition("high", "WITHIN 2% OF 52W HIGH", distHigh, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, (v) => v >= -2 && v <= 0.5, (v) => v < -2 ? (-2 - v) / 2 : v > 0.5 ? (v - 0.5) / 2 : 0)];
      break;
    case "momentum":
      conditions = [condition("move", "DAILY MOVE > +3%", change, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, (v) => v > 3, (v) => Math.max(0, 3 - v) / 3)];
      break;
    case "golden_cross":
      conditions = [
        condition("move", "DAILY MOVE > +1%", change, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, (v) => v > 1, (v) => Math.max(0, 1 - v)),
        condition("range", "52W RANGE POSITION ≥ 60%", position, (v) => `${(v * 100).toFixed(1)}%`, (v) => v >= 0.6, (v) => Math.max(0, 0.6 - v) / 0.6),
      ];
      break;
    case "high_volume":
      conditions = [condition("rvol", "RELATIVE VOLUME > 2.0x", rvol, (v) => `${v.toFixed(2)}x`, (v) => v > 2, (v) => Math.max(0, 2 - v) / 2)];
      break;
    case "rsi_oversold":
      conditions = [
        condition("move", "DAILY MOVE < -3%", change, (v) => `${v.toFixed(2)}%`, (v) => v < -3, (v) => Math.max(0, v + 3) / 3),
        condition("range", "52W RANGE POSITION ≤ 30%", position, (v) => `${(v * 100).toFixed(1)}%`, (v) => v <= 0.3, (v) => Math.max(0, v - 0.3) / 0.7),
      ];
      break;
    case "rsi_overbought":
      conditions = [
        condition("move", "DAILY MOVE > +5%", change, (v) => `+${v.toFixed(2)}%`, (v) => v > 5, (v) => Math.max(0, 5 - v) / 5),
        condition("high", "WITHIN 5% OF 52W HIGH", distHigh, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, (v) => v >= -5 && v <= 0.5, (v) => v < -5 ? (-5 - v) / 5 : v > 0.5 ? (v - 0.5) / 5 : 0),
      ];
  }

  const available = conditions.filter((item) => item.pass !== null).length;
  const passed = conditions.filter((item) => item.pass === true).length;
  return {
    quote,
    conditions,
    match: available === conditions.length && passed === conditions.length,
    passed,
    available,
    gap: conditions.reduce((sum, item) => sum + item.gap, 0),
  };
}

export function rankNearMisses(evaluations: ScanEvaluation[]): ScanEvaluation[] {
  return evaluations
    .filter((item) => !item.match && item.available > 0)
    .sort((a, b) => b.passed - a.passed || b.available - a.available || a.gap - b.gap || a.quote.symbol.localeCompare(b.quote.symbol));
}
