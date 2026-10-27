import type { ArtifactContent } from "@shared/artifactContracts";
import { reportArtifactContentSchema } from "@shared/artifactContracts";
import type { P7InsightLens, P7Insight, P7TimelineEvent } from "@shared/p7ResearchContracts";

export type BriefingLayout = "executive" | "research" | "monitoring";
export interface BriefingSelection {
  projectId: number;
  title: string;
  layout: BriefingLayout;
  insightIds: string[];
  editorNote: string;
}
export interface BriefingDraft {
  content: Extract<ArtifactContent, {kind: "report"}>;
  dependencyRefs: string[];
  included: number;
  unreferenced: number;
}

function restricted(text: string, limit: number): string {
  return text.trim().slice(0, limit);
}

/** Deterministic, source-referenced storyboard; no generated market facts or inferred numbers. */
export function composeProjectBriefing(
  selection: BriefingSelection, lens: P7InsightLens | undefined | null,
  timeline: readonly P7TimelineEvent[] = [],
): BriefingDraft | null {
  if (!lens || lens.projectId !== selection.projectId ||
    !Number.isSafeInteger(selection.projectId) || selection.projectId <= 0) return null;
  const ids = new Set(selection.insightIds.slice(0, 16));
  const items = lens.insights.filter(insight => ids.has(insight.id)).slice(0, 16);
  if (!items.length || !restricted(selection.title, 160)) return null;

  const blocks: Extract<ArtifactContent, {kind: "report"}>["blocks"] = [];
  const sections: Extract<ArtifactContent, {kind: "report"}>["sections"] = [];
  const add = (type: "heading" | "paragraph" | "bullet_list" | "callout", text: string, refs: string[] = []) => {
    const id = "briefing-block-" + (blocks.length + 1);
    blocks.push({ id, type, text: restricted(text, 25_000), attrs: { sourceRefs: refs } });
    return id;
  };
  const introIds = [
    add("heading", restricted(selection.title, 160)),
    add("paragraph", "Project intelligence briefing · " + selection.layout + " · recorded index " + lens.generatedAt),
    add("callout", "Editorial draft from retained Project records. Recorded insight summaries are not independently re-verified facts. Confirm source rights, dates, uncertainty and claims before distribution."),
  ];
  if (selection.editorNote.trim()) introIds.push(add("paragraph", "Editor note: " + restricted(selection.editorNote, 2000)));
  sections.push({ id: "briefing-section-intro", title: "Overview", blockIds: introIds });
  const dependencies = new Set<string>();
  let unreferenced = 0;
  items.forEach((insight: P7Insight, index: number) => {
    const refs = [...new Set(insight.sourceRefs)].slice(0, 50);
    refs.forEach(ref => dependencies.add(ref));
    if (!refs.length) unreferenced++;
    const ids = [
      add("heading", restricted(insight.title, 1000), refs),
      add("paragraph", restricted(insight.summary || "No retained summary recorded.", 20_000), refs),
      add("paragraph", "Classification: " + insight.kind.replaceAll("_", " ") + "; priority: " + insight.severity + "; observed: " + (insight.occurredAt ?? "no event date recorded"), refs),
      add("bullet_list", refs.length ? refs.map(ref => "Source ID: " + ref).join("\n") : "No explicit source IDs recorded. Requires independent verification.", refs),
    ];
    sections.push({ id: "briefing-section-" + (index + 1), title: restricted(insight.title, 500), blockIds: ids });
  });
  if (selection.layout === "research" && timeline.length) {
    // A Project-wide timeline is not evidence for an unrelated selected insight.
    // Include only retained events sharing a selected source or entity reference.
    const selectedSources = new Set(items.flatMap(insight => insight.sourceRefs));
    const selectedEntities = new Set(items.flatMap(insight => insight.entityRefs));
    const sorted = timeline.filter(event => typeof event.at === "string" &&
        (event.sourceRefs.some(ref => selectedSources.has(ref)) ||
          event.entityRefs.some(ref => selectedEntities.has(ref))))
      .sort((a,b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
    const ids = [add("heading", "Recorded Project timeline")];
    sorted.forEach((event, i) => {
      event.sourceRefs.slice(0, 20).forEach(ref => dependencies.add(ref));
      ids.push(add("paragraph", event.at + " · " + restricted(event.title, 1000) + " · " + restricted(event.summary, 3000)
        + (event.sourceRefs.length ? "\nSource IDs: " + event.sourceRefs.slice(0, 20).join(", ") : "\nNo source ID recorded"), event.sourceRefs.slice(0, 20)));
    });
    if (sorted.length) sections.push({ id: "briefing-section-timeline", title: "Timeline", blockIds: ids });
  }
  const closingIds = [
    add("heading", "Verification and next steps"),
    add("paragraph", "Review original permitted Project sources, conflicting interpretations and data freshness. Only subsequently verified findings should become conclusions or external claims."),
    add("paragraph", unreferenced ? unreferenced + " selected insight(s) have no attached source IDs." : "All selected insights carry source identifiers. IDs alone do not establish content rights or truth."),
  ];
  sections.push({ id: "briefing-section-verification", title: "Verification", blockIds: closingIds });

  const content = reportArtifactContentSchema.parse({
    kind: "report", templateId: "lios.source-grounded-briefing.v1", blocks, sections,
    editorPreference: "builtin",
  });
  return { content, dependencyRefs: [...dependencies].slice(0, 200), included: items.length, unreferenced };
}
