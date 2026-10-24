import type { ArtifactContent } from "./artifactContracts";

type ValuationContent = Extract<ArtifactContent, { kind: "valuation" }>;

/** Compare recorded data by value, not JSON key insertion order. No tolerance:
 * an authored calculation output is either unchanged or needs a fresh engine run. */
function sameRecordedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length && left.every((item, index) => sameRecordedValue(item, right[index]));
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((key) => Object.hasOwn(b, key) && sameRecordedValue(a[key], b[key]));
  }
  return false;
}

const RECORDED_FIELDS = ["symbol", "modelId", "assumptions", "outputs", "summary"] as const;

/** A generic P4 edit or accepted proposal cannot claim that P11 recalculated a
 * changed assumption/output. A provenance-preserving audited restore is separate. */
export function assertValuationRevisionIsRecorded(
  previous: ArtifactContent,
  proposed: ArtifactContent,
): void {
  if (previous.kind !== "valuation" || proposed.kind !== "valuation") return;
  const changed = RECORDED_FIELDS.filter((key) => !sameRecordedValue(previous[key], proposed[key]));
  if (changed.length) {
    throw new Error(
      `Valuation ${changed.join(", ")} changed without a deterministic engine run. The recorded calculation cannot be edited as JSON or accepted as a generic proposal. Prepare a governed recalculation from this exact saved revision instead.`,
    );
  }
}

export function validWaccChange(previous: ValuationContent, proposedWaccPct: number): boolean {
  const current = previous.assumptions.waccPct;
  return typeof current === "number" && Number.isFinite(current)
    && Number.isFinite(proposedWaccPct) && proposedWaccPct > 0 && proposedWaccPct <= 100
    && proposedWaccPct !== current;
}

/** Draft ONLY: the canonical Chat composer performs consent/rights/capability
 * checks before any actual deterministic operation or version creation. */
export function prepareValuationRecalculationPrompt(
  content: ValuationContent,
  target: { artifactId: string; version: number; contentHash: string },
  proposedWaccPct: number,
): string {
  if (!validWaccChange(content, proposedWaccPct)) {
    throw new Error("Enter a changed WACC greater than 0% and at most 100%; this is not a model run.");
  }
  if (!target.artifactId.trim() || !Number.isSafeInteger(target.version) || target.version <= 0
    || !/^[a-f0-9]{64}$/.test(target.contentHash)) {
    throw new Error("The exact saved valuation identity is unavailable. Reopen the canonical saved revision.");
  }
  return [
    "Review a proposed change to the EXACT existing saved valuation Artifact; do not assume it has been recalculated.",
    `Artifact ID: ${target.artifactId}; version: ${target.version}; content SHA-256: ${target.contentHash}.`,
    `Recorded model: ${content.modelId}; recorded security: ${content.symbol || "no ticker attached"}.`,
    `Proposed WACC: ${proposedWaccPct}% (recorded WACC: ${String(content.assumptions.waccPct)}%).`,
    "Before executing, verify that this exact saved version is still the current head, the model is supported, the original inputs/source references, data rights, entitlement policies and permitted data are available, and the user has approved any required consent.",
    "Use only an authorized deterministic model calculation. Recompute outputs and sensitivity from the approved changed inputs; do not rewrite recorded outputs/summary, claim that a rerun happened, or fabricate missing data. If no governed recalculation workflow is available, explain the blocker and preserve the existing revision unchanged.",
    "Only after a real verified engine run may a new canonical revision be saved with the engine receipt, exact input/output hashes, source lineage, and the before/after WACC and result change; otherwise leave this as a proposal.",
  ].join("\n");
}
