import type { EvidenceSnapshot, DataFreshness } from "./terminalEvidence";

export type TerminalDataState = "live" | "point-in-time" | "mixed" | "stale" | "offline" | "unknown";

export interface TerminalDataAtmosphere {
  state: TerminalDataState;
  label: string;
  explanation: string;
  freshest?: DataFreshness;
  stalest?: DataFreshness;
}

const RANK: Record<DataFreshness, number> = {
  live: 0,
  delayed: 1,
  "end-of-day": 2,
  "point-in-time": 3,
  "user-uploaded": 3,
  cached: 4,
  stale: 5,
  unavailable: 6,
};

export function deriveTerminalDataAtmosphere(snapshot: EvidenceSnapshot): TerminalDataAtmosphere {
  const freshness = snapshot.provenance.map((item) => item.freshness);
  if (!freshness.length) return { state: "unknown", label: "Data state unknown", explanation: "The active surface has not published source freshness metadata yet." };
  const sorted = [...freshness].sort((a, b) => RANK[a] - RANK[b]);
  const freshest = sorted[0];
  const stalest = sorted[sorted.length - 1];
  if (freshness.every((item) => item === "unavailable")) return { state: "offline", label: "Sources unavailable", explanation: "Published sources are currently unavailable.", freshest, stalest };
  if (freshness.some((item) => item === "stale" || item === "unavailable")) return { state: "stale", label: "Attention: stale inputs", explanation: "At least one published source is stale or unavailable. Inspect Evidence before relying on outputs.", freshest, stalest };
  if (freshness.every((item) => item === "point-in-time")) return { state: "point-in-time", label: "Point-in-time view", explanation: "Published evidence is anchored to historical/as-known dates rather than live state.", freshest, stalest };
  if (freshness.every((item) => item === "live" || item === "delayed")) return { state: "live", label: freshness.every((item) => item === "live") ? "Live sources" : "Live / delayed sources", explanation: "Published evidence is current or exchange-delayed.", freshest, stalest };
  return { state: "mixed", label: "Mixed data timing", explanation: "The surface combines sources with different timing semantics. Use provenance to inspect each input.", freshest, stalest };
}
