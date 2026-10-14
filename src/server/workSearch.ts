import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb } from "./db";
import type { TenantContext } from "./tenantContext";
import {
  projectArtifacts,
  projectChatMessages,
  projectChats,
  projectResources,
  projects,
} from "@shared/schema";
import {
  workSearchResponseSchema,
  type WorkSearchResult,
  type WorkSearchResponse,
} from "@shared/workSearch";

type OwnerColumns = { ownerUserId: any; organizationId: any };

function tenantClause(columns: OwnerColumns, ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(columns.ownerUserId, ctx.userId), isNull(columns.organizationId))
    : and(eq(columns.ownerUserId, ctx.userId), eq(columns.organizationId, ctx.organizationId));
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
}

export function workSearchSnippet(value: string | null | undefined, query: string, max = 220): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, max);
  const start = Math.max(0, index - Math.floor(max * 0.35));
  const end = Math.min(text.length, start + max);
  const body = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

function matchScore(value: string, query: string, base: number): number {
  const text = value.trim().toLowerCase();
  const q = query.toLowerCase();
  if (text === q) return base + 30;
  if (text.startsWith(q)) return base + 20;
  if (text.includes(q)) return base + 10;
  return base;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

type Scored = WorkSearchResult & { score: number };

export async function searchProjectWork(
  ctx: TenantContext,
  rawQuery: string,
  requestedLimit = 24,
): Promise<WorkSearchResponse> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 200);
  const limit = Math.min(Math.max(Math.floor(requestedLimit), 1), 50);
  if (query.length < 2) return { query, results: [] };

  const pattern = likePattern(query);
  const db = getDb();
  const [projectRows, chatRows, messageRows, artifactRows, resourceRows] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      instructions: projects.instructions,
      updatedAt: projects.updatedAt,
    }).from(projects).where(and(
      tenantClause(projects, ctx),
      eq(projects.status, "active"),
      isNull(projects.trashedAt),
      or(ilike(projects.name, pattern), ilike(projects.instructions, pattern)),
    )).orderBy(desc(projects.lastActivityAt)).limit(limit),

    db.select({
      id: projectChats.id,
      projectId: projectChats.projectId,
      title: projectChats.title,
      updatedAt: projectChats.updatedAt,
    }).from(projectChats).where(and(
      tenantClause(projectChats, ctx),
      eq(projectChats.status, "active"),
      isNull(projectChats.trashedAt),
      ilike(projectChats.title, pattern),
    )).orderBy(desc(projectChats.lastActivityAt)).limit(limit),

    db.select({
      chatId: projectChats.id,
      projectId: projectChats.projectId,
      title: projectChats.title,
      content: projectChatMessages.content,
      createdAt: projectChatMessages.createdAt,
    }).from(projectChatMessages)
      .innerJoin(projectChats, eq(projectChatMessages.chatId, projectChats.id))
      .where(and(
        tenantClause(projectChats, ctx),
        eq(projectChats.status, "active"),
        isNull(projectChats.trashedAt),
        ilike(projectChatMessages.content, pattern),
      ))
      .orderBy(desc(projectChatMessages.createdAt))
      .limit(Math.min(limit * 3, 100)),

    db.select({
      id: projectArtifacts.id,
      projectId: projectArtifacts.projectId,
      title: projectArtifacts.title,
      kind: projectArtifacts.kind,
      updatedAt: projectArtifacts.updatedAt,
    }).from(projectArtifacts).where(and(
      tenantClause(projectArtifacts, ctx),
      eq(projectArtifacts.status, "active"),
      isNull(projectArtifacts.trashedAt),
      ilike(projectArtifacts.title, pattern),
    )).orderBy(desc(projectArtifacts.updatedAt)).limit(limit),

    db.select({
      id: projectResources.id,
      projectId: projectResources.projectId,
      label: projectResources.label,
      kind: projectResources.kind,
      updatedAt: projectResources.updatedAt,
    }).from(projectResources).where(and(
      tenantClause(projectResources, ctx),
      eq(projectResources.status, "active"),
      isNull(projectResources.trashedAt),
      or(ilike(projectResources.label, pattern), ilike(projectResources.resourceRef, pattern)),
    )).orderBy(desc(projectResources.updatedAt)).limit(limit),
  ]);

  const scored: Scored[] = [];
  for (const row of projectRows) {
    scored.push({
      kind: "project",
      id: `project:${row.id}`,
      title: row.name,
      snippet: workSearchSnippet(row.instructions, query),
      projectId: row.id,
      chatId: null,
      artifactId: null,
      resourceId: null,
      updatedAt: iso(row.updatedAt),
      score: matchScore(row.name, query, 80),
    });
  }
  for (const row of chatRows) {
    scored.push({
      kind: "chat",
      id: `chat:${row.id}`,
      title: row.title,
      snippet: null,
      projectId: row.projectId,
      chatId: row.id,
      artifactId: null,
      resourceId: null,
      updatedAt: iso(row.updatedAt),
      score: matchScore(row.title, query, 90),
    });
  }
  for (const row of messageRows) {
    scored.push({
      kind: "chat",
      id: `chat:${row.chatId}`,
      title: row.title,
      snippet: workSearchSnippet(row.content, query),
      projectId: row.projectId,
      chatId: row.chatId,
      artifactId: null,
      resourceId: null,
      updatedAt: iso(row.createdAt),
      score: matchScore(row.content, query, 70),
    });
  }
  for (const row of artifactRows) {
    scored.push({
      kind: "artifact",
      id: `artifact:${row.id}`,
      title: row.title,
      snippet: row.kind.replace(/_/g, " "),
      projectId: row.projectId,
      chatId: null,
      artifactId: row.id,
      resourceId: null,
      updatedAt: iso(row.updatedAt),
      score: matchScore(row.title, query, 75),
    });
  }
  for (const row of resourceRows) {
    scored.push({
      kind: "file",
      id: `resource:${row.id}`,
      title: row.label,
      snippet: row.kind === "chat_attachment" ? "Attached file" : row.kind.replace(/_/g, " "),
      projectId: row.projectId,
      chatId: null,
      artifactId: null,
      resourceId: row.id,
      updatedAt: iso(row.updatedAt),
      score: matchScore(row.label, query, 72),
    });
  }

  const best = new Map<string, Scored>();
  for (const item of scored) {
    const existing = best.get(item.id);
    if (!existing || item.score > existing.score || (item.score === existing.score && item.updatedAt > existing.updatedAt)) {
      best.set(item.id, item);
    } else if (existing && !existing.snippet && item.snippet) {
      best.set(item.id, { ...existing, snippet: item.snippet });
    }
  }

  const results = [...best.values()]
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);

  return workSearchResponseSchema.parse({ query, results });
}
