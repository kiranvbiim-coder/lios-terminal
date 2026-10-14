/**
 * Component Marketplace -- reframed for what this app actually is: an
 * internal, single-firm tool where every user is staff (internal_admin/
 * internal_analyst/internal_compliance), not a multi-tenant platform with
 * outside publishers. So "marketplace" here means a firm-wide shared
 * library of reusable model fragments any analyst can publish and any
 * other analyst can browse and drop into their own model -- the discovery-
 * and-reuse value the roadmap's marketplace concept was actually after,
 * without inventing multi-tenant sharing/permissions infrastructure this
 * app has no use for.
 *
 * A component's `cells` are an A1-relative fragment (see
 * client/src/lib/componentFragment.ts) -- normalized once at publish time,
 * re-shifted to wherever a user inserts it. One shared JSON array file,
 * not per-record files: a firm's component library is small (tens, not
 * thousands, of entries) and always listed in full, so there's no benefit
 * to a manifest+records split here the way workspaceStore.ts/modelStore.ts
 * need for larger, individually-fetched record sets.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dataPath } from "../dataRoot";

export interface PublishedComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  cells: Record<string, string>;
  publishedByUserId: number;
  publishedAt: string;
}

function storeRoot(){return dataPath("component-library");}

function ensureDir(): void {
  if (!fs.existsSync(storeRoot())) fs.mkdirSync(storeRoot(), { recursive: true });
}

function filePath(): string {
  return path.join(storeRoot(), "components.json");
}

function writeFileAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

export function listComponents(): PublishedComponent[] {
  const file = filePath();
  if (!fs.existsSync(file)) return [];
  try {
    const components: PublishedComponent[] = JSON.parse(fs.readFileSync(file, "utf8"));
    return components.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  } catch {
    return [];
  }
}

export function getComponent(id: string): PublishedComponent | null {
  return listComponents().find((c) => c.id === id) ?? null;
}

export function publishComponent(
  fields: { name: string; description: string; category: string; cells: Record<string, string> },
  userId: number,
): PublishedComponent {
  const component: PublishedComponent = {
    id: crypto.randomUUID(),
    name: fields.name,
    description: fields.description,
    category: fields.category || "Uncategorized",
    cells: fields.cells,
    publishedByUserId: userId,
    publishedAt: new Date().toISOString(),
  };
  const existing = listComponents();
  ensureDir();
  writeFileAtomic(filePath(), JSON.stringify([component, ...existing], null, 2));
  return component;
}

export function deleteComponent(id: string): PublishedComponent[] {
  const remaining = listComponents().filter((c) => c.id !== id);
  ensureDir();
  writeFileAtomic(filePath(), JSON.stringify(remaining, null, 2));
  return remaining;
}
