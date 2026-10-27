import type {
  AnalyticalChange, AnalyticalContextChange, ComparableValue,
} from "./terminalChangeIntelligence";

/** Change UI is a projection over existing local snapshots, not a new feed or inferred evidence. */
export type ChangeStoryFilter = "all" | "numeric" | "structure" | "text";

export function recordedChangeCategory(change: AnalyticalChange): Exclude<ChangeStoryFilter, "all"> {
  if (change.direction === "added" || change.direction === "removed") return "structure";
  if (typeof change.before === "number" && Number.isFinite(change.before)
    && typeof change.after === "number" && Number.isFinite(change.after)) return "numeric";
  return "text";
}

export function visibleAnalyticalChanges(
  entries: readonly AnalyticalContextChange[],
  query: string,
  category: ChangeStoryFilter,
): AnalyticalContextChange[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.flatMap(entry => {
    const changes = entry.changes.filter(change =>
      (category === "all" || recordedChangeCategory(change) === category)
      && (!needle || [entry.label, entry.view, entry.symbol, change.key]
        .some(value => value.toLocaleLowerCase().includes(needle))),
    );
    return changes.length ? [{ ...entry, changes }] : [];
  });
}

export function displayRecordedValue(value: ComparableValue | undefined): string {
  if (value === undefined) return "Not recorded";
  if (value === null) return "Null";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 5 })
    : "Invalid number";
  return value;
}

/** Negative bases use absolute denominator; undefined delta is never treated as zero. */
export function recordedChangeDelta(change: AnalyticalChange): string | null {
  if (typeof change.before !== "number" || !Number.isFinite(change.before)
    || typeof change.after !== "number" || !Number.isFinite(change.after)) return null;
  const delta = change.after - change.before;
  if (!Number.isFinite(delta)) return null;
  const number = Math.abs(delta).toLocaleString("en-US", { maximumFractionDigits: 5 });
  const absolute = `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${number}`;
  if (change.before === 0) return `${absolute} (percentage unavailable: reference was zero)`;
  const percent = (delta / Math.abs(change.before)) * 100;
  if (!Number.isFinite(percent)) return absolute;
  return `${absolute} (${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%)`;
}

export function validLocalSnapshotTime(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function countShownChanges(entries: readonly AnalyticalContextChange[]): number {
  return entries.reduce((sum, entry) => sum + entry.changes.length, 0);
}
