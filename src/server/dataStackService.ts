/**
 * User-ranked provider ordering for keyed fallbacks and conflict resolution.
 *
 * resolveFamilyProviderOrder is the shared entry point for quote/OHLCV,
 * statements and macro/FX paths. It turns each family's default provider
 * order into a user-specific order that honors applicable pins. Each family
 * retains its own fetch strategy: sequential first-success for quota-sensitive
 * paths and concurrent fan-out where provider disagreement is useful.
 */
import type { DataFamily, DataStackPin } from "@shared/dataStackPins";

export function normalizeProviderStackOrder(
  preferredOrder: readonly string[],
  connectedIds: readonly string[],
): string[] {
  const connected = new Set(connectedIds);
  const ordered: string[] = [];
  for (const id of preferredOrder) {
    if (connected.has(id) && !ordered.includes(id)) ordered.push(id);
  }
  for (const id of connectedIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function sortIdsByStackOrder<T extends { id: string }>(
  items: readonly T[],
  stackOrder: readonly string[],
): T[] {
  if (!stackOrder.length) return [...items];
  const rank = new Map(stackOrder.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const ar = rank.get(a.id);
    const br = rank.get(b.id);
    if (ar === undefined && br === undefined) return 0;
    if (ar === undefined) return 1;
    if (br === undefined) return -1;
    return ar - br;
  });
}

/**
 * Picks the single most-specific pin that applies to a given family (and
 * optional symbol/metric), if any. Specificity order: metric pin (exact
 * symbol+metric match) beats symbol pin (exact symbol match, any metric)
 * beats family pin (this family, no symbol) beats global pin (every
 * family). A pin for a DIFFERENT symbol/metric than the one being resolved
 * never matches -- it is simply not relevant, not a lower-priority
 * candidate. When multiple pins tie at the same specificity (should not
 * happen if callers dedupe on write, but this must not crash if it does),
 * the most recently created one wins, matching "the user's latest explicit
 * choice" as the least surprising resolution.
 */
export function findPin(
  pins: readonly DataStackPin[],
  family: DataFamily,
  symbol?: string | null,
  metric?: string | null,
): DataStackPin | null {
  const upperSymbol = symbol?.toUpperCase() ?? null;
  const candidates = pins.filter((pin) => {
    if (pin.scope === "global") return true;
    if (pin.family !== family) return false;
    if (pin.scope === "family") return true;
    if (pin.scope === "symbol") return pin.symbol === upperSymbol;
    if (pin.scope === "metric") return pin.symbol === upperSymbol && pin.metric === metric;
    return false;
  });
  if (!candidates.length) return null;
  const specificity: Record<DataStackPin["scope"], number> = { global: 0, family: 1, symbol: 2, metric: 3 };
  candidates.sort((a, b) => {
    const bySpecificity = specificity[b.scope] - specificity[a.scope];
    if (bySpecificity !== 0) return bySpecificity;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return candidates[0];
}

/**
 * Universal resolver entry point (see module comment). `defaultOrder` is
 * whatever order the calling family would have used with zero user
 * preference at all -- its own registry-defined priority. The result is
 * always a permutation of exactly `defaultOrder` (a pin/stack-order entry
 * for a provider id the family doesn't actually have is silently ignored,
 * never invented as a phantom provider).
 */
export function resolveFamilyProviderOrder(
  family: DataFamily,
  defaultOrder: readonly string[],
  opts: {
    globalStackOrder?: readonly string[];
    pins?: readonly DataStackPin[];
    symbol?: string | null;
    metric?: string | null;
  } = {},
): string[] {
  const available = new Set(defaultOrder);
  const pin = opts.pins?.length ? findPin(opts.pins, family, opts.symbol, opts.metric) : null;
  const stackOrder = opts.globalStackOrder?.length
    ? sortIdsByStackOrder(defaultOrder.map((id) => ({ id })), opts.globalStackOrder).map((x) => x.id)
    : [...defaultOrder];
  if (!pin || !available.has(pin.providerId)) return stackOrder;
  return [pin.providerId, ...stackOrder.filter((id) => id !== pin.providerId)];
}
