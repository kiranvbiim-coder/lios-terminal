import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";

/** Fields copied from source records are *not* editable Office prose. */
const PROTECTED_BLOCK_ATTRS = [
  "sourceRef", "sourceRefs", "evidenceId", "evidenceVersionRef",
  "contentHash", "excerptSha256", "provenance", "truth",
  "receiptId", "sourceUrl", "sourceQuality", "sourceQuote",
] as const;

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * A local DOCX/PPTX parser can transport text, formatting and typed cells but
 * cannot create or change trusted evidence, entitlement, or source identities.
 * This is a final server-boundary check, not reliance on client-side claims.
 * Reject forged metadata explicitly instead of silently ignoring it.
 */
export function reconcileOfficeArtifactProvenance(
  original: ArtifactContent,
  proposed: ArtifactContent,
): ArtifactContent {
  if (original.kind !== proposed.kind) throw new Error("Office return cannot change Artifact kind.");
  const result = artifactContentSchema.parse(proposed);
  if ((original.kind === "report" || original.kind === "research")
      && (result.kind === "report" || result.kind === "research")) {
    const baseline = new Map(original.blocks.map(block => [block.id, block]));
    for (const block of result.blocks) {
      const before = baseline.get(block.id);
      for (const name of PROTECTED_BLOCK_ATTRS) {
        if (!equal(block.attrs[name], before?.attrs[name])) {
          throw new Error(`Office return cannot change recorded source provenance (${block.id}.${name}). Reconcile sources through the governed Artifact editor.`);
        }
      }
      // Source authority markers must be determined from exact P4 baseline,
      // not file-supplied status flags.
      const edited = Boolean(before && before.text !== block.text);
      for (const marker of ["officeEdited", "sourceQuoteEdited", "officeEditProvenance"] as const) {
        if (before?.attrs[marker] === undefined) delete block.attrs[marker];
        else block.attrs[marker] = before.attrs[marker];
      }
      if (edited) {
        block.attrs.officeEdited = true;
        if (before?.type === "quote" || before?.attrs.sourceRef || before?.attrs.evidenceId) {
          block.attrs.sourceQuoteEdited = true;
          block.attrs.officeEditProvenance = "user_asserted";
        }
      } else if (!before) {
        // A new Office-authored block has no saved evidence binding.
        block.attrs.officeEdited = true;
        block.attrs.officeEditProvenance = "user_asserted";
      }
    }
    if (original.kind === "research" && result.kind === "research") {
      for (const key of ["evidence", "sourcePolicy", "executionTrail", "contradictions", "plan"] as const) {
        if (!equal(original[key], result[key])) {
          throw new Error(`Office return cannot modify recorded research ${key}; use governed Artifact review.`);
        }
      }
      const claims = new Map(original.claims.map(claim => [claim.id, claim]));
      for (const claim of result.claims) {
        const before = claims.get(claim.id);
        if (!equal(claim.sourceRefs, before?.sourceRefs ?? [])) {
          throw new Error("Office return cannot add or modify a research claim's recorded source references.");
        }
        claim.provenance = !before || before.text !== claim.text ? "user_asserted" : before.provenance;
      }
    }
  }
  if (original.kind === "decision" && result.kind === "decision"
      && !equal(original.linkedRefs, result.linkedRefs)) {
    throw new Error("Office return cannot modify recorded decision source/model references.");
  }
  if (original.kind === "thesis" && result.kind === "thesis") {
    for (const key of ["entityRef", "status", "refresh", "postmortems"] as const) {
      if (!equal(original[key], result[key])) {
        throw new Error(`Office return cannot modify recorded thesis ${key}.`);
      }
    }
    for (const key of ["expectedOutcomes", "catalysts", "risks", "invalidationConditions", "openQuestions"] as const) {
      const baseline = new Map(original[key].map(item => [item.id, item]));
      for (const item of result[key]) {
        const before = baseline.get(item.id);
        if (!equal(item.evidenceRefs, before?.evidenceRefs ?? [])) {
          throw new Error(`Office return cannot modify thesis ${key} evidence references.`);
        }
        if ("status" in item) {
          const priorStatus = before && "status" in before ? before.status : "open";
          item.status = !before || before.text !== item.text ? "open" : priorStatus;
        }
        if ("triggered" in item) {
          const priorTriggered = before && "triggered" in before ? before.triggered : false;
          item.triggered = !before || before.text !== item.text ? false : priorTriggered;
        }
      }
    }
    const claims = new Map(original.claims.map(claim => [claim.id, claim]));
    for (const claim of result.claims) {
      const before = claims.get(claim.id);
      if (!equal(claim.evidenceRefs, before?.evidenceRefs ?? [])
          || !equal(claim.counterEvidenceRefs, before?.counterEvidenceRefs ?? [])) {
        throw new Error("Office return cannot change thesis claim evidence references.");
      }
      if (!before || before.text !== claim.text) {
        claim.status = "open";
        claim.confidence = null;
        claim.updatedAt = null;
      } else {
        claim.status = before.status;
        claim.confidence = before.confidence;
        claim.updatedAt = before.updatedAt;
      }
    }
  }
  return artifactContentSchema.parse(result);
}
