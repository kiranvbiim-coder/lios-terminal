export interface DataRootOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  homedir?: string;
  localDatabase?: boolean;
}
export type DataRootSource = "LIOS_DATA_ROOT" | "LIMURIA_DATA_DIR" | "pointer" | "production_default" | "development_default";
export interface DataRootResolution {
  root: string;
  source: DataRootSource;
  home: string;
}
export interface PreparedDataRoot extends DataRootResolution {
  rootId: string;
  firstRun: boolean;
}
export interface DataRootMarker {
  version: number;
  rootId: string;
  createdAt: string;
  databaseInitialized: boolean;
  adoptedExistingData?: boolean;
  databaseInitializedAt?: string;
}
export type WorkspaceFoldResult =
  | { action: "no_legacy_workspace" | "already_folded" | "same_location" }
  | { action: "folded"; files: number; workspaceId: string };

export const DATA_ROOT_EXIT_CODE: 78;
export const MARKER_FILE: string;
export class DataRootUnavailableError extends Error {
  code: "root_missing" | "database_missing";
  details: { root: string; source: DataRootSource };
  constructor(code: "root_missing" | "database_missing", message: string, details: { root: string; source: DataRootSource });
}
export function resolveDataRoot(options?: DataRootOptions): DataRootResolution;
export function databaseDir(resolution: DataRootResolution): string;
export function stateDir(resolution: DataRootResolution): string;
export function prepareDataRoot(options?: DataRootOptions): PreparedDataRoot;
export function markDatabaseInitialized(options?: DataRootOptions): void;
export function readMarker(root: string): DataRootMarker | null;
export function foldLegacyWorkspace(input: { legacyRoot: string; targetRoot: string }): WorkspaceFoldResult;
export function readDataRootPointer(home: string): string | null;
export function moveDataRoot(input: { from: string; to: string; env?: NodeJS.ProcessEnv; homedir?: string }): { from: string; to: string; files: number; bytes: number };
export function clearDataRootPointer(input?: { env?: NodeJS.ProcessEnv; homedir?: string }): void;
