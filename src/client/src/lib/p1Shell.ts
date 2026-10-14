import type { ConversationSourceScope } from "@shared/conversationRuntime";

export const P1_SOURCE_SCOPES: ReadonlyArray<{
  id: ConversationSourceScope;
  label: string;
  description: string;
}> = Object.freeze([
  { id: "auto", label: "Auto", description: "Let LiOS choose governed Project and connected sources." },
  { id: "my_data", label: "My Data", description: "Use Project/user-owned context; do not bypass it with external market retrieval." },
  { id: "web", label: "Web", description: "Use connected/external sources without silently including Project files or resources." },
  { id: "files", label: "Files", description: "Use only explicitly attached files as Project source material." },
]);

const SOURCE_SCOPE_KEY = "lios.p1.composer-source-scope.v1";
const TELEMETRY_KEY = "lios.p1.shell-telemetry.v1";

export function sourceScopeStorageKey(projectId: number | null): string {
  return projectId ? `${SOURCE_SCOPE_KEY}:project:${projectId}` : `${SOURCE_SCOPE_KEY}:global`;
}

export function loadComposerSourceScope(projectId: number | null): ConversationSourceScope {
  if (typeof window === "undefined") return "auto";
  try {
    const value = localStorage.getItem(sourceScopeStorageKey(projectId));
    return P1_SOURCE_SCOPES.some((scope) => scope.id === value) ? value as ConversationSourceScope : "auto";
  } catch {
    return "auto";
  }
}

export function saveComposerSourceScope(projectId: number | null, scope: ConversationSourceScope): void {
  if (typeof window === "undefined") return;
  if (!P1_SOURCE_SCOPES.some((item) => item.id === scope)) return;
  try { localStorage.setItem(sourceScopeStorageKey(projectId), scope); } catch { /* local UI preference is best-effort */ }
}

export function isComposerFocusShortcut(input: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}): boolean {
  return input.key.toLowerCase() === "k"
    && Boolean(input.metaKey || input.ctrlKey)
    && !input.altKey;
}

export type P1ShellTelemetryEvent =
  | "composer_focus_shortcut"
  | "composer_submit"
  | "composer_cancel"
  | "source_scope_change"
  | "shell_retry"
  | "shell_recovered"
  | "living_workspace_action";

export interface P1ShellTelemetrySnapshot {
  version: 1;
  counters: Record<P1ShellTelemetryEvent, number>;
  sourceScopeChanges: Record<ConversationSourceScope, number>;
  lastRecordedAt: number;
}

function emptyTelemetry(): P1ShellTelemetrySnapshot {
  return {
    version: 1,
    counters: {
      composer_focus_shortcut: 0,
      composer_submit: 0,
      composer_cancel: 0,
      source_scope_change: 0,
      shell_retry: 0,
      shell_recovered: 0,
      living_workspace_action: 0,
    },
    sourceScopeChanges: { auto: 0, my_data: 0, web: 0, files: 0 },
    lastRecordedAt: Date.now(),
  };
}

export function loadP1ShellTelemetry(): P1ShellTelemetrySnapshot {
  if (typeof window === "undefined") return emptyTelemetry();
  try {
    const parsed = JSON.parse(localStorage.getItem(TELEMETRY_KEY) || "null") as Partial<P1ShellTelemetrySnapshot> | null;
    if (!parsed || parsed.version !== 1) return emptyTelemetry();
    const empty = emptyTelemetry();
    return {
      version: 1,
      counters: { ...empty.counters, ...(parsed.counters ?? {}) },
      sourceScopeChanges: { ...empty.sourceScopeChanges, ...(parsed.sourceScopeChanges ?? {}) },
      lastRecordedAt: parsed.lastRecordedAt ?? Date.now(),
    };
  } catch {
    return emptyTelemetry();
  }
}

export function recordP1ShellEvent(event: P1ShellTelemetryEvent, sourceScope?: ConversationSourceScope): void {
  if (typeof window === "undefined") return;
  const snapshot = loadP1ShellTelemetry();
  snapshot.counters[event] += 1;
  if (event === "source_scope_change" && sourceScope) snapshot.sourceScopeChanges[sourceScope] += 1;
  snapshot.lastRecordedAt = Date.now();
  try { localStorage.setItem(TELEMETRY_KEY, JSON.stringify(snapshot)); } catch { /* privacy-safe telemetry is non-critical */ }
}

export const P1_SHELL_TELEMETRY_PRIVACY_CONTRACT = Object.freeze({
  localOnly: true,
  storesPromptText: false,
  storesFileNames: false,
  storesFileContents: false,
  storesProjectNames: false,
  storesClientNames: false,
  storesSymbols: false,
  storesProviderCredentials: false,
  storesOnlyCountersAndSourceScopeIds: true,
});

export type P1ShellLoadState = "loading" | "error" | "empty" | "ready";

export function deriveP1ShellLoadState(input: {
  projectsLoading: boolean;
  projectsError: boolean;
  projectHomeLoading: boolean;
  projectHomeError: boolean;
  messagesLoading: boolean;
  messagesError: boolean;
  projectCount: number;
  projectSelected: boolean;
  chatSelected: boolean;
}): P1ShellLoadState {
  if (input.projectsError || input.projectHomeError || input.messagesError) return "error";
  if (
    input.projectsLoading
    || (input.projectSelected && input.projectHomeLoading)
    || (input.chatSelected && input.messagesLoading)
  ) return "loading";
  if (input.projectCount === 0) return "empty";
  return "ready";
}


export type P1ComposerPersistenceTarget = "temporary" | "existing" | "project" | "quick";

export function resolveComposerPersistenceTarget(input: {
  chatMode: "project" | "quick" | "temporary";
  projectId: number | null;
  chatId: number | null;
}): P1ComposerPersistenceTarget {
  if (input.chatMode === "temporary") return "temporary";
  if (input.chatId) return "existing";
  if (input.chatMode === "project" && input.projectId) return "project";
  // P1 clean-install contract: an authenticated user with no Project can ask
  // immediately; LiOS persists that first conversation as a Quick Chat.
  return "quick";
}
