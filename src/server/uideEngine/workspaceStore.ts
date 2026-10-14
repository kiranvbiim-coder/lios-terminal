/**
 * Workspace Engine -- project-based organization for every engagement.
 *
 * Workspaces are personal terminal state. Every read/write carries the
 * authenticated owner id; an object id alone is never sufficient to retrieve
 * or mutate another analyst's workspace.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dataPath } from "../dataRoot";

export interface Workspace {
  id: string; name: string; clientName: string | null; description: string | null;
  symbols: string[]; tags: string[]; pinned: boolean; archived: boolean;
  createdByUserId: number; createdAt: string; updatedAt: string;
}
function normalizeWorkspace(raw: any): Workspace {
  return { ...raw, tags: Array.isArray(raw.tags) ? raw.tags : [], pinned: raw.pinned ?? false, archived: raw.archived ?? false };
}
function storeRoot(){return dataPath("workspaces");}
function ensureDir(): void { if (!fs.existsSync(storeRoot())) fs.mkdirSync(storeRoot(), { recursive: true }); }
function manifestPath(): string { return path.join(storeRoot(), "manifest.json"); }
function recordPath(id: string): string { return path.join(storeRoot(), `${id}.json`); }
function writeFileAtomic(file: string, contents: string): void { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, contents, "utf8"); fs.renameSync(tmp, file); }
function readManifest(): Workspace[] {
  ensureDir(); const file = manifestPath(); if (!fs.existsSync(file)) return [];
  try { return (JSON.parse(fs.readFileSync(file, "utf8")) as any[]).map(normalizeWorkspace); } catch { return []; }
}
function writeManifest(entries: Workspace[]): void { ensureDir(); writeFileAtomic(manifestPath(), JSON.stringify(entries, null, 2)); }
function owned(workspace: Workspace, userId: number): boolean { return workspace.createdByUserId === userId; }

export function listWorkspaces(userId: number): Workspace[] {
  return readManifest().filter((w) => owned(w, userId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function getWorkspace(id: string, userId: number): Workspace | null {
  const file = recordPath(id); if (!fs.existsSync(file)) return null;
  try { const workspace = normalizeWorkspace(JSON.parse(fs.readFileSync(file, "utf8"))); return owned(workspace, userId) ? workspace : null; } catch { return null; }
}
export function createWorkspace(input: { name: string; clientName?: string | null; description?: string | null; symbols?: string[]; tags?: string[]; createdByUserId: number; }): Workspace {
  ensureDir(); const now = new Date().toISOString();
  const workspace: Workspace = {
    id: crypto.randomUUID(), name: input.name, clientName: input.clientName ?? null, description: input.description ?? null,
    symbols: Array.from(new Set((input.symbols ?? []).map((s) => s.toUpperCase()))), tags: Array.from(new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))),
    pinned: false, archived: false, createdByUserId: input.createdByUserId, createdAt: now, updatedAt: now,
  };
  writeFileAtomic(recordPath(workspace.id), JSON.stringify(workspace, null, 2)); const manifest = readManifest(); manifest.push(workspace); writeManifest(manifest); return workspace;
}
export function updateWorkspace(id: string, userId: number, patch: Partial<Pick<Workspace, "name" | "clientName" | "description" | "pinned" | "archived">> & { addSymbol?: string; removeSymbol?: string; addTag?: string; removeTag?: string; symbols?: string[]; tags?: string[]; }): Workspace | null {
  const existing = getWorkspace(id, userId); if (!existing) return null;
  const symbols = new Set(patch.symbols ?? existing.symbols); if (patch.addSymbol) symbols.add(patch.addSymbol.toUpperCase()); if (patch.removeSymbol) symbols.delete(patch.removeSymbol.toUpperCase());
  const tags = new Set(patch.tags ?? existing.tags); if (patch.addTag) tags.add(patch.addTag.trim()); if (patch.removeTag) tags.delete(patch.removeTag.trim());
  const updated: Workspace = { ...existing, name: patch.name ?? existing.name, clientName: patch.clientName !== undefined ? patch.clientName : existing.clientName, description: patch.description !== undefined ? patch.description : existing.description, symbols: Array.from(symbols), tags: Array.from(tags), pinned: patch.pinned !== undefined ? patch.pinned : existing.pinned, archived: patch.archived !== undefined ? patch.archived : existing.archived, updatedAt: new Date().toISOString() };
  writeFileAtomic(recordPath(id), JSON.stringify(updated, null, 2)); const manifest = readManifest(); const idx = manifest.findIndex((w) => w.id === id && owned(w, userId)); if (idx !== -1) { manifest[idx] = updated; writeManifest(manifest); } return updated;
}
export function deleteWorkspace(id: string, userId: number): boolean {
  const workspace = getWorkspace(id, userId); if (!workspace) return false;
  fs.unlinkSync(recordPath(id)); writeManifest(readManifest().filter((w) => w.id !== id || !owned(w, userId))); return true;
}
export function duplicateWorkspace(id: string, userId: number): Workspace | null {
  const source = getWorkspace(id, userId); if (!source) return null;
  return createWorkspace({ name: `${source.name} (Copy)`, clientName: source.clientName, description: source.description, symbols: source.symbols, tags: source.tags, createdByUserId: userId });
}
