/**
 * Workspace Snapshots -- a manual, named checkpoint of a workspace record plus
 * an optional versioned analytical-shell envelope. The shell envelope captures
 * reproducible terminal context (panes/views/symbols/link identity/time context)
 * without absorbing the lifecycle of models, imports, assumptions, scenarios,
 * or portfolio records. Those remain independent objects and are never mutated
 * by restoring this checkpoint.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { isAnalyticalWorkspaceStateV2, type AnalyticalWorkspaceStateV2 } from "@shared/analyticalWorkspaceState";
import { dataPath } from "../dataRoot";

export interface WorkspaceSnapshot {
  id: string;
  workspaceId: string;
  label: string;
  name: string;
  clientName: string | null;
  description: string | null;
  tags: string[];
  symbols: string[];
  analyticalState: AnalyticalWorkspaceStateV2 | null;
  savedAt: string;
  savedByUserId: number;
}

function storeRoot(){return dataPath("workspace-snapshots");}

function ensureDir(): void {
  if (!fs.existsSync(storeRoot())) fs.mkdirSync(storeRoot(), { recursive: true });
}

function recordPath(workspaceId: string): string {
  return path.join(storeRoot(), `${workspaceId}.json`);
}

function writeFileAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

function normalizeSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<WorkspaceSnapshot> & { analyticalState?: unknown };
  if (
    typeof raw.id !== "string" || typeof raw.workspaceId !== "string" || typeof raw.label !== "string" ||
    typeof raw.name !== "string" || !(raw.clientName === null || typeof raw.clientName === "string") ||
    !(raw.description === null || typeof raw.description === "string") || !Array.isArray(raw.tags) ||
    !raw.tags.every((item) => typeof item === "string") || !Array.isArray(raw.symbols) ||
    !raw.symbols.every((item) => typeof item === "string") || typeof raw.savedAt !== "string" ||
    typeof raw.savedByUserId !== "number"
  ) return null;

  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    label: raw.label,
    name: raw.name,
    clientName: raw.clientName,
    description: raw.description,
    tags: raw.tags,
    symbols: raw.symbols,
    analyticalState: isAnalyticalWorkspaceStateV2(raw.analyticalState) ? raw.analyticalState : null,
    savedAt: raw.savedAt,
    savedByUserId: raw.savedByUserId,
  };
}

export function listSnapshots(workspaceId: string): WorkspaceSnapshot[] {
  const file = recordPath(workspaceId);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const normalized = normalizeSnapshot(item);
      return normalized ? [normalized] : [];
    }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function getSnapshot(workspaceId: string, snapshotId: string): WorkspaceSnapshot | null {
  return listSnapshots(workspaceId).find((s) => s.id === snapshotId) ?? null;
}

export function createSnapshot(
  workspaceId: string,
  fields: {
    label: string;
    name: string;
    clientName: string | null;
    description: string | null;
    tags: string[];
    symbols: string[];
    analyticalState?: AnalyticalWorkspaceStateV2 | null;
  },
  userId: number,
): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = {
    id: crypto.randomUUID(),
    workspaceId,
    label: fields.label.trim() || "Snapshot",
    name: fields.name,
    clientName: fields.clientName,
    description: fields.description,
    tags: fields.tags,
    symbols: fields.symbols,
    analyticalState: fields.analyticalState ?? null,
    savedAt: new Date().toISOString(),
    savedByUserId: userId,
  };
  const existing = listSnapshots(workspaceId);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify([snapshot, ...existing], null, 2));
  return snapshot;
}

export function deleteSnapshot(workspaceId: string, snapshotId: string): WorkspaceSnapshot[] {
  const remaining = listSnapshots(workspaceId).filter((s) => s.id !== snapshotId);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify(remaining, null, 2));
  return remaining;
}

export function deleteAllSnapshots(workspaceId: string): void {
  const file = recordPath(workspaceId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
