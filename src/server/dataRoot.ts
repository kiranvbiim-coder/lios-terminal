import path from "node:path";
import {
  DATA_ROOT_EXIT_CODE,
  DataRootUnavailableError,
  databaseDir as resolveDatabaseDir,
  markDatabaseInitialized as markInitialized,
  prepareDataRoot as prepare,
  readMarker,
  resolveDataRoot,
  stateDir as resolveStateDir,
  type DataRootOptions,
  type DataRootSource,
} from "../dataRootCore.cjs";

export { DATA_ROOT_EXIT_CODE, DataRootUnavailableError };
export type { PreparedDataRoot } from "../dataRootCore.cjs";

/**
 * GM-03: the single resolver for user-owned state. Server modules must call these instead of deriving
 * `~/.limuria-terminal`, `LIMURIA_DATA_DIR` or `cwd/data` themselves (enforced by dataRoot.test.ts).
 * Paths are resolved on each call so tests and relocation never observe a stale root.
 */
export function dataRoot(options?: DataRootOptions): string {
  return resolveDataRoot(options).root;
}

/** Which input chose the root; "production_default"/"development_default" mean nobody configured one; "pointer" is the folder the user chose. */
export function dataRootSource(options?: DataRootOptions): DataRootSource {
  return resolveDataRoot(options).source;
}

/** True when the operator or user chose the root explicitly instead of taking the default. */
export function dataRootIsExplicit(options?: DataRootOptions): boolean {
  const source = dataRootSource(options);
  return source === "LIOS_DATA_ROOT" || source === "LIMURIA_DATA_DIR" || source === "pointer";
}

/** A path inside the data root, e.g. `dataPath("history")`. */
export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}

/** Stable id of this data root (from its marker), or null before the root is prepared. */
export function dataRootId(options?: DataRootOptions): string | null {
  return readMarker(resolveDataRoot(options).root)?.rootId ?? null;
}

/** The PGlite directory. */
export function databaseDir(options?: DataRootOptions): string {
  return resolveDatabaseDir(resolveDataRoot(options));
}

/** Per-user state files (session secret, API-key digests, AI memory, audit log). */
export function stateDir(options?: DataRootOptions): string {
  return resolveStateDir(resolveDataRoot(options));
}

/** Call once at startup, before any module creates state. Throws DataRootUnavailableError for a vanished root. */
export function prepareDataRoot(options?: DataRootOptions) {
  return prepare(options);
}

export function markDatabaseInitialized(options?: DataRootOptions): void {
  markInitialized(options);
}
