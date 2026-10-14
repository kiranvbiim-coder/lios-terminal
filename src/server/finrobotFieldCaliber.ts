/**
 * Selected FinRobot field-caliber comparability mechanism (Apache-2.0).
 * AI4Finance-Foundation/FinRobot@2717499b8e30f242640af08c4ad9afd1113c2d45
 * finrobot_desktop/finrobot/artifact/field_registry.py
 *
 * ADAPT, not a donor field registry/runtime: only explicit, recognized metric
 * names and recorded LiOS Artifact tags are used. We never assume USD,
 * invent accounting periods, infer a unit from substring matches, or do P11 math.
 */
import type { ArtifactContent } from "@shared/artifactContracts";

type CurrencyBasis = "quote" | "reporting";
type Caliber = Readonly<{ currency: CurrencyBasis | null; periodSensitive: boolean; signFlipSensitive: boolean }>;

const FIELDS: Readonly<Record<string, Caliber>> = Object.freeze({
  // Donor per-share currency fields are NOT absolute enterprise values.
  target_price: { currency: "quote", periodSensitive: false, signFlipSensitive: false },
  implied_price: { currency: "quote", periodSensitive: false, signFlipSensitive: false },
  current_price: { currency: "quote", periodSensitive: false, signFlipSensitive: false },
  book_value_per_share: { currency: "quote", periodSensitive: false, signFlipSensitive: false },
  equity_value_per_share: { currency: "quote", periodSensitive: false, signFlipSensitive: false },
  enterprise_value: { currency: "reporting", periodSensitive: false, signFlipSensitive: false },
  equity_value: { currency: "reporting", periodSensitive: false, signFlipSensitive: false },
  revenue: { currency: "reporting", periodSensitive: true, signFlipSensitive: false },
  ebitda: { currency: "reporting", periodSensitive: true, signFlipSensitive: false },
  net_income: { currency: "reporting", periodSensitive: true, signFlipSensitive: true },
  // Multiples/ratios must not be gated by a currency change.
  wacc: { currency: null, periodSensitive: false, signFlipSensitive: false },
  forward_pe: { currency: null, periodSensitive: false, signFlipSensitive: false },
  ev_ebitda: { currency: null, periodSensitive: false, signFlipSensitive: false },
});
const QUOTE_KEYS = ["quoteCurrency", "quote_currency"] as const;
const REPORTING_KEYS = ["reportingCurrency", "reporting_currency"] as const;
const PERIOD_KEYS = ["reportingPeriod", "reporting_period", "fiscalPeriod", "fiscal_period"] as const;

type Tag = { present: false } | { present: true; value: string | null };
export type FieldCaliberMismatch = Readonly<{ kind: "currency" | "period"; message: string }>;

function tag(content: ArtifactContent, keys: readonly string[], pattern: RegExp): Tag {
  const containers: Record<string, unknown>[] = [];
  if (content.kind === "valuation") containers.push(content.assumptions, content.outputs, content.summary);
  if (content.kind === "portfolio") containers.push(content.summary, content.risk);
  let present = false;
  let recorded: string | null = null;
  for (const container of containers) for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
    present = true;
    const raw = container[key];
    if (typeof raw !== "string") return { present: true, value: null };
    const value = raw.trim().toUpperCase();
    if (!pattern.test(value) || (recorded !== null && recorded !== value)) return { present: true, value: null };
    recorded = value;
  }
  return present ? { present: true, value: recorded } : { present: false };
}

function incompatible(left: Tag, right: Tag): boolean {
  // Legacy Artifacts with no tags on either side retain the old diff contract.
  // One-sided, malformed or internally conflicting recorded tags fail closed.
  if (!left.present && !right.present) return false;
  return !left.present || !right.present || left.value === null || right.value === null || left.value !== right.value;
}

function field(path: string): Caliber | undefined {
  const parts = path.split(".");
  if (parts.length !== 2 || !["outputs", "summary", "risk", "assumptions"].includes(parts[0]!)) return;
  // Canonical exact field lookup; never classify by fuzzy substring.
  const key = parts[1]!.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return FIELDS[key];
}

export function compareRecordedFieldCaliber(
  left: ArtifactContent,
  right: ArtifactContent,
  path: string,
): readonly FieldCaliberMismatch[] {
  if (left.kind !== right.kind || !["valuation", "portfolio"].includes(left.kind)) return [];
  const caliber = field(path);
  if (!caliber) return [];
  const mismatches: FieldCaliberMismatch[] = [];
  if (caliber.currency) {
    const keys = caliber.currency === "quote" ? QUOTE_KEYS : REPORTING_KEYS;
    const a = tag(left, keys, /^[A-Z]{3}$/);
    const b = tag(right, keys, /^[A-Z]{3}$/);
    if (incompatible(a, b)) mismatches.push({
      kind: "currency",
      message: `Recorded ${caliber.currency} currency differs or is invalid between Artifact versions; a same-unit numeric delta is unavailable.`,
    });
  }
  if (caliber.periodSensitive) {
    const a = tag(left, PERIOD_KEYS, /^[A-Z0-9][A-Z0-9_.:-]{0,39}$/);
    const b = tag(right, PERIOD_KEYS, /^[A-Z0-9][A-Z0-9_.:-]{0,39}$/);
    if (incompatible(a, b)) mismatches.push({
      kind: "period",
      message: "Recorded accounting period differs or is invalid between Artifact versions; a like-for-like numeric delta is unavailable.",
    });
  }
  return mismatches;
}

export function isSignFlipSensitiveField(path: string): boolean {
  return field(path)?.signFlipSensitive ?? false;
}
