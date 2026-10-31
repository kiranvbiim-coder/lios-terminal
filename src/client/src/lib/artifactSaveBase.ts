/**
 * Which revision an autosave builds on. The pane's cached head lags its own previous save for a moment; saving
 * again from that stale base is rejected as a conflict with itself, which then blocks leaving the Workbench.
 * A newer revision this pane itself created is a valid base. The server still rejects a real concurrent edit.
 */
export function resolveSaveBase(input: { viewedVersion: number; headVersion: number; ownLatestVersion: number | null }):
  { ok: true; baseVersion: number } | { ok: false } {
  if (input.ownLatestVersion !== null && input.ownLatestVersion > input.viewedVersion) return { ok: true, baseVersion: input.ownLatestVersion };
  return input.viewedVersion === input.headVersion ? { ok: true, baseVersion: input.viewedVersion } : { ok: false };
}
