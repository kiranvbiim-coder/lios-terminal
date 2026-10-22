import { useEffect, useRef, useState } from "react";
import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { getDesktopWorkspaceBridge, type ProtectedArtifactDraftIdentity, type ProtectedArtifactDraftSnapshot } from "./desktopWorkspace";

export interface NativeArtifactDraftContext extends ProtectedArtifactDraftIdentity {
  baseVersion: number;
  contentHash: string;
}
type Status = "checking" | "ready" | "disabled" | "error";
interface RecoveryState {
  key: string;
  status: Status;
  candidate: ProtectedArtifactDraftSnapshot | null;
  notice: string | null;
}
const queues = new Map<string, Promise<unknown>>();
// Invalidate any scheduled or queued pre-save write when the canonical P4
// revision has succeeded. Serialization alone does not cancel a late timer.
const writeEpochs = new Map<string, number>();
function writeEpoch(key: string): number { return writeEpochs.get(key) ?? 0; }
function queueMutation<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  queues.set(key, current);
  void current.then(() => { if (queues.get(key) === current) queues.delete(key); },
    () => { if (queues.get(key) === current) queues.delete(key); });
  return current;
}
function bridge() {
  const native = getDesktopWorkspaceBridge();
  return native?.isElectron && native.artifactDraftRecoveryAvailable
    && native.readArtifactDraftRecovery && native.writeArtifactDraftRecovery && native.clearArtifactDraftRecovery
    ? native : null;
}
export function nativeDraftRecoveryKey(identity: ProtectedArtifactDraftIdentity): string {
  return identity.owner.trim().toLowerCase() + "\0" + identity.artifactId;
}
export async function clearNativeArtifactDraft(identity: ProtectedArtifactDraftIdentity): Promise<void> {
  const native = bridge();
  if (!native) return;
  const key = nativeDraftRecoveryKey(identity);
  writeEpochs.set(key, writeEpoch(key) + 1);
  await queueMutation(key, async () => {
    await native.clearArtifactDraftRecovery!(identity);
  });
}
/**
 * A user who edits and then restores the exact saved content has no unsaved
 * work to recover. Only a true dirty-to-clean transition in this mounted editor
 * may remove its previous checkpoint; a second clean viewer must not clear it.
 */
export function shouldClearRevertedNativeDraft(
  wasDirty: boolean, nowDirty: boolean, ready: boolean, hasRecoveryCandidate: boolean,
): boolean {
  return ready && wasDirty && !nowDirty && !hasRecoveryCandidate;
}

export function matchesNativeArtifactDraft(
  candidate: ProtectedArtifactDraftSnapshot, context: NativeArtifactDraftContext, expectedKind: string,
): boolean {
  return candidate.baseVersion === context.baseVersion && candidate.contentHash === context.contentHash
    && candidate.content !== null && typeof candidate.content === "object"
    && (candidate.content as ArtifactContent).kind === expectedKind
    && artifactContentSchema.safeParse(candidate.content).success;
}

/**
 * Native-only OS protected checkpoint. A crash may interrupt the most recent
 * queued write; recovery is best effort, never a canonical save or AI consent.
 * No browser/localStorage plaintext fallback exists.
 */
export function useNativeArtifactDraftRecovery<T extends ArtifactContent>(
  context: NativeArtifactDraftContext | null,
  draft: T,
  dirty: boolean,
  changeToken: string | number,
  applyRecovered: (draft: T) => void,
) {
  const owner = context?.owner ?? "";
  const artifactId = context?.artifactId ?? "";
  const version = context?.baseVersion ?? 0;
  const hash = context?.contentHash ?? "";
  const key = owner + "\0" + artifactId + "\0" + version + "\0" + hash;
  const [state, setState] = useState<RecoveryState>({ key: "", status: "checking", candidate: null, notice: null });
  useEffect(() => {
    let live = true;
    setState({ key, status: "checking", candidate: null, notice: null });
    const native = bridge();
    if (!context || !native) {
      setState({ key, status: "disabled", candidate: null, notice: null });
      return () => { live = false; };
    }
    void (async () => {
      try {
        if (!await native.artifactDraftRecoveryAvailable!()) {
          if (live) setState({ key, status: "disabled", candidate: null, notice: null });
          return;
        }
        const candidate = await native.readArtifactDraftRecovery!(context);
        if (live) setState({ key, status: "ready", candidate, notice: null });
      } catch {
        if (live) setState({ key, status: "error", candidate: null, notice: "Encrypted draft recovery could not be read. Your saved Artifact is unchanged." });
      }
    })();
    return () => { live = false; };
  }, [key]);
  const ready = state.key === key && state.status === "ready";
  const candidate = ready ? state.candidate : null;
  const matching = candidate && context ? matchesNativeArtifactDraft(candidate, context, draft.kind) : false;
  const dirtyHistory = useRef({ key, dirty: false });
  useEffect(() => {
    if (dirtyHistory.current.key !== key) dirtyHistory.current = { key, dirty: false };
    if (!ready || candidate) return;
    const wasDirty = dirtyHistory.current.dirty;
    dirtyHistory.current.dirty = dirty;
    if (context && shouldClearRevertedNativeDraft(wasDirty, dirty, ready, false)) {
      void clearNativeArtifactDraft(context).catch(() => {
        setState(current => current.key === key
          ? { ...current, notice: "Unable to clear an obsolete checkpoint. Discard it when reopening." }
          : current);
      });
    }
  }, [key, ready, candidate, dirty]);
  useEffect(() => {
    if (!context || !ready || candidate || !dirty) return;
    const native = bridge();
    if (!native) return;
    // Keep writes serialized with delete-on-save; never let a delayed write
    // resurrect an already-committed draft after canonical P4 persistence.
    const identityKey = nativeDraftRecoveryKey(context);
    const scheduledEpoch = writeEpoch(identityKey);
    const timer = setTimeout(() => {
      if (scheduledEpoch !== writeEpoch(identityKey)) return;
      void queueMutation(identityKey, async () => {
        if (scheduledEpoch !== writeEpoch(identityKey)) return;
        await native.writeArtifactDraftRecovery!({ ...context, content: draft });
      }).catch(() => setState(current => current.key === key
        ? { ...current, status: "error", notice: "Protected draft checkpoint failed. Save the Artifact revision to protect your work." }
        : current));
    }, 250);
    return () => clearTimeout(timer);
  }, [key, ready, candidate, dirty, changeToken]);

  const discard = async () => {
    if (!context) return;
    try {
      await clearNativeArtifactDraft(context);
      setState(current => current.key === key ? { ...current, candidate: null, notice: null } : current);
    } catch {
      setState(current => current.key === key ? { ...current, notice: "Unable to discard encrypted recovery. The saved Artifact was not modified." } : current);
    }
  };
  const restore = () => {
    if (!matching || !candidate) return;
    const parsed = artifactContentSchema.safeParse(candidate.content);
    if (!parsed.success) return;
    // Apply normalized, schema-validated content only; stored plaintext strings
    // never become edit authority merely because OS decryption succeeded.
    applyRecovered(parsed.data as T);
    setState(current => current.key === key
      ? { ...current, candidate: null, notice: "Local edits restored for review. Save the Artifact to create a canonical revision." }
      : current);
  };
  return {
    status: state.key === key ? state.status : "checking" as Status,
    candidate,
    matching: Boolean(matching),
    restore,
    discard,
    notice: state.key === key ? state.notice : null,
    blocked: state.key !== key || state.status === "checking" || candidate !== null,
  };
}
