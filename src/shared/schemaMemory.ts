import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { organizations, projects, users } from "./schemaCore";

/**
 * GM-19 / SI-03.01 durable memory authority.
 *
 * This is canonical long-lived user/Project memory. It is deliberately
 * separate from TC Working Context (bounded live orchestration state) and P7
 * Project Intelligence (derived/rebuildable retrieval index).
 */
export const durableMemoryScopeSchema = z.enum(["user", "project"]);
export const durableMemoryOriginClassSchema = z.enum(["owner", "agent", "untrusted", "system"]);
export const durableMemoryEpistemicStatusSchema = z.enum(["observed", "inferred", "confirmed"]);
export const durableMemoryStateSchema = z.enum(["active", "superseded", "deleted"]);

export type DurableMemoryScope = z.infer<typeof durableMemoryScopeSchema>;
export type DurableMemoryOriginClass = z.infer<typeof durableMemoryOriginClassSchema>;
export type DurableMemoryEpistemicStatus = z.infer<typeof durableMemoryEpistemicStatusSchema>;
export type DurableMemoryState = z.infer<typeof durableMemoryStateSchema>;

export const durableMemories = pgTable("durable_memories", {
  // Row identity and logical identity are separate so SI-03.03 can add
  // correction/tombstone revisions without changing the stable memory key.
  id: text("id").primaryKey(),
  memoryKey: text("memory_key").notNull(),
  revision: integer("revision").notNull().default(1),

  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  scope: text("scope").$type<DurableMemoryScope>().notNull(),

  kind: text("kind").notNull(),
  role: text("role"),
  content: text("content").notNull(),

  // OpenClaw memory-host donor analysis informed this explicit provenance
  // shape. LiOS owns the row/store; no donor session/SQLite authority is used.
  originClass: text("origin_class").$type<DurableMemoryOriginClass>().notNull(),
  originKind: text("origin_kind").notNull(),
  originRef: text("origin_ref"),
  epistemicStatus: text("epistemic_status").$type<DurableMemoryEpistemicStatus>().notNull().default("observed"),
  sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

  observedAt: timestamp("observed_at", { withTimezone: true }),
  state: text("state").$type<DurableMemoryState>().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("durable_memories_key_revision_unique").on(table.memoryKey, table.revision),
  index("durable_memories_owner_recent_idx").on(table.ownerUserId, table.organizationId, table.state, table.createdAt),
  index("durable_memories_project_recent_idx").on(table.projectId, table.state, table.createdAt),
  index("durable_memories_origin_idx").on(table.originKind, table.originRef),
  check("durable_memories_revision_ck", sql`${table.revision} >= 1`),
  check("durable_memories_scope_ck", sql`${table.scope} IN ('user', 'project')`),
  check("durable_memories_scope_project_ck", sql`
    (${table.scope} = 'user' AND ${table.projectId} IS NULL)
    OR
    (${table.scope} = 'project' AND ${table.projectId} IS NOT NULL)
  `),
  check("durable_memories_origin_class_ck", sql`${table.originClass} IN ('owner','agent','untrusted','system')`),
  check("durable_memories_epistemic_status_ck", sql`${table.epistemicStatus} IN ('observed','inferred','confirmed')`),
  check("durable_memories_state_ck", sql`${table.state} IN ('active','superseded','deleted')`),
  check("durable_memories_content_ck", sql`length(${table.content}) > 0`),
]);

export type DurableMemoryRow = typeof durableMemories.$inferSelect;
