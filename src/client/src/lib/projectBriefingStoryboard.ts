import type { ArtifactContent } from "@shared/artifactContracts";
import type { ProjectArtifactRecord } from "./useArtifacts";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";
import { reportArtifactContentSchema } from "@shared/artifactContracts";

export type BriefingSource = Pick<
  ProjectArtifactRecord, "id" | "projectId" | "title" | "headVersion" | "kind" | "status"
>;

export interface BriefingDraftInput {
  projectId: number;
  title: string;
  introduction: string;
  sources: readonly BriefingSource[];
  visuals?: readonly PinnedBriefingVisual[];
}

export const MAX_BRIEFING_SOURCES = 8;

export function isReviewedBriefingSourceCurrent(source: BriefingSource, live: BriefingSource | undefined, projectId: number): boolean {
  return Boolean(live && source.projectId === projectId && live.projectId === projectId
    && live.status === "active" && source.status === "active"
    && live.id === source.id && live.headVersion === source.headVersion
    && live.kind === source.kind && live.title === source.title);
}

/**
 * P4 intentionally records at most the first 160 title characters in a visual
 * pin. Compare that recorded value, then separately require the *full* selected
 * source title to equal the live Project library title. A long legitimate
 * title must not make an otherwise current visual disappear.
 */
export function isRecordedBriefingVisualTitleCurrent(
  visual: Pick<PinnedBriefingVisual, "title">,
  source: BriefingSource,
): boolean {
  return visual.title === source.title.slice(0, 160);
}

/**
 * D06: Show only pinned visuals whose exact source is still selected and still
 * matches the current Project library. This is a read-only visibility gate;
 * every actual Save is rechecked by the authenticated P4 handler.
 */
export function currentProjectBriefingVisuals(
  pinned: readonly PinnedBriefingVisual[],
  selected: readonly BriefingSource[],
  liveById: ReadonlyMap<string, BriefingSource>,
  projectId: number,
): PinnedBriefingVisual[] {
  if (!Number.isSafeInteger(projectId) || projectId < 1) return [];
  const selectedHere = new Map(selected.filter(source => source.projectId === projectId)
    .map(source => [source.id, source]));
  return pinned.filter(visual => {
    const source = selectedHere.get(visual.artifactId);
    return visual.projectId === projectId && Boolean(source &&
      visual.version === source.headVersion &&
      isRecordedBriefingVisualTitleCurrent(visual, source) &&
      visual.content.kind === source.kind &&
      isReviewedBriefingSourceCurrent(source, liveById.get(source.id), projectId));
  });
}

/**
 * A user-reviewed, immutable outline referencing exact versions of authorized
 * existing Project Artifacts. This function does not access source contents,
 * generate claims, fetch media, create slides, or call an AI service.
 * The server remains authoritative for Project and Artifact permissions.
 */
export function buildProjectBriefingReport(input: BriefingDraftInput): {
  title: string;
  content: Extract<ArtifactContent, { kind: "report" }>;
  dependencyRefs: string[];
  sourceRefs: string[];
} {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 200) throw new Error("Enter a briefing title between 3 and 200 characters.");
  if (input.introduction.length > 2000) throw new Error("Briefing introduction exceeds 2,000 characters.");
  if (!input.sources.length || input.sources.length > MAX_BRIEFING_SOURCES) {
    throw new Error("Select between 1 and 8 saved Project sources.");
  }
  const ids = new Set<string>();
  for (const source of input.sources) {
    if (!source.id || ids.has(source.id)) throw new Error("Each selected source must be a different saved Artifact.");
    if (source.projectId !== input.projectId || source.status !== "active"
      || !Number.isSafeInteger(source.headVersion) || source.headVersion < 1) {
      throw new Error("A source is not an active saved Artifact in this Project.");
    }
    ids.add(source.id);
  }

  const visuals = input.visuals ?? [];
  if (visuals.length > 3 || new Set(visuals.map(visual => visual.artifactId)).size !== visuals.length)
    throw new Error("Choose up to three distinct saved chart/table versions.");
  for (const visual of visuals) {
    const owner = input.sources.find(source => source.id === visual.artifactId);
    if (!owner || owner.projectId !== input.projectId || visual.projectId !== input.projectId ||
        owner.headVersion !== visual.version || owner.kind !== visual.content.kind ||
        !/^[a-f0-9]{64}$/.test(visual.contentHash) ||
        !Array.isArray(visual.sourceRefs) || visual.sourceRefs.length < 1 || visual.sourceRefs.length > 100 ||
        visual.sourceRefs.some(ref => typeof ref !== "string" || !ref.trim() || ref.length > 1000)) {
      throw new Error("A saved visual must match an explicitly selected exact Project source version.");
    }
  }
  const visualById = new Map(visuals.map(visual => [visual.artifactId, visual]));
  const recordedSourceRefs = new Set<string>();
  const dependencies = new Set(input.sources.map(source => source.id));
  const cover = ["briefing-title", "briefing-introduction"];
  const intro = input.introduction.trim()
    || "Review this authored storyboard and open each saved Artifact to verify its content. References are not citations, slide images or permission to redistribute source material.";
  const blocks: Extract<ArtifactContent, { kind: "report" }>["blocks"] = [
    { id: cover[0], type: "heading", text: title, attrs: {} },
    { id: cover[1], type: "paragraph", text: intro, attrs: {} },
  ];
  const sections: Extract<ArtifactContent, { kind: "report" }>["sections"] = [
    { id: "briefing-cover", title: "Briefing overview", blockIds: cover },
  ];

  input.sources.forEach((source, index) => {
    const number = index + 1;
    const prefix = `briefing-frame-${number}`;
    const frame = [`${prefix}-title`, `${prefix}-source`, `${prefix}-review`];
    blocks.push(
      { id: frame[0], type: "heading", text: `Frame ${number}: ${source.title}`, attrs: {} },
      {
        id: frame[1], type: "artifact_ref",
        text: `Project Artifact: ${source.title} · ${source.kind} · version ${source.headVersion}`,
        attrs: {
          artifactId: source.id, artifactVersion: source.headVersion,
          projectId: input.projectId, artifactKind: source.kind,
          referenceStatus: "review_required",
        },
      },
      {
        id: frame[2], type: "paragraph",
        text: "Review the exact saved source and its rights, evidence and current validity before adding a figure or factual claim. No content has been copied or regenerated.",
        attrs: {},
      },
    );
    const visual = visualById.get(source.id);
    if (visual) {
      const refs = [...new Set(visual.sourceRefs)].slice(0, 100);
      refs.forEach(ref => recordedSourceRefs.add(ref));
      dependencies.add("artifact-version:" + visual.artifactId + ":v" + visual.version + ":" + visual.contentHash);
      const visualId = prefix + "-native-visual";
      const attrs = { p4ArtifactId: visual.artifactId, p4Version: visual.version,
        p4ContentHash: visual.contentHash, sourceRefs: refs };
      blocks.push(visual.content.kind === "chart"
        ? { id: visualId, type: "chart_ref", text: "Reviewed saved chart v" + visual.version,
            attrs: { ...attrs, chart: visual.content } }
        : { id: visualId, type: "table", text: "Reviewed saved table v" + visual.version,
            attrs: { ...attrs, table: visual.content } });
      const provenanceId = prefix + "-native-source";
      blocks.push({ id: provenanceId, type: "paragraph",
        text: "Exact saved P4 " + visual.content.kind + " version " + visual.version +
          " · SHA-256 " + visual.contentHash + ". Source IDs are not media redistribution rights.",
        attrs: { sourceRefs: refs } });
      frame.push(visualId, provenanceId);
    }
    sections.push({ id: prefix, title: `Frame ${number}: ${source.title}`, blockIds: frame });
  });

  return {
    title,
    content: reportArtifactContentSchema.parse({
      kind: "report", templateId: null, editorPreference: "builtin", blocks, sections,
    }),
    dependencyRefs: [...dependencies],
    sourceRefs: [...recordedSourceRefs],
  };
}
