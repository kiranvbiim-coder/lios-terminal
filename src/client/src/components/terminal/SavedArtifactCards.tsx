import * as React from "react";
import { useQueries } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import { savedMessageArtifactRefs, type SavedMessageArtifactRef } from "@shared/conversationArtifactRefs";
import { useOwnedArtifacts, type ArtifactDetail, type ProjectArtifactRecord } from "@/lib/useArtifacts";
import { recordedArtifactPreview } from "@/lib/recordedArtifactPreview";
import { generatedImageFromContent } from "@/lib/generatedImageArtifact";

const KIND_LABEL: Record<string, string> = {
  chart: "Chart",
  table: "Table",
  screen: "Screen",
  valuation: "Valuation",
  portfolio: "Portfolio",
  research: "Research",
  thesis: "Thesis",
  report: "Report",
  spreadsheet: "Spreadsheet",
  data: "Data",
  backtest: "Backtest",
  strategy: "Strategy",
  decision: "Decision",
  timeline: "Timeline",
};

export interface SavedArtifactCardModel {
  id: string;
  title: string;
  kindLabel: string | null;
  version: number;
  ariaLabel: string;
  /** Only from an access-checked P4 lookup for this exact saved revision. */
  preview: string | null;
  /** The exact access-checked lookup of this Artifact version failed or returned another Project (deleted or no longer accessible). Absence from the active list alone never sets this. */
  unavailable: boolean;
  /** Data URL of a generated image from the exact access-checked revision. */
  thumbnail?: string | null;
}

/**
 * Card identity and version come from the exact retained message result.
 * Live list metadata is used only for availability and legacy display fallback.
 * Nothing is rerun or advanced to a newer head implicitly.
 */
export function describeSavedArtifactCard(ref: SavedMessageArtifactRef, live: Pick<ProjectArtifactRecord, "title" | "kind" | "headVersion"> | undefined, exactLookup: "pending" | "found" | "missing" = "pending", recordedPreview: string | null = null, exactKind: ProjectArtifactRecord["kind"] | null = null): SavedArtifactCardModel {
  const unavailable = !live && exactLookup === "missing";
  const title = ref.title ?? live?.title ?? "Saved Artifact";
  const kind = exactKind ?? ref.kind ?? live?.kind;
  const kindLabel = kind ? (KIND_LABEL[kind] ?? kind) : null;
  const version = ref.version;
  return {
    id: ref.id,
    title,
    kindLabel,
    version,
    preview: exactLookup === "found" ? recordedPreview : null,
    ariaLabel: unavailable
      ? `Saved Artifact ${title}${kindLabel ? `, ${kindLabel}` : ""}, version ${version} is unavailable`
      : `Open saved Artifact ${title}${kindLabel ? `, ${kindLabel}` : ""}, version ${version}`,
    unavailable,
  };
}

export function SavedArtifactCardList({ cards, activeId, onOpen }: {
  cards: SavedArtifactCardModel[];
  activeId: string | null;
  onOpen: (artifactId: string, version: number) => void;
}) {
  if (!cards.length) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2" role="group" aria-label="Saved Artifacts" data-testid="message-saved-artifacts">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          onClick={() => onOpen(card.id, card.version)}
          disabled={card.unavailable}
          aria-label={card.ariaLabel}
          aria-pressed={card.unavailable ? undefined : activeId === card.id}
          className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border/50 bg-black/20 px-2.5 py-2 text-left transition-colors hover:border-fuchsia-300/30 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border/50 disabled:hover:bg-black/20"
        >
          {card.thumbnail
            ? <img src={card.thumbnail} alt="" data-testid="artifact-card-thumbnail" className="h-10 w-10 shrink-0 rounded border border-border/50 object-cover"/>
            : <FileBarChart className="h-3.5 w-3.5 shrink-0 text-fuchsia-300" aria-hidden="true" />}
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block truncate font-ui text-[13px] text-foreground">{card.title}</span>
            {card.preview && <span data-testid="artifact-task-preview" className="block truncate font-ui text-[12px] text-muted-foreground">{card.preview}</span>}
          </span>
          {card.kindLabel && <span className="shrink-0 font-ui text-[12px] text-muted-foreground">{card.kindLabel}</span>}
          <span className="shrink-0 font-ui text-[12px] text-muted-foreground">v{card.version}</span>
          {card.unavailable
            ? <span className="shrink-0 font-ui text-[12px] font-medium text-muted-foreground">Unavailable</span>
            : <span className="shrink-0 font-ui text-[12px] font-medium text-amber-200">Open</span>}
        </button>
      ))}
    </div>
  );
}
export function savedArtifactMatchesScope(artifact: Pick<ProjectArtifactRecord, "projectId" | "owningChatId">, projectId: number | null, chatId: number | null): boolean {
  return projectId !== null ? artifact.projectId === projectId : chatId !== null && artifact.projectId === null && artifact.owningChatId === chatId;
}

/**
 * Fail closed when the exact saved revision, P4 identity, content-kind
 * contract or active Chat/Project boundary fails to match. This is an
 * additional client guard, not a replacement for server authorization.
 */
export function exactSavedArtifactDetail(
  ref: SavedMessageArtifactRef,
  candidate: ArtifactDetail | undefined,
  projectId: number | null,
  chatId: number | null,
): ArtifactDetail | null {
  if (!candidate
    || candidate.artifact.id !== ref.id
    || candidate.version.artifactId !== ref.id
    || candidate.version.version !== ref.version
    || candidate.artifact.kind !== candidate.version.content.kind
    || !savedArtifactMatchesScope(candidate.artifact, projectId, chatId)) return null;
  return candidate;
}

/**
 * Restores the saved-Artifact cards of an assistant message from its persisted metadata after reload/restart.
 * `onOpen` focuses the SAME canonical Artifact in the contextual panel; the panel loads it through the
 * tenant/Project access-checked Artifact query.
 */
export default function SavedArtifactCards({ metadata, projectId, chatId = null, activeId, onOpen }: {
  metadata: unknown;
  projectId: number | null;
  chatId?: number | null;
  activeId: string | null;
  onOpen: (artifactId: string, version: number) => void;
}) {
  const refs = savedMessageArtifactRefs(metadata);
  const list = useOwnedArtifacts({ projectId: refs.length ? projectId : null, owningChatId: refs.length ? chatId : null });
  // The active list is a bounded page that excludes archived Artifacts, so absence there proves nothing.
  // Fetch the exact saved revision for EVERY card: list data cannot authorize a content preview.
  const listed = list.data;
  const exact = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ["/api/artifacts", ref.id, "version", ref.version],
      queryFn: async (): Promise<ArtifactDetail> => {
        const res = await fetch(`/api/artifacts/${encodeURIComponent(ref.id)}?version=${ref.version}`);
        if (!res.ok) throw new Error("Failed to load Artifact.");
        return res.json();
      },
      enabled: Boolean(projectId || chatId),
      // Never display a previous browser user's cached content on a fresh
      // mount without a new current-session access-checked read.
      refetchOnMount: "always" as const,
    })),
  });
  if (!refs.length || (!projectId && !chatId)) return null;
  const cards = refs.map((ref, index) => {
    const fromList = listed?.find((artifact) => artifact.id === ref.id && savedArtifactMatchesScope(artifact, projectId, chatId));
    const query = exact[index];
    // Query caches and returned documents still get an exact identity, version and
    // ownership comparison before displaying a content-derived sentence.
    const detail = query?.isFetchedAfterMount && !query.isFetching && !query.isError
      ? exactSavedArtifactDetail(ref, query.data, projectId, chatId) : null;
    const live = fromList ?? (detail ? { title: detail.artifact.title, kind: detail.artifact.kind, headVersion: detail.artifact.headVersion } : undefined);
    const wrongIdentityOrScope = Boolean(query?.data) && Boolean(query?.isFetchedAfterMount) && !query?.isFetching && !detail;
    const lookup = live ? "found" : wrongIdentityOrScope || query?.isError ? "missing" : "pending";
    const image = detail ? generatedImageFromContent(detail.version.content) : null;
    const preview = image ? image.prompt || null : detail ? recordedArtifactPreview(detail.version.content) : null;
    const card = describeSavedArtifactCard(ref, live, lookup, preview, detail?.artifact.kind ?? null);
    return image ? { ...card, kindLabel: "Image", thumbnail: image.src } : card;
  });
  return <SavedArtifactCardList cards={cards} activeId={activeId} onOpen={onOpen} />;
}
