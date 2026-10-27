import type { ArtifactContent } from "@shared/artifactContracts";
import { reportArtifactContentSchema } from "@shared/artifactContracts";
import type { P7InsightLens, P7Insight, P7TimelineEvent } from "@shared/p7ResearchContracts";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";

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
  sourceRefs: string[];
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
  visuals: readonly PinnedBriefingVisual[] = [],
): BriefingDraft | null {
  if (!lens || lens.projectId !== selection.projectId ||
    !Number.isSafeInteger(selection.projectId) || selection.projectId <= 0) return null;
  const ids = new Set(selection.insightIds.slice(0, 16));
  const items = lens.insights.filter(insight => ids.has(insight.id)).slice(0, 16);
  if ((!items.length && !visuals.length) || !restricted(selection.title, 160)) return null;
  // Never silently drop source identifiers from the user-selected finding.
  if (items.some(item => item.sourceRefs.length > 50)) return null;
  if (visuals.length > 3 || new Set(visuals.map(v => v.artifactId)).size !== visuals.length ||
      visuals.some(v => v.projectId !== selection.projectId || !v.sourceRefs.length ||
        !/^[a-f0-9]{64}$/.test(v.contentHash) || v.version < 1)) return null;

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
  const recordedSources = new Set<string>();
  let unreferenced = 0;
  items.forEach((insight: P7Insight, index: number) => {
    const refs = [...new Set(insight.sourceRefs)].slice(0, 50);
    refs.forEach(ref => { dependencies.add(ref); recordedSources.add(ref); });
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
    if (sorted.some(event => event.sourceRefs.length > 20)) return null;
    if (sorted.length) {
      const ids = [add("heading", "Recorded Project timeline")];
      sorted.forEach(event => {
        event.sourceRefs.slice(0, 20).forEach(ref => { dependencies.add(ref); recordedSources.add(ref); });
        ids.push(add("paragraph", event.at + " · " + restricted(event.title, 1000) + " · " + restricted(event.summary, 3000)
          + (event.sourceRefs.length ? "\nSource IDs: " + event.sourceRefs.slice(0, 20).join(", ") : "\nNo source ID recorded"), event.sourceRefs.slice(0, 20)));
      });
      sections.push({ id: "briefing-section-timeline", title: "Timeline", blockIds: ids });
    }
  }
  // Native PowerPoint / DOCX export reads chart_ref and table attrs from the same
  // editable canonical P4 report. Never request external chart content during export.
  visuals.forEach((visual, index) => {
    const refs = [...new Set(visual.sourceRefs)].slice(0, 100);
    refs.forEach(ref => { dependencies.add(ref); recordedSources.add(ref); });
    dependencies.add("artifact:" + visual.artifactId);
    dependencies.add("artifact-version:" + visual.artifactId + ":v" + visual.version + ":" + visual.contentHash);
    const title = restricted(visual.title, 160);
    const heading = add("heading", title, refs);
    const metadata = { p4ArtifactId: visual.artifactId, p4Version: visual.version,
      p4ContentHash: visual.contentHash, sourceRefs: refs };
    const id = "briefing-visual-" + (index + 1);
    blocks.push(visual.content.kind === "chart"
      ? { id, type: "chart_ref", text: "Saved P4 chart v" + visual.version,
          attrs: { ...metadata, chart: visual.content } }
      : { id, type: "table", text: "Saved P4 table v" + visual.version,
          attrs: { ...metadata, table: visual.content } });
    const provenance = add("paragraph",
      "Recorded P4 " + visual.content.kind + " · Artifact " + visual.artifactId + " · version " +
      visual.version + " · content SHA-256 " + visual.contentHash + ". Sources are recorded identifiers, not redistribution grants.", refs);
    sections.push({ id: "briefing-section-visual-" + (index + 1),
      title: title, blockIds: [heading, id, provenance] });
  });
  const closingIds = [
    add("heading", "Verification and next steps"),
    add("paragraph", "Review original permitted Project sources, conflicting interpretations and data freshness. Only subsequently verified findings should become conclusions or external claims."),
    add("paragraph", unreferenced ? unreferenced + " selected insight(s) have no attached source IDs." : items.length ? "All selected insights carry source identifiers. IDs alone do not establish content rights or truth." : "Selected visuals carry recorded source identifiers. IDs alone do not establish content rights or truth."),
  ];
  sections.push({ id: "briefing-section-verification", title: "Verification", blockIds: closingIds });

  const content = reportArtifactContentSchema.parse({
    kind: "report", templateId: "lios.source-grounded-briefing.v1", blocks, sections,
    editorPreference: "builtin",
  });
  if (dependencies.size > 200 || recordedSources.size > 200) return null;
  return { content, dependencyRefs: [...dependencies], sourceRefs: [...recordedSources], included: items.length, unreferenced };
}
