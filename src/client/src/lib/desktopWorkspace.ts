export interface DesktopWorkspaceInfo {
  version: number;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  connectorDirectory: string;
  datasetDirectory: string;
  exportDirectory: string;
}

export type VoiceRuntimeFileKind = "whisperExecutable" | "model" | "ffmpeg";

export interface VoiceRuntimeFileSelection {
  cancelled: boolean;
  kind: VoiceRuntimeFileKind;
  name?: string;
}

export type DesktopFolderPurpose = "backup-destination" | "data-folder";

export interface DesktopDataFolder {
  root: string;
  source: string;
  isDefault: boolean;
}

export interface ProtectedArtifactDraftAuthorizedScope {
  owner: string;
  artifactId: string;
  baseVersion: number;
  contentHash: string;
  grant: string;
}
export interface ProtectedArtifactDraftSnapshot {
  baseVersion: number;
  contentHash: string;
  /** Native-generated encrypted checkpoint generation; not P4 data authority. */
  checkpointId?: string;
  content: unknown;
}

interface DesktopWorkspaceBridge {
  isElectron: boolean;
  getWorkspaceInfo: () => Promise<DesktopWorkspaceInfo>;
  artifactDraftRecoveryAvailable?: () => Promise<boolean>;
  readArtifactDraftRecovery?: (identity: ProtectedArtifactDraftAuthorizedScope) => Promise<ProtectedArtifactDraftSnapshot | null>;
  writeArtifactDraftRecovery?: (input: ProtectedArtifactDraftAuthorizedScope & { content: unknown }) => Promise<{ protected: boolean }>;
  clearArtifactDraftRecovery?: (identity: ProtectedArtifactDraftAuthorizedScope & { expectedCheckpoint?: Pick<ProtectedArtifactDraftSnapshot, "baseVersion" | "contentHash"> & { checkpointId?: string } }) => Promise<{ removed: boolean }>;
  chooseFolder?: (purpose: DesktopFolderPurpose) => Promise<string | null>;
  getDataFolder?: () => Promise<DesktopDataFolder>;
  moveDataFolder?: (target: string) => Promise<{ relaunching: boolean } | void>;
  restoreBackup?: (passphrase?: string) => Promise<{ cancelled: boolean; relaunching: boolean }>;
  configureVoiceRuntimeFile?: (kind: VoiceRuntimeFileKind) => Promise<VoiceRuntimeFileSelection>;
  openExternal?: (url: string) => Promise<{ opened: boolean }>;
}

export function getDesktopWorkspaceBridge(): DesktopWorkspaceBridge | null {
  if (typeof window === "undefined") return null;
  const desktopWindow = window as unknown as { limuriaDesktop?: unknown };
  const candidate = desktopWindow.limuriaDesktop;
  if (!candidate || typeof candidate !== "object") return null;
  const bridge = candidate as Partial<DesktopWorkspaceBridge>;
  return typeof bridge.getWorkspaceInfo === "function" ? bridge as DesktopWorkspaceBridge : null;
}
