import { useCallback, useMemo, useState } from "react";

export interface ArtifactViewState { artifactId: string | null; focus: boolean; revision?: number | null }
const EMPTY: ArtifactViewState = { artifactId: null, focus: false };
const UUID = /^(?:artifact:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseArtifactView(value: unknown): ArtifactViewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY;
  const item = value as Record<string, unknown>;
  const revision = item.revision === null || item.revision === undefined ? item.revision : typeof item.revision === "number" && Number.isSafeInteger(item.revision) && item.revision > 0 ? item.revision : undefined;
  return item.version === 1 && typeof item.artifactId === "string" && UUID.test(item.artifactId) && typeof item.focus === "boolean"
    ? { artifactId: item.artifactId, focus: item.focus, ...(revision !== undefined ? { revision } : {}) } : EMPTY;
}
function readView(key: string | null): ArtifactViewState {
  if (!key || typeof window === "undefined") return EMPTY;
  try { return parseArtifactView(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { return EMPTY; }
}
export function conversationArtifactViewKey(ownerId: number | undefined, projectId: number | null, chatId: number | null): string | null {
  return ownerId && chatId ? `lios.artifact-view.v1.${ownerId}.${projectId ?? "quick"}.${chatId}` : null;
}
/** Only UI references are remembered. P4 still authorizes and loads the actual Artifact. */
export function useConversationArtifactView(ownerId: number | undefined, projectId: number | null, chatId: number | null) {
  const key = conversationArtifactViewKey(ownerId, projectId, chatId);
  const restored = useMemo(() => readView(key), [key]);
  const [current, setCurrent] = useState<{ key: string | null; value: ArtifactViewState }>({ key, value: restored });
  const state = current.key === key ? current.value : restored;
  const update = useCallback((change: Partial<ArtifactViewState>) => {
    setCurrent(previous => {
      const value = { ...(previous.key === key ? previous.value : restored), ...change };
      if (key) try {
        if (value.artifactId) localStorage.setItem(key, JSON.stringify({ version: 1, ...value }));
        else localStorage.removeItem(key);
      } catch { /* Unavailable storage must not block working in this session. */ }
      return { key, value };
    });
  }, [key, restored]);
  const setArtifact = useCallback((artifactId: string | null) => update({ artifactId, revision: null }), [update]);
  const setFocus = useCallback((focus: boolean) => update({ focus }), [update]);
  const setRevision = useCallback((revision: number | null) => update({ revision }), [update]);
  return [state.artifactId, setArtifact, state.focus, setFocus, restored.artifactId !== null, state.revision ?? null, setRevision] as const;
}
