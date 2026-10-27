import type { PulseStoryView } from "./pulseStoryPresentation";
import type { PulseChannel } from "@/components/terminal/PulseDiscoveryTabs";
import { normalizePulseSubjectKey } from "@shared/pulseSubjectPreferences";

/**
 * A user's right to understand the recorded feed: these statements depend
 * exclusively on shown P2/Wave D fields and the selected channel. They are
 * NOT model-written recommendations, confidence scores, or a reconstruction
 * of why the server ranked the card.
 */
export function explainPulsePlacement(
  card: PulseStoryView,
  channel: PulseChannel,
  followed: boolean,
): string[] {
  const channelName: Record<PulseChannel, string> = {
    for_you: "For You", following: "Following", markets: "Markets", research: "Research",
  };
  const lines = [`Shown in the ${channelName[channel]} channel of your recorded intelligence feed.`];
  const subject = normalizePulseSubjectKey(card.subjectKey ?? card.symbol);
  if (followed && subject) lines.push(`You follow the recorded subject ${subject}.`);
  else if (subject) lines.push(`Recorded subject: ${subject}. This does not imply you follow it.`);
  const evidence = card.evidence ?? [];
  lines.push(evidence.length
    ? `${evidence.length} recorded source reference${evidence.length === 1 ? "" : "s"} attached. Inspect each source to verify the claim.`
    : "No attributed source references were attached; independently verify the claim.");
  if (Number.isFinite(card.score)) {
    lines.push(`Wave D relevance: ${card.score.toFixed(0)}. This is a ranking score, not a probability, accuracy score or recommendation.`);
  } else lines.push("Relevance is unavailable; no ranking reason is inferred.");
  return lines;
}
