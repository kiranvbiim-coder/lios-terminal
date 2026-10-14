export const CONTINUITY_ACTION_TYPES = [
  "merger",
  "acquisition",
  "spin_off",
  "ticker_change",
  "exchange_migration",
  "security_replacement",
] as const;

export type ContinuityActionType = (typeof CONTINUITY_ACTION_TYPES)[number];

export interface ContinuityBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ContinuityEvent {
  actionId: number;
  actionType: ContinuityActionType;
  effectiveDate: string;
  sourceSymbol: string;
  targetSymbol: string;
}

export interface ContinuousHistory {
  bars: ContinuityBar[];
  event: ContinuityEvent;
  sourceBarCount: number;
  targetBarCount: number;
  status: "continuous" | "source_only" | "target_only" | "incomplete";
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function dedupeAndSortBars(bars: ContinuityBar[]): ContinuityBar[] {
  const byDate = new Map<string, ContinuityBar>();
  for (const bar of bars) byDate.set(bar.date, { ...bar });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeContinuityEvent(event: ContinuityEvent): ContinuityEvent {
  if (!Number.isInteger(event.actionId) || event.actionId <= 0) throw new RangeError("Continuity actionId must be positive.");
  if (!CONTINUITY_ACTION_TYPES.includes(event.actionType)) throw new RangeError(`Unsupported continuity action: ${event.actionType}`);
  if (!isIsoDate(event.effectiveDate)) throw new RangeError(`Continuity effectiveDate must be a valid ISO date: ${event.effectiveDate}`);
  const sourceSymbol = event.sourceSymbol.trim().toUpperCase();
  const targetSymbol = event.targetSymbol.trim().toUpperCase();
  if (!sourceSymbol || !targetSymbol || sourceSymbol === targetSymbol) throw new RangeError("Continuity requires distinct source and target symbols.");
  return { ...event, sourceSymbol, targetSymbol };
}

/**
 * Stitches observed predecessor and successor bars without inventing a bridge
 * price. The predecessor owns dates before the effective date and the
 * successor owns dates on/after it; callers can inspect status when either
 * side is absent rather than treating an incomplete chain as continuous.
 */
export function buildContinuousHistory(
  sourceBars: ContinuityBar[],
  targetBars: ContinuityBar[],
  event: ContinuityEvent,
): ContinuousHistory {
  const normalizedEvent = normalizeContinuityEvent(event);
  for (const bar of [...sourceBars, ...targetBars]) {
    if (!isIsoDate(bar.date)) throw new RangeError(`Continuity bar date must be a valid ISO date: ${bar.date}`);
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (!prices.every(Number.isFinite) || !Number.isFinite(bar.volume) || prices.some((price) => price < 0) || bar.volume < 0) {
      throw new RangeError(`Continuity bar ${bar.date} contains invalid prices or volume.`);
    }
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
      throw new RangeError(`Continuity bar ${bar.date} violates OHLC high/low bounds.`);
    }
  }
  const source = dedupeAndSortBars(sourceBars.filter((bar) => bar.date < normalizedEvent.effectiveDate));
  const target = dedupeAndSortBars(targetBars.filter((bar) => bar.date >= normalizedEvent.effectiveDate));
  const bars = dedupeAndSortBars([...source, ...target]);
  const status = source.length > 0 && target.length > 0
    ? "continuous"
    : source.length > 0
      ? "source_only"
      : target.length > 0
        ? "target_only"
        : "incomplete";

  return { bars, event: normalizedEvent, sourceBarCount: source.length, targetBarCount: target.length, status };
}
