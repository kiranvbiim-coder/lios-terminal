import { pgTable, text, integer, real, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, projects, users } from "./schemaCore";

/**
 * P5 universal-data coverage, semantic metric, lineage and external-rights
 * persistence. Leaf domain: depends only on canonical identity/Project roots.
 */

// ─── P5 Universal Data Fabric & Semantic Finance ──────────────────────────
export const dataCoverageLedger = pgTable("data_coverage_ledger", {
  id: text("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  realUniverseSize: integer("real_universe_size").notNull(),
  indexedUniverseSize: integer("indexed_universe_size").notNull(),
  capacityProofSize: integer("capacity_proof_size").notNull(),
  warmSearchP95Ms: real("warm_search_p95_ms"),
  providerCount: integer("provider_count").notNull(),
  implementedProviderCount: integer("implemented_provider_count").notNull(),
  capabilityFamilyCount: integer("capability_family_count").notNull(),
  fieldStages: jsonb("field_stages").notNull().$type<Record<string, number>>(),
  gaps: jsonb("gaps").notNull().$type<string[]>().default([]),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("data_coverage_ledger_scope_idx").on(table.organizationId, table.ownerUserId, table.generatedAt),
  uniqueIndex("data_coverage_ledger_scope_hash_unique").on(
    table.ownerUserId,
    sql`coalesce(${table.organizationId}, 0)`,
    table.contentHash,
  ),
  check("data_coverage_ledger_sizes_ck", sql`${table.realUniverseSize} >= 0 AND ${table.indexedUniverseSize} >= 0 AND ${table.capacityProofSize} >= 0`),
]);

export const semanticMetricDefinitions = pgTable("semantic_metric_definitions", {
  id: text("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  metricId: text("metric_id").notNull(),
  version: integer("version").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  unit: text("unit"),
  aliases: jsonb("aliases").notNull().$type<string[]>().default([]),
  formula: text("formula"),
  sourcePolicy: jsonb("source_policy").notNull().$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("semantic_metric_scope_idx").on(table.organizationId, table.ownerUserId, table.metricId),
  uniqueIndex("semantic_metric_scope_version_unique").on(
    table.ownerUserId,
    sql`coalesce(${table.organizationId}, 0)`,
    table.metricId,
    table.version,
  ),
  check("semantic_metric_version_ck", sql`${table.version} >= 1`),
  check("semantic_metric_status_ck", sql`${table.status} IN ('active','deprecated')`),
]);

export const dataLineageReceipts = pgTable("data_lineage_receipts", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  requestId: text("request_id"),
  capability: text("capability").notNull(),
  entityRef: text("entity_ref").notNull(),
  pointInTime: jsonb("point_in_time").notNull().$type<Record<string, unknown>>(),
  stages: jsonb("stages").notNull().$type<Array<Record<string, unknown>>>(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("data_lineage_receipt_project_idx").on(table.projectId, table.createdAt),
  index("data_lineage_receipt_scope_idx").on(table.organizationId, table.ownerUserId, table.createdAt),
  index("data_lineage_receipt_request_idx").on(table.requestId),
  uniqueIndex("data_lineage_receipt_hash_unique").on(table.ownerUserId, table.contentHash),
]);



export const externalRightsAssessments = pgTable("external_rights_assessments", {
  id: text("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  subjectId: text("subject_id").notNull(),
  subjectKind: text("subject_kind").notNull(),
  version: integer("version").notNull(),
  rights: jsonb("rights").notNull().$type<Record<string, unknown>>(),
  notes: text("notes"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  reviewedByUserId: integer("reviewed_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("external_rights_scope_idx").on(table.organizationId, table.ownerUserId, table.subjectKind, table.subjectId),
  uniqueIndex("external_rights_scope_version_unique").on(
    table.ownerUserId,
    sql`coalesce(${table.organizationId}, 0)`,
    table.subjectKind,
    table.subjectId,
    table.version,
  ),
  check("external_rights_version_ck", sql`${table.version} >= 1`),
  check("external_rights_subject_kind_ck", sql`${table.subjectKind} IN ('software','api','data','model','asset','trademark','combined')`),
]);

export type ExternalRightsAssessment = typeof externalRightsAssessments.$inferSelect;
