/**
 * Assumption Center -- workspace-scoped shared assumptions (WACC, tax rate,
 * FX curve, ...), so a firm-wide number lives in one place instead of being
 * silently re-typed (and drifting) inside every model's own local
 * assumption cells.
 *
 * Deliberately built as an extension of the spreadsheet engine's existing
 * named-range mechanism rather than a parallel system: a named range today
 * binds a name to a target TEXT that gets spliced into a formula before
 * parsing (see spreadsheetEngine.ts's resolveNamedRanges) -- and that
 * target text can just as validly be a raw number ("8.5") as a cell ref
 * ("$C$8"), with zero engine changes needed. A shared assumption here is
 * exactly that: a name bound to a literal value, promoted from "scoped to
 * one grid" to "scoped to every model in this workspace." Importing one
 * into a model is just calling grid.defineName(name, String(value)).
 *
 * One JSON file per workspace (not a manifest+records split like
 * workspaceStore.ts/modelStore.ts) -- an assumption SET is the natural
 * record here, not each individual assumption, and a workspace realistically
 * has a handful of these, not thousands.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "../dataRoot";

export interface SharedAssumption {
  name: string;   // uppercase, same identifier shape as a spreadsheet name
  value: number;
  updatedAt: string;
  updatedByUserId: number;
}

function storeRoot(){return dataPath("assumptions");}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidAssumptionName(name: string): boolean {
  return NAME_RE.test(name.trim());
}

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

export function listAssumptions(workspaceId: string): SharedAssumption[] {
  const file = recordPath(workspaceId);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // A corrupt record shouldn't take down the whole feature -- same
    // honest-degrade contract as every other store in this app.
    return [];
  }
}

export function setAssumption(workspaceId: string, name: string, value: number, userId: number): SharedAssumption[] {
  const key = name.trim().toUpperCase();
  const list = listAssumptions(workspaceId);
  const idx = list.findIndex((a) => a.name === key);
  const entry: SharedAssumption = { name: key, value, updatedAt: new Date().toISOString(), updatedByUserId: userId };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify(list, null, 2));
  return list;
}

export function deleteAssumption(workspaceId: string, name: string): SharedAssumption[] {
  const key = name.trim().toUpperCase();
  const list = listAssumptions(workspaceId).filter((a) => a.name !== key);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify(list, null, 2));
  return list;
}
