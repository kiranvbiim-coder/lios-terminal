/**
 * Scenario Manager -- named snapshots of a workspace's shared assumption
 * VALUES (Base Case, Upside, Downside, ...), so switching scenarios is one
 * click instead of manually re-typing every assumption by hand each time.
 * Deliberately layered on top of the Assumption Center (assumptionStore.ts)
 * rather than a separate mechanism: a Scenario is just {assumption name ->
 * value} pairs captured at "Save Current as Scenario" time, and "Apply"
 * writes each one back through the same setAssumption()/grid.defineName()
 * path the Assumption Center already uses -- no new engine capability
 * needed, only a new place to store named bundles of the values that
 * mechanism already understands.
 *
 * Same one-JSON-file-per-workspace convention as assumptionStore.ts -- a
 * workspace realistically has a handful of scenarios, not thousands.
 */
import fs from "fs";
import path from "path";
import { dataPath } from "../dataRoot";

export interface Scenario {
  name: string;
  values: Record<string, number>; // assumption name (uppercase, matching assumptionStore's key shape) -> snapshotted value
  createdAt: string;
  updatedAt: string;
  updatedByUserId: number;
}

function storeRoot(){return dataPath("scenarios");}

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

export function listScenarios(workspaceId: string): Scenario[] {
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

export function saveScenario(workspaceId: string, name: string, values: Record<string, number>, userId: number): Scenario[] {
  const key = name.trim();
  const list = listScenarios(workspaceId);
  const idx = list.findIndex((s) => s.name === key);
  const now = new Date().toISOString();
  const entry: Scenario = {
    name: key,
    values,
    createdAt: idx >= 0 ? list[idx].createdAt : now,
    updatedAt: now,
    updatedByUserId: userId,
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify(list, null, 2));
  return list;
}

export function deleteScenario(workspaceId: string, name: string): Scenario[] {
  const key = name.trim();
  const list = listScenarios(workspaceId).filter((s) => s.name !== key);
  ensureDir();
  writeFileAtomic(recordPath(workspaceId), JSON.stringify(list, null, 2));
  return list;
}
