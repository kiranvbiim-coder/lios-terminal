import { createContext, useContext, useEffect, useRef, useState } from "react";
import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { getDesktopWorkspaceBridge, type ProtectedArtifactDraftAuthorizedScope, type ProtectedArtifactDraftSnapshot } from "./desktopWorkspace";
import { apiRequest } from "./queryClient";

export type NativeArtifactDraftContext = Omit<ProtectedArtifactDraftAuthorizedScope, "grant">;
type Status = "checking" | "ready" | "disabled" | "error";
export const NativeArtifactDraftOwnerContext = createContext<string | null>(null);
export function useNativeArtifactDraftOwner() { return useContext(NativeArtifactDraftOwnerContext); }
export interface NativeDraftLifetime { active: boolean }
export function useNativeDraftLifetime(key: string) {
  const lifetime = useRef<NativeDraftLifetime>({ active: false });
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => { current.active = false; };
  }, [key]);
  return lifetime;
}
interface RecoveryState { key: string; status: Status; candidate: ProtectedArtifactDraftSnapshot | null; notice: string | null }
const queues = new Map<string, Promise<unknown>>();
const writeEpochs = new Map<string, number>();
const epoch = (key: string) => writeEpochs.get(key) ?? 0;
export function nativeDraftRecoveryKey(context: Pick<NativeArtifactDraftContext, "owner" | "artifactId">): string {
  return context.owner.trim().toLowerCase() + "\0" + context.artifactId;
}
function bridge() {
  const native = getDesktopWorkspaceBridge();
  return native?.isElectron && native.artifactDraftRecoveryAvailable && native.readArtifactDraftRecovery
    && native.writeArtifactDraftRecovery && native.clearArtifactDraftRecovery ? native : null;
}
async function authorizedScope(context: NativeArtifactDraftContext): Promise<ProtectedArtifactDraftAuthorizedScope> {
  // Never retain a grant across account/session replacement. Electron independently
  // revalidates the live cookie-bound session before consuming this capability.
  const response = await apiRequest("POST", `/api/artifacts/${encodeURIComponent(context.artifactId)}/native-draft-grant`, { baseVersion: context.baseVersion, contentHash: context.contentHash });
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Native recovery permission is unavailable.");
  const result = body as { grant?: unknown; expiresAt?: unknown };
  if (typeof result.grant !== "string" || typeof result.expiresAt !== "number" || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new Error("Native recovery permission is invalid.");
  return { ...context, grant: result.grant };
}
function queueMutation<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  queues.set(key, current);
  const remove = () => { if (queues.get(key) === current) queues.delete(key); };
  void current.then(remove, remove);
  return current;
}
export async function clearNativeArtifactDraft(context: NativeArtifactDraftContext, lifetime: NativeDraftLifetime, expectedCheckpoint?: Pick<ProtectedArtifactDraftSnapshot, "baseVersion" | "contentHash"> & { checkpointId?: string }): Promise<boolean> {
  const native = bridge();
  if (!native || !lifetime.active) return false;
  const key = nativeDraftRecoveryKey(context);
  writeEpochs.set(key, epoch(key) + 1);
  return queueMutation(key, async () => {
    if (!lifetime.active || !await native.artifactDraftRecoveryAvailable!() || !lifetime.active) return false;
    const scope = await authorizedScope(context);
    if (!lifetime.active) return false;
    // The main-process encrypted store reports removed:false when another
    // editor has advanced the checkpoint. Do not call that a successful
    // discard: its newer unsaved data must remain protected.
    const result = await native.clearArtifactDraftRecovery!({ ...scope, expectedCheckpoint });
    return result.removed === true;
  });
}
export function matchesNativeArtifactDraft(candidate: ProtectedArtifactDraftSnapshot, context: NativeArtifactDraftContext, kind: string): boolean {
  const parsed = artifactContentSchema.safeParse(candidate.content);
  return candidate.baseVersion === context.baseVersion && candidate.contentHash === context.contentHash && parsed.success && parsed.data.kind === kind;
}

/** PR #102: encrypted native checkpoint only; canonical persistence remains P4. */
export function useNativeArtifactDraftRecovery<T extends ArtifactContent>(
  context: NativeArtifactDraftContext | null, draft: T, dirty: boolean, changeToken: unknown, applyRecovered: (content: T) => void,
) {
  const key = context ? `${nativeDraftRecoveryKey(context)}\0${context.baseVersion}\0${context.contentHash}` : "disabled";
  const [state, setState] = useState<RecoveryState>({ key: "", status: "checking", candidate: null, notice: null });
  const [retry, setRetry] = useState(0);
  const lifetime = useNativeDraftLifetime(`${key}\0${retry}`);
  const apply = useRef(applyRecovered);
  apply.current = applyRecovered;
  useEffect(() => {
    let live = true;
    const lease = lifetime.current;
    const native = bridge();
    if (!context || !native) { setState({ key, status: "disabled", candidate: null, notice: null }); return; }
    setState({ key, status: "checking", candidate: null, notice: null });
    void (async () => {
      try {
        if (!await native.artifactDraftRecoveryAvailable!()) {
          if (live && lease.active) setState({ key, status: "disabled", candidate: null, notice: null });
          return;
        }
        const identity = nativeDraftRecoveryKey(context);
        const readEpoch = epoch(identity);
        const candidate = await queueMutation(identity, async () => {
          if (!lease.active) return null;
          const scope = await authorizedScope(context);
          return lease.active ? native.readArtifactDraftRecovery!(scope) : null;
        });
        if (!live || !lease.active) return;
        if (readEpoch !== epoch(identity)) { setRetry(value => value + 1); return; }
        setState({ key, status: "ready", candidate, notice: null });
      } catch {
        if (live && lease.active) setState({ key, status: "error", candidate: null, notice: "Encrypted draft recovery could not be read. Your saved Artifact is unchanged." });
      }
    })();
    return () => { live = false; };
  }, [key, retry]);
  const ready = state.key === key && state.status === "ready";
  const candidate = ready ? state.candidate : null;
  const matching = Boolean(candidate && context && matchesNativeArtifactDraft(candidate, context, draft.kind));
  const dirtyHistory = useRef({ key, dirty: false });
  useEffect(() => {
    if (dirtyHistory.current.key !== key) dirtyHistory.current = { key, dirty: false };
    if (!ready || candidate) return;
    const wasDirty = dirtyHistory.current.dirty;
    dirtyHistory.current.dirty = dirty;
    const lease = lifetime.current;
    if (context && wasDirty && !dirty) void clearNativeArtifactDraft(context, lease).catch(() => {
      if (lease.active) setState(current => current.key === key ? { ...current, notice: "Unable to clear an obsolete checkpoint. Review recovery when reopening." } : current);
    });
  }, [key, ready, candidate, dirty]);
  useEffect(() => {
    if (!context || !ready || candidate || !dirty) return;
    const native = bridge();
    if (!native) return;
    const identity = nativeDraftRecoveryKey(context);
    const scheduledEpoch = epoch(identity);
    const lease = lifetime.current;
    const timer = setTimeout(() => {
      if (!lease.active || scheduledEpoch !== epoch(identity)) return;
      void queueMutation(identity, async () => {
        if (!lease.active || scheduledEpoch !== epoch(identity)) return;
        const scope = await authorizedScope(context);
        if (!lease.active || scheduledEpoch !== epoch(identity)) return;
        await native.writeArtifactDraftRecovery!({ ...scope, content: draft });
      }).catch(() => {
        if (lease.active && scheduledEpoch === epoch(identity)) setState(current => current.key === key ? { ...current, status: "error", notice: "Protected draft checkpoint failed. Save your Artifact revision to protect the work." } : current);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [key, ready, candidate, dirty, changeToken]);
  const discard = async () => {
    if (!context) return;
    const lease = lifetime.current;
    try {
      const expected = candidate ? { baseVersion: candidate.baseVersion, contentHash: candidate.contentHash, checkpointId: candidate.checkpointId } : undefined;
      const removed = await clearNativeArtifactDraft(context, lease, expected);
      if (!lease.active) return;
      if (!removed) {
        // A concurrent editor replaced the checkpoint, it disappeared, or
        // the native store is unavailable. Re-read the true protected state.
        // Never unblock this editor or claim the checkpoint was deleted.
        setState(current => current.key === key ? {
          ...current, status: "error", candidate: null,
          notice: "Encrypted checkpoint was not removed. It may have changed in another window. Retry protected recovery to inspect the current state; the saved Artifact is unchanged.",
        } : current);
        return;
      }
      setState(current => current.key === key ? { ...current, candidate: null, notice: "Encrypted recovery checkpoint discarded." } : current);
    } catch { if (lease.active) setState(current => current.key === key ? {
      ...current, status: "error", candidate: null,
      notice: "Unable to confirm encrypted checkpoint deletion. Retry protected recovery; the saved Artifact was not changed.",
    } : current); }
  };
  const restore = () => {
    if (!matching || !candidate) return;
    const parsed = artifactContentSchema.safeParse(candidate.content);
    if (!parsed.success) return;
    apply.current(parsed.data as T);
    setState(current => current.key === key ? { ...current, candidate: null, notice: "Local edits restored for review. Save to create a canonical revision." } : current);
  };
  return {
    status: state.key === key ? state.status : "checking" as Status, candidate, matching, discard, restore,
    clear: () => context ? clearNativeArtifactDraft(context, lifetime.current) : Promise.resolve(),
    retry: () => setRetry(value => value + 1),
    continueWithoutRecovery: () => {
      lifetime.current.active = false;
      setState({ key, status: "disabled", candidate: null, notice: "Recovery disabled for this editor. Save the canonical revision to protect new edits." });
    },
    notice: state.key === key ? state.notice : null,
    blocked: state.key !== key || state.status === "checking" || state.status === "error" || candidate !== null,
  };
}
