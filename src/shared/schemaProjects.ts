import { pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  projectChatScopeEnum,
  projectChatStatusEnum,
  projectResourceContextModeEnum,
  projectSessionStatusEnum,
} from "./schemaEnums";
import { organizations, projects, users } from "./schemaCore";

/**
 * Project conversation, Session, ledger and Artifact persistence.
 *
 * The dependency direction is one-way: schemaProjects -> schemaCore.
 * It never imports schema.ts, preventing compatibility-barrel cycles.
 */

// P1 conversation threads. Temporary/private chats are intentionally NOT
// represented here: they remain renderer-memory only and disappear on close.
export const projectChats = pgTable("project_chats", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  scope: projectChatScopeEnum("scope").notNull(),
  title: text("title").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  status: projectChatStatusEnum("status").notNull().default("active"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  trashedByProjectId: integer("trashed_by_project_id").references(() => projects.id, { onDelete: "set null" }),
  trashedFromStatus: text("trashed_from_status"),
}, (table) => [
  index("project_chats_owner_scope_idx").on(table.ownerUserId, table.scope, table.status, table.lastActivityAt),
  index("project_chats_project_idx").on(table.projectId, table.status, table.lastActivityAt),
  index("project_chats_org_idx").on(table.organizationId),
  index("project_chats_owner_trash_idx").on(table.ownerUserId, table.trashedAt),
  check("project_chats_scope_project_ck", sql`
    (${table.scope} = 'project' AND ${table.projectId} IS NOT NULL)
    OR
    (${table.scope} = 'quick' AND ${table.projectId} IS NULL)
  `),
]);

export const projectChatMessages = pgTable("project_chat_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  chatId: integer("chat_id").notNull().references(() => projectChats.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("project_chat_messages_chat_idx").on(table.chatId, table.createdAt),
  check("project_chat_messages_role_ck", sql`${table.role} IN ('user','assistant','system')`),
]);

export const projectResources = pgTable("project_resources", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  resourceRef: text("resource_ref"),
  contextMode: projectResourceContextModeEnum("context_mode").notNull().default("project"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  trashedByProjectId: integer("trashed_by_project_id").references(() => projects.id, { onDelete: "set null" }),
  trashedFromStatus: text("trashed_from_status"),
}, (table) => [
  index("project_resources_project_idx").on(table.projectId, table.status, table.updatedAt),
  index("project_resources_owner_idx").on(table.ownerUserId),
  index("project_resources_org_idx").on(table.organizationId),
  index("project_resources_owner_trash_idx").on(table.ownerUserId, table.trashedAt),
]);

// A Session is a forkable analytical state, not an auth session and not a
// credential container. Workspace state is validated by shared/projectContracts.
export const projectSessions = pgTable("project_sessions", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  chatId: integer("chat_id").references(() => projectChats.id, { onDelete: "set null" }),
  parentSessionId: text("parent_session_id"),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: projectSessionStatusEnum("status").notNull().default("active"),
  workspaceState: jsonb("workspace_state").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  trashedByProjectId: integer("trashed_by_project_id").references(() => projects.id, { onDelete: "set null" }),
  trashedFromStatus: text("trashed_from_status"),
}, (table) => [
  index("project_sessions_project_idx").on(table.projectId, table.status, table.updatedAt),
  index("project_sessions_parent_idx").on(table.parentSessionId),
  index("project_sessions_chat_idx").on(table.chatId),
  index("project_sessions_owner_idx").on(table.ownerUserId),
  index("project_sessions_owner_trash_idx").on(table.ownerUserId, table.trashedAt),
  foreignKey({
    columns: [table.parentSessionId],
    foreignColumns: [table.id],
    name: "project_sessions_parent_session_id_project_sessions_id_fk",
  }).onDelete("set null"),
]);

// ─── P3 Ledger, reproducibility and change intelligence ────────────────────
// Append-only, tenant-scoped event streams. The service layer never exposes
// update/delete operations for ledger rows; stream heads serialize sequence
// allocation and make each stream tamper-evident through a SHA-256 hash chain.
export const projectLedgerStreamHeads = pgTable("project_ledger_stream_heads", {
  streamId: text("stream_id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  chatId: integer("chat_id").references(() => projectChats.id, { onDelete: "set null" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  nextSequence: integer("next_sequence").notNull().default(1),
  headHash: text("head_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("project_ledger_stream_heads_project_idx").on(table.projectId),
  index("project_ledger_stream_heads_owner_idx").on(table.ownerUserId),
  check("project_ledger_stream_heads_next_sequence_ck", sql`${table.nextSequence} >= 1`),
  check("project_ledger_stream_heads_head_hash_ck", sql`${table.headHash} IS NULL OR length(${table.headHash}) = 64`),
]);

export const projectLedgerEvents = pgTable("project_ledger_events", {
  id: text("id").primaryKey(),
  streamId: text("stream_id").notNull().references(() => projectLedgerStreamHeads.streamId, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  chatId: integer("chat_id").references(() => projectChats.id, { onDelete: "set null" }),
  sessionId: text("session_id").references(() => projectSessions.id, { onDelete: "set null" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  requestId: text("request_id"),
  receiptId: text("receipt_id"),
  correlationId: text("correlation_id"),
  causationId: text("causation_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  lineage: jsonb("lineage").$type<Record<string, unknown>>().notNull().default({ nodes: [], edges: [] }),
  reversible: boolean("reversible").notNull().default(false),
  inversePayload: jsonb("inverse_payload").$type<Record<string, unknown>>(),
  previousHash: text("previous_hash"),
  eventHash: text("event_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_ledger_events_stream_sequence_unique").on(table.streamId, table.sequence),
  uniqueIndex("project_ledger_events_receipt_unique").on(table.receiptId),
  uniqueIndex("project_ledger_events_single_revert_unique").on(table.causationId).where(
    sql`${table.eventType} = 'state.reverted' AND ${table.causationId} IS NOT NULL`,
  ),
  index("project_ledger_events_project_idx").on(table.projectId, table.createdAt),
  index("project_ledger_events_chat_idx").on(table.chatId, table.createdAt),
  index("project_ledger_events_session_idx").on(table.sessionId, table.createdAt),
  index("project_ledger_events_owner_idx").on(table.ownerUserId, table.createdAt),
  index("project_ledger_events_request_idx").on(table.requestId, table.createdAt),
  index("project_ledger_events_type_idx").on(table.eventType, table.createdAt),
  check("project_ledger_events_sequence_ck", sql`${table.sequence} >= 1`),
  check("project_ledger_events_hash_ck", sql`length(${table.eventHash}) = 64`),
  check("project_ledger_events_previous_hash_ck", sql`${table.previousHash} IS NULL OR length(${table.previousHash}) = 64`),
  check("project_ledger_events_actor_ck", sql`${table.actorType} IN ('user','system','engine','ai','provider')`),
  check("project_ledger_events_reversible_ck", sql`NOT ${table.reversible} OR ${table.inversePayload} IS NOT NULL`),
]);

export type ProjectLedgerStreamHead = typeof projectLedgerStreamHeads.$inferSelect;
export type ProjectLedgerEvent = typeof projectLedgerEvents.$inferSelect;

// ─── P4 Artifact Operating System ─────────────────────────────────────────
// Artifact identity is mutable only for title/status/head metadata. Artifact
// versions are immutable analytical work products; edits always append a new
// version so P3 lineage/reproducibility can remain trustworthy.
export const projectArtifacts = pgTable("project_artifacts", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  owningChatId: integer("owning_chat_id").references(() => projectChats.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  origin: text("origin").notNull().default("direct"),
  headVersion: integer("head_version").notNull().default(1),
  forkedFromArtifactId: text("forked_from_artifact_id"),
  forkedFromVersion: integer("forked_from_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  trashedByProjectId: integer("trashed_by_project_id").references(() => projects.id, { onDelete: "set null" }),
  trashedFromStatus: text("trashed_from_status"),
}, (table) => [
  index("project_artifacts_project_idx").on(table.projectId, table.status, table.updatedAt),
  index("project_artifacts_kind_idx").on(table.projectId, table.kind, table.updatedAt),
  index("project_artifacts_owner_idx").on(table.ownerUserId),
  index("project_artifacts_owner_trash_idx").on(table.ownerUserId, table.trashedAt),
  index("project_artifacts_chat_idx").on(table.owningChatId, table.status, table.updatedAt),
  check("project_artifacts_owner_context_ck", sql`${table.projectId} IS NOT NULL OR ${table.owningChatId} IS NOT NULL`),
  check("project_artifacts_kind_ck", sql`${table.kind} IN ('chart','table','screen','valuation','portfolio','research','report','spreadsheet','data','backtest','strategy','decision','timeline','thesis')`),
  check("project_artifacts_status_ck", sql`${table.status} IN ('active','archived')`),
  check("project_artifacts_origin_ck", sql`${table.origin} IN ('direct','conversation','import','fork','engine')`),
  check("project_artifacts_head_version_ck", sql`${table.headVersion} >= 1`),
  check("project_artifacts_fork_version_ck", sql`${table.forkedFromVersion} IS NULL OR ${table.forkedFromVersion} >= 1`),
  foreignKey({
    columns: [table.forkedFromArtifactId],
    foreignColumns: [table.id],
    name: "project_artifacts_forked_from_artifact_id_project_artifacts_id_fk",
  }).onDelete("set null"),
]);

export const projectArtifactVersions = pgTable("project_artifact_versions", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => projectArtifacts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  parentVersionId: text("parent_version_id"),
  adapterId: text("adapter_id").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  contentHash: text("content_hash").notNull(),
  sourceRefs: jsonb("source_refs").$type<string[]>().notNull().default([]),
  executionReceiptIds: jsonb("execution_receipt_ids").$type<string[]>().notNull().default([]),
  assumptionRefs: jsonb("assumption_refs").$type<string[]>().notNull().default([]),
  trustManifest: jsonb("trust_manifest").$type<Record<string, unknown> | null>(),
  dependencyRefs: jsonb("dependency_refs").$type<string[]>().notNull().default([]),
  refreshSpec: jsonb("refresh_spec").$type<Record<string, unknown> | null>(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_artifact_versions_artifact_version_unique").on(table.artifactId, table.version),
  index("project_artifact_versions_artifact_idx").on(table.artifactId, table.createdAt),
  index("project_artifact_versions_hash_idx").on(table.contentHash),
  check("project_artifact_versions_version_ck", sql`${table.version} >= 1`),
  check("project_artifact_versions_hash_ck", sql`length(${table.contentHash}) = 64`),
  foreignKey({
    columns: [table.parentVersionId],
    foreignColumns: [table.id],
    name: "project_artifact_versions_parent_version_id_project_artifact_versions_id_fk",
  }).onDelete("set null"),
]);

export const projectArtifactReferences = pgTable("project_artifact_references", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull().references(() => projectArtifacts.id, { onDelete: "cascade" }),
  version: integer("version"),
  targetType: text("target_type").notNull(),
  targetRef: text("target_ref").notNull(),
  label: text("label"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("project_artifact_references_unique").on(
    table.artifactId,
    sql`coalesce(${table.version}, 0)`,
    table.targetType,
    table.targetRef,
  ),
  index("project_artifact_references_project_idx").on(table.projectId, table.createdAt),
  index("project_artifact_references_target_idx").on(table.targetType, table.targetRef),
  check("project_artifact_references_version_ck", sql`${table.version} IS NULL OR ${table.version} >= 1`),
  check("project_artifact_references_target_type_ck", sql`${table.targetType} IN ('project','session','chat','resource','artifact')`),
]);

export const projectArtifactProposals = pgTable("project_artifact_proposals", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => projectArtifacts.id, { onDelete: "cascade" }),
  baseVersion: integer("base_version").notNull(),
  proposalType: text("proposal_type").notNull(),
  status: text("status").notNull().default("pending"),
  summary: text("summary").notNull(),
  diffs: jsonb("diffs").$type<Array<Record<string, unknown>>>().notNull().default([]),
  patch: jsonb("patch").$type<Record<string, unknown>>().notNull().default({}),
  proposedContentHash: text("proposed_content_hash").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => [
  index("project_artifact_proposals_artifact_idx").on(table.artifactId, table.status, table.createdAt),
  check("project_artifact_proposals_base_version_ck", sql`${table.baseVersion} >= 1`),
  check("project_artifact_proposals_type_ck", sql`${table.proposalType} IN ('spreadsheet_ai_diff','document_edit','artifact_patch')`),
  check("project_artifact_proposals_status_ck", sql`${table.status} IN ('pending','accepted','rejected','cancelled')`),
  check("project_artifact_proposals_hash_ck", sql`length(${table.proposedContentHash}) = 64`),
]);

export const artifactInteractionReceipts = pgTable("artifact_interaction_receipts", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => projectArtifacts.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(),
  fromVersion: integer("from_version"),
  toVersion: integer("to_version"),
  requestId: text("request_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("artifact_interaction_receipts_artifact_idx").on(table.artifactId, table.createdAt),
  index("artifact_interaction_receipts_request_idx").on(table.requestId, table.createdAt),
  check("artifact_interaction_receipts_actor_ck", sql`${table.actorType} IN ('user','conversation','system')`),
  check("artifact_interaction_receipts_action_ck", sql`${table.action} IN ('open','edit','keep','reference','fork','compare','export','archive','restore','create_version','propose_change','accept_change','reject_change','undo','rerun','inspect_source','import')`),
  check("artifact_interaction_receipts_from_version_ck", sql`${table.fromVersion} IS NULL OR ${table.fromVersion} >= 1`),
  check("artifact_interaction_receipts_to_version_ck", sql`${table.toVersion} IS NULL OR ${table.toVersion} >= 1`),
]);

export type ProjectArtifact = typeof projectArtifacts.$inferSelect;
export type ProjectArtifactVersion = typeof projectArtifactVersions.$inferSelect;
export type ProjectArtifactReference = typeof projectArtifactReferences.$inferSelect;
export type ProjectArtifactProposal = typeof projectArtifactProposals.$inferSelect;
export type ArtifactInteractionReceiptRow = typeof artifactInteractionReceipts.$inferSelect;

export const insertProjectChatSchema = z.object({
  projectId: z.number().int().positive().nullable(),
  scope: z.enum(["project", "quick"]),
  title: z.string().trim().min(1).max(200),
}).superRefine((value, ctx) => {
  if (value.scope === "project" && value.projectId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Project chats require projectId." });
  }
  if (value.scope === "quick" && value.projectId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Quick chats must not carry projectId." });
  }
});
export const insertProjectChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().trim().min(1).max(200_000),
  metadata: z.record(z.unknown()).optional(),
});
export const insertProjectResourceSchema = z.object({
  projectId: z.number().int().positive(),
  id: z.string().trim().min(1).max(200),
  kind: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(240),
  resourceRef: z.string().trim().max(1000).nullable().optional(),
  contextMode: z.enum(["project", "on_demand", "excluded"]).default("project"),
  metadata: z.record(z.unknown()).default({}),
});

export type ProjectChat = typeof projectChats.$inferSelect;
export type ProjectChatMessage = typeof projectChatMessages.$inferSelect;
export type ProjectResource = typeof projectResources.$inferSelect;
export type ProjectSession = typeof projectSessions.$inferSelect;
export type InsertProjectChat = z.infer<typeof insertProjectChatSchema>;
export type InsertProjectChatMessage = z.infer<typeof insertProjectChatMessageSchema>;
export type InsertProjectResource = z.infer<typeof insertProjectResourceSchema>;
