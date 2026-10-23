import type { PluginTrustState } from "./p13PluginTrust";

/**
 * Background workflow dependency admission, NOT plugin execution authority.
 * P9 cannot inherit a P13 activation's grants from a recorded reference.
 * Actual invocations remain P13-brokered and subject to fresh GM-11 review.
 */
export interface P9PluginDependencyState {
  state: PluginTrustState;
  packageDigest: string | null;
  runtimeKind: string;
}

const PLUGIN_REFERENCE = /^plugin:([a-z0-9][a-z0-9._-]{2,179})$/;

/**
 * Explicit P13 package references must still resolve to a live installed,
 * currently trusted, digest-observed package. Unrelated engine/source refs
 * do not acquire a plugin dependency or broaden automation privileges.
 */
export function assertP9LivePluginDependencies(
  refs: readonly string[],
  resolve: (pluginId: string) => P9PluginDependencyState | null,
): void {
  const visited = new Set<string>();
  for (const ref of refs) {
    if (!ref.startsWith("plugin:")) continue;
    const match = PLUGIN_REFERENCE.exec(ref);
    if (!match) throw new Error("Saved automation has an invalid plugin package reference.");
    const id = match[1]!;
    if (visited.has(id)) continue;
    visited.add(id);
    const dependency = resolve(id);
    if (!dependency) {
      throw new Error("Saved automation plugin dependency is not currently installed.");
    }
    // A background workflow must not trust the cached installation decision,
    // even when P13 permits unprivileged unsigned *declarative* plugins.
    if (dependency.state !== "trusted" || !dependency.packageDigest) {
      throw new Error("Saved automation plugin dependency lacks current signed package trust.");
    }
  }
}
