import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, projects, users } from "./schemaCore";

/**
 * P7 Project Intelligence searchable projections.
 *
 * Chats/resources/artifacts/ledger remain authoritative; these tables are
 * rebuildable derived state and depend only on canonical Project roots.
 */

// ─── P7 Research, Project Intelligence and thesis state ────────────────────
// These rows are derived/searchable projections of existing Project state.
// Chats/resources/artifacts/ledger remain authoritative. The index can always
// be rebuilt and must never become a second source of truth.
export const projectIntelligenceDocuments = pgTable("project_intelligence_documents", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  sourceRefs: jsonb("source_refs").notNull().$type<string[]>().default([]),
  entityRefs: jsonb("entity_refs").notNull().$type<string[]>().default([]),
  contextRefs: jsonb("context_refs").notNull().$type<Record<string, string[]>>().default({}),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  embedding: jsonb("embedding").$type<number[]>(),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_intelligence_document_source_unique").on(table.projectId, table.sourceType, table.sourceRef),
  index("project_intelligence_document_project_idx").on(table.projectId, table.indexedAt),
  index("project_intelligence_document_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  index("project_intelligence_document_type_idx").on(table.projectId, table.sourceType, table.occurredAt),
  check("project_intelligence_document_hash_ck", sql`length(${table.contentHash}) = 64`),
  check("project_intelligence_document_type_ck", sql`${table.sourceType} IN ('chat','chat_message','resource','artifact','ledger_event','research_evidence','filing','assumption','decision','report','thesis','document')`),
]);

export const projectIntelligenceDocumentVersions = pgTable("project_intelligence_document_versions", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  contentHash: text("content_hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  sourceRefs: jsonb("source_refs").notNull().$type<string[]>().default([]),
  entityRefs: jsonb("entity_refs").notNull().$type<string[]>().default([]),
  contextRefs: jsonb("context_refs").notNull().$type<Record<string, string[]>>().default({}),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  embedding: jsonb("embedding").$type<number[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_intelligence_document_version_unique").on(table.projectId, table.sourceType, table.sourceRef, table.contentHash),
  index("project_intelligence_document_version_lookup_idx").on(table.projectId, table.sourceRef, table.contentHash),
  index("project_intelligence_document_version_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  check("project_intelligence_document_version_hash_ck", sql`length(${table.contentHash}) = 64`),
  check("project_intelligence_document_version_type_ck", sql`${table.sourceType} IN ('chat','chat_message','resource','artifact','ledger_event','research_evidence','filing','assumption','decision','report','thesis','document')`),
]);

export const projectIntelligenceSnapshots = pgTable("project_intelligence_snapshots", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  contentHash: text("content_hash").notNull(),
  graphHash: text("graph_hash").notNull(),
  manifest: jsonb("manifest").notNull().$type<Array<Record<string, unknown>>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_intelligence_snapshot_hash_unique").on(table.projectId, table.contentHash),
  index("project_intelligence_snapshot_project_idx").on(table.projectId, table.generatedAt),
  index("project_intelligence_snapshot_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  check("project_intelligence_snapshot_content_hash_ck", sql`length(${table.contentHash}) = 64`),
  check("project_intelligence_snapshot_graph_hash_ck", sql`length(${table.graphHash}) = 64`),
]);

export type ProjectIntelligenceDocumentRow = typeof projectIntelligenceDocuments.$inferSelect;
export type ProjectIntelligenceDocumentVersionRow = typeof projectIntelligenceDocumentVersions.$inferSelect;
export type ProjectIntelligenceSnapshotRow = typeof projectIntelligenceSnapshots.$inferSelect;
