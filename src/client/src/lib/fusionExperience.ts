import type { TerminalDensity } from "./terminalUxPreferences";

export type FusionPaneTier = "micro" | "compact" | "full";
export type FusionTone = "neutral" | "positive" | "negative" | "warning" | "accent";

export interface FusionDensityProfile {
  gap: number;
  padding: number;
  rowHeight: number;
  labelScale: number;
  valueScale: number;
}

const DENSITY_PROFILES: Record<TerminalDensity, FusionDensityProfile> = {
  terminal: { gap: 4, padding: 6, rowHeight: 22, labelScale: 0.9, valueScale: 0.92 },
  compact: { gap: 6, padding: 8, rowHeight: 26, labelScale: 0.95, valueScale: 0.96 },
  standard: { gap: 8, padding: 10, rowHeight: 30, labelScale: 1, valueScale: 1 },
  comfortable: { gap: 12, padding: 14, rowHeight: 36, labelScale: 1.05, valueScale: 1.06 },
};

export function getFusionDensityProfile(density: TerminalDensity): FusionDensityProfile {
  return DENSITY_PROFILES[density];
}

export function resolveFusionPaneTier(
  paneCount: number,
  density: TerminalDensity,
  maximized = false,
): FusionPaneTier {
  if (maximized || paneCount <= 1) return "full";
  if (density === "terminal") return paneCount >= 3 ? "micro" : "compact";
  if (density === "compact") return paneCount >= 4 ? "micro" : "compact";
  if (density === "comfortable") return paneCount >= 4 ? "compact" : "full";
  return paneCount >= 3 ? "compact" : "full";
}

export function buildSparklinePoints(
  values: Array<number | null | undefined>,
  width = 100,
  height = 28,
  padding = 2,
): string {
  const finite = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => typeof item.value === "number" && Number.isFinite(item.value));

  if (!finite.length) return "";
  if (finite.length === 1) {
    return `${width / 2},${height / 2}`;
  }

  const min = Math.min(...finite.map((item) => item.value));
  const max = Math.max(...finite.map((item) => item.value));
  const span = max - min || 1;
  const denominator = Math.max(values.length - 1, 1);
  const usableWidth = Math.max(width - padding * 2, 1);
  const usableHeight = Math.max(height - padding * 2, 1);

  return finite.map(({ value, index }) => {
    const x = padding + (index / denominator) * usableWidth;
    const y = padding + (1 - (value - min) / span) * usableHeight;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function formatCompactFinancialNumber(
  value: number | null | undefined,
  options: { currency?: string; decimals?: number; suffix?: string } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const decimals = options.decimals ?? 1;
  let scaled = absolute;
  let magnitude = "";

  if (absolute >= 1e12) { scaled = absolute / 1e12; magnitude = "T"; }
  else if (absolute >= 1e9) { scaled = absolute / 1e9; magnitude = "B"; }
  else if (absolute >= 1e6) { scaled = absolute / 1e6; magnitude = "M"; }
  else if (absolute >= 1e3) { scaled = absolute / 1e3; magnitude = "K"; }

  return `${sign}${options.currency ?? ""}${scaled.toFixed(magnitude ? decimals : Math.min(decimals, 2))}${magnitude}${options.suffix ?? ""}`;
}

export function toneForChange(change: number | null | undefined): FusionTone {
  if (change === null || change === undefined || !Number.isFinite(change) || change === 0) return "neutral";
  return change > 0 ? "positive" : "negative";
}
