import { p9WorkflowDefinitionInputSchema, type P9WorkflowDefinitionInput } from "@shared/p9AutomationContracts";
import { normalizePulseSubjectKey } from "@shared/pulseSubjectPreferences";
import type { PulseStoryView } from "./pulseStoryPresentation";
import { quickMonitorDraft } from "./workflowReviewTruth";

/**
 * The Pulse-to-P9 handoff NEVER creates a subject-specific watcher: current
 * P9 project_what_changed compares all saved Project intelligence, not an
 * arbitrary source/subject filter. The recorded Pulse subject is context for
 * the review only; it is deliberately not a P9 filter or sourceRef.
 */
export function pulseProjectMonitorDraft(
  card: Pick<PulseStoryView, "subjectKey" | "symbol" | "evidence">,
  minutes: number,
): P9WorkflowDefinitionInput {
  const subject = normalizePulseSubjectKey(card.subjectKey ?? card.symbol);
  if (!subject || !card.evidence?.some(source => typeof source.id === "string" && source.id.trim())) {
    throw new Error("A recorded source-backed Pulse subject is required for Project review.");
  }
  const base = quickMonitorDraft("changes", false, minutes);
  return p9WorkflowDefinitionInputSchema.parse({
    ...base,
    name: "Project what changed",
    description: `Opened from a followed Pulse subject (${subject}). Compare the selected Project as a whole. This workflow is NOT filtered to that subject; following does not enable monitoring, and no source-specific alerts are promised.`,
    // The Project data scope and action remain the existing P9 authority.
    // A reference to the Pulse card is NOT evidence that the P9 engine reads
    // that exact source or can execute a subject-specific monitor.
    sourceRefs: [],
    enabled: false,
  });
}
