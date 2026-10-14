import { artifactContentSchema, spreadsheetArtifactContentSchema, spreadsheetCellDiffSchema, type ArtifactContent } from "@shared/artifactContracts";
import type { ProjectArtifactProposalRecord, ProjectArtifactVersionRecord } from "./useArtifacts";

const CHANGE_LIMIT = 50;
const VALUE_LIMIT = 1_200;
export interface ProposalContentChange { path: string; before: unknown; after: unknown; provenance: boolean }
export interface ArtifactProposalReview {
  content: ArtifactContent | null;
  changes: ProposalContentChange[];
  changeCount: number;
  provenanceChanges: ProposalContentChange[];
  provenanceChangeCount: number;
  topLevelKeys: string[];
  stale: boolean;
  canAccept: boolean;
  error: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
// Presentation only: mirror P4's shallow replacement/diff semantics; P4 still decides and persists.
export function reviewArtifactProposal(proposal: ProjectArtifactProposalRecord, base: ProjectArtifactVersionRecord | undefined, headVersion: number): ArtifactProposalReview {
  const stale = proposal.baseVersion !== headVersion;
  const review: ArtifactProposalReview = { content: null, changes: [], changeCount: 0, provenanceChanges: [], provenanceChangeCount: 0, topLevelKeys: [], stale, canAccept: false, error: null };
  if (!base || base.artifactId !== proposal.artifactId || base.version !== proposal.baseVersion) {
    review.error = "The immutable proposal base is unavailable. Acceptance is disabled until it can be inspected.";
    return review;
  }
  try {
    const before = artifactContentSchema.parse(base.content);
    if (proposal.proposalType === "spreadsheet_ai_diff") {
      const next = structuredClone(spreadsheetArtifactContentSchema.parse(before));
      const sheets = new Map(next.sheets.map(sheet => [sheet.id, sheet]));
      for (const raw of proposal.diffs) {
        const diff = spreadsheetCellDiffSchema.parse(raw);
        const sheet = sheets.get(diff.sheetId);
        if (!sheet) throw new Error(`Spreadsheet diff references unknown sheet ${diff.sheetId}.`);
        if (diff.after === null) delete sheet.cells[diff.ref];
        else sheet.cells[diff.ref] = diff.after;
      }
      review.content = artifactContentSchema.parse(next);
    } else {
      review.content = artifactContentSchema.parse({ ...structuredClone(before), ...structuredClone(proposal.patch), kind: before.kind });
    }
    const changedTopKeys = new Set<string>();
    const visit = (left: unknown, right: unknown, path: string, topKey: string, provenance: boolean): void => {
      if (Object.is(left, right)) return;
      if ((record(left) || left === undefined) && (record(right) || right === undefined) && (record(left) || record(right))) {
        const a = record(left) ? left : {}, b = record(right) ? right : {};
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        if (keys.size > 0) {
          for (const key of keys) visit(a[key], b[key], `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, topKey || key, provenance || /provenance|sourceQuality|traceability|evidenceKind/i.test(key));
          return;
        }
      } else if ((Array.isArray(left) || left === undefined) && (Array.isArray(right) || right === undefined) && (Array.isArray(left) || Array.isArray(right))) {
        const a: unknown[] = Array.isArray(left) ? left : [], b: unknown[] = Array.isArray(right) ? right : [];
        if (a.length || b.length) {
          for (let index = 0; index < Math.max(a.length, b.length); index++) visit(a[index], b[index], `${path}/${index}`, topKey, provenance);
          return;
        }
      }
      // Empty containers of the same shape are equal, not an apparent replacement.
      if (record(left) && record(right) && !Object.keys(left).length && !Object.keys(right).length) return;
      if (Array.isArray(left) && Array.isArray(right) && !left.length && !right.length) return;
      const change = { path, before: left, after: right, provenance };
      changedTopKeys.add(topKey);
      review.changeCount++;
      if (review.changes.length < CHANGE_LIMIT) review.changes.push(change);
      if (provenance) {
        review.provenanceChangeCount++;
        if (review.provenanceChanges.length < CHANGE_LIMIT) review.provenanceChanges.push(change);
      }
    };
    visit(before, review.content, "", "", false);
    review.topLevelKeys = [...changedTopKeys];
    review.canAccept = proposal.status === "pending" && !stale;
  } catch (cause) {
    review.content = null;
    review.error = cause instanceof Error ? cause.message : "Proposed content does not satisfy the canonical Artifact schema.";
  }
  return review;
}

export function proposalValuePreview(value: unknown): { text: string; truncated: boolean } {
  const text = value === undefined ? "(absent)" : JSON.stringify(value, null, 2);
  return { text: text.length > VALUE_LIMIT ? text.slice(0, VALUE_LIMIT) : text, truncated: text.length > VALUE_LIMIT };
}

export function artifactMaintenancePrompt(artifactId: string, title: string, version: number, contentHash: string): string {
  return `Maintain the existing selected Artifact ${JSON.stringify(title)} in place through governed agent maintenance. Target artifactId=${JSON.stringify(artifactId)}, baseVersion=${version}, baseHash=${JSON.stringify(contentHash)} (the immutable contentHash). After I add a maintenance instruction and explicitly send in AI/agent mode, use lios.artifact.inspect to inspect this exact owned identity and revision, then lios.artifact.propose_update to stage requested edits for review. Preserve formulas, exact values, source references, immutable capture metadata and evidence/provenance semantics. Do not create a replacement Artifact or automatically accept changes. If the head/version/hash moved, stop and request review of the current revision.`;
}
