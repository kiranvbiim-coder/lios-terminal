import type { PulseEvidence } from "@shared/waveDContracts";
import { pulseStoryTimestamp, safePulseSourceUrl, type PulseStoryView } from "./pulseStoryPresentation";

/**
 * Watermelon-style expandable story grouping over an already authorized Wave D
 * response. This is a presentation projection, not a competing feed or source
 * index. Equal headlines alone are never evidence of the same event.
 */
export interface RecordedPulseCluster extends PulseStoryView {
  clusteredCardIds: string[];
  clusteredCount: number;
  omittedEvidenceCount: number;
}

function normalizedTitle(card: PulseStoryView): string {
  return card.title.trim().replace(/\s+/g, " ").toLocaleLowerCase().slice(0, 240);
}

function sameEventBucket(card: PulseStoryView): string | null {
  const subject = (card.subjectKey || card.symbol || "").trim().toUpperCase();
  const at = pulseStoryTimestamp(card.createdAt);
  if (!subject || !at || !normalizedTitle(card)) return null;
  return [card.kind || "unspecified", subject, at.slice(0, 10), normalizedTitle(card)].join("\u001f");
}

/** Only exact recorded source identity counts, never a shared publisher name. */
function evidenceKeys(card: PulseStoryView): Set<string> {
  const keys = new Set<string>();
  for (const source of card.evidence ?? []) {
    const url = safePulseSourceUrl(source.url);
    if (url) keys.add("url:" + url);
    // ID equality may establish the same retained observation, not independent corroboration.
    if (source.id?.trim() && (source.provider?.trim() || source.source?.trim())) {
      // Provider-local IDs can repeat across publishers. Exact URL identity
      // remains a separate and sufficient link when both cards record it.
      const authority = (source.provider?.trim() || source.source?.trim() || "").toLowerCase();
      keys.add("id:" + JSON.stringify([authority, source.id.trim()]));
    }
  }
  return keys;
}

function sharedRecordedSource(left: Set<string>, right: Set<string>): boolean {
  for (const key of left) if (right.has(key)) return true;
  return false;
}

function deduplicateEvidence(cards: readonly PulseStoryView[], limit: number): {
  evidence: PulseEvidence[]; omitted: number;
} {
  const seen = new Set<string>();
  const result: PulseEvidence[] = [];
  let omitted = 0;
  for (const card of cards) {
    for (const source of card.evidence ?? []) {
      const key = [source.id, source.provider ?? "", source.source, source.url ?? ""].join("\u001f");
      if (seen.has(key)) continue;
      seen.add(key);
      if (result.length < limit) result.push(source);
      else omitted++;
    }
  }
  return { evidence: result, omitted };
}

/**
 * A cluster requires same kind + explicitly recorded subject + UTC event date
 * + normalized exact headline + at least one shared evidence ID or safe URL.
 * The check is against its anchor, not transitive, to avoid story chaining.
 * Scores and claims always remain the server's lead item, never aggregated.
 */
export function clusterRecordedPulseStories(
  cards: readonly PulseStoryView[],
  maxOutput = 24,
): RecordedPulseCluster[] {
  const output: RecordedPulseCluster[] = [];
  const anchors: Array<{ bucket: string | null; sources: Set<string>; members: PulseStoryView[] }> = [];
  for (const card of cards.slice(0, 96)) {
    const bucket = sameEventBucket(card);
    const sources = evidenceKeys(card);
    const index = bucket && sources.size
      ? anchors.findIndex(group => group.bucket === bucket && sharedRecordedSource(group.sources, sources))
      : -1;
    if (index >= 0) {
      anchors[index].members.push(card);
    } else {
      anchors.push({ bucket, sources, members: [card] });
    }
  }
  const limit = Number.isFinite(maxOutput) ? Math.max(1, Math.min(48, Math.floor(maxOutput))) : 24;
  for (const group of anchors.slice(0, limit)) {
    const lead = group.members[0];
    const { evidence, omitted } = deduplicateEvidence(group.members, 60);
    output.push({
      ...lead,
      evidence,
      clusteredCardIds: group.members.map(member => member.id),
      clusteredCount: group.members.length,
      omittedEvidenceCount: omitted,
    });
  }
  return output;
}
