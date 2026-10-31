/**
 * Autosave coordination for one Artifact shown by more than one pane in this window (the Chat sidecar and the
 * Workbench pane both mount the same terminal screen and both write its default state).
 *
 * - Saves for one Artifact run one at a time, so two panes never race each other into a conflict.
 * - A newer revision created by this window is a valid base even while a pane's cached head lags behind it.
 * - A save whose content a sibling pane just stored is not written again.
 * The server still rejects a real concurrent edit from anywhere else.
 */
interface OwnSave { version: number; contentKey: string }

const ownSaves = new Map<string, OwnSave>();
const queues = new Map<string, Promise<unknown>>();

export function latestOwnSave(artifactId: string): OwnSave | null {
  return ownSaves.get(artifactId) ?? null;
}

export function recordOwnSave(artifactId: string, version: number, contentKey: string): void {
  const current = ownSaves.get(artifactId);
  if (!current || version >= current.version) ownSaves.set(artifactId, { version, contentKey });
}

/** Runs `task` after every earlier save for this Artifact has finished, whether it succeeded or failed. */
export function runSerializedSave<T>(artifactId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(artifactId) ?? Promise.resolve();
  const result = previous.then(task, task);
  queues.set(artifactId, result.catch(() => undefined));
  return result;
}

export function resolveSaveBase(input: { viewedVersion: number; headVersion: number; ownLatestVersion: number | null }):
  { ok: true; baseVersion: number } | { ok: false } {
  if (input.ownLatestVersion !== null && input.ownLatestVersion > input.viewedVersion) return { ok: true, baseVersion: input.ownLatestVersion };
  return input.viewedVersion === input.headVersion ? { ok: true, baseVersion: input.viewedVersion } : { ok: false };
}
