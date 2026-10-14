// Imported from OpenClaw packages/normalization-core/src/{string-coerce,number-coercion}.ts.
// MIT, Copyright (c) 2026 OpenClaw Foundation; pin c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS retains only the dependency closure used by ACP metadata helpers.
/** Trims string input and returns undefined for non-strings or empty strings. */
export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Returns a number only when the input is already finite. */
export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
