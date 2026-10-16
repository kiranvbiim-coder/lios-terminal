import { pgTable, text, integer, real, boolean, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { P9NotificationPolicy, P9WorkflowAction, P9WorkflowTrigger } from "./p9AutomationContracts";
import { organizations, projects, users } from "./schemaCore";

/**
 * P9 durable automation definitions, executions and in-app notifications.
 * Credentials remain outside this schema domain.
 */

// ─── P9 Automation and Continuous Intelligence ─────────────────────────────
// Project workflows are durable definitions. Runs and in-app notification
// receipts are append-only history. Credentials are never stored here;
// actions reference LiOS-owned Project/Conversation/Artifact/provider contracts.
export const projectAutomationWorkflows = pgTable("project_automation_workflows", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  template: text("template").notNull().default("custom"),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").notNull().$type<P9WorkflowTrigger>(),
  action: jsonb("action").notNull().$type<P9WorkflowAction>(),
  notificationPolicy: jsonb("notification_policy").notNull().$type<P9NotificationPolicy>(),
  sourceRefs: jsonb("source_refs").notNull().$type<string[]>().default([]),
  engineRefs: jsonb("engine_refs").notNull().$type<string[]>().default([]),
  artifactRefs: jsonb("artifact_refs").notNull().$type<string[]>().default([]),
  eventCursor: jsonb("event_cursor").notNull().$type<Record<string, unknown>>().default({}),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("project_automation_workflows_project_idx").on(table.projectId, table.updatedAt),
  index("project_automation_workflows_due_idx").on(table.enabled, table.nextRunAt),
  index("project_automation_workflows_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  check("project_automation_workflows_name_ck", sql`char_length(${table.name}) BETWEEN 1 AND 200`),
  check("project_automation_workflows_template_ck", sql`${table.template} IN ('custom','filing_monitor','earnings_monitor','thesis_refresh','valuation_refresh','portfolio_monitor','provider_health','report_refresh')`),
  check("project_automation_workflows_failures_ck", sql`${table.consecutiveFailures} >= 0`),
]);

export const projectAutomationRuns = pgTable("project_automation_runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => projectAutomationWorkflows.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type").notNull(),
  triggerDetail: jsonb("trigger_detail").notNull().$type<Record<string, unknown>>().default({}),
  dedupeKey: text("dedupe_key"),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  summary: text("summary"),
  changed: boolean("changed").notNull().default(false),
  conditionMet: boolean("condition_met").notNull().default(false),
  relevanceScore: real("relevance_score").notNull().default(0),
  sourceRefs: jsonb("source_refs").notNull().$type<string[]>().default([]),
  engineRefs: jsonb("engine_refs").notNull().$type<string[]>().default([]),
  artifactRefs: jsonb("artifact_refs").notNull().$type<string[]>().default([]),
  executionReceiptIds: jsonb("execution_receipt_ids").notNull().$type<string[]>().default([]),
  output: jsonb("output").notNull().$type<Record<string, unknown>>().default({}),
  error: text("error"),
}, (table) => [
  index("project_automation_runs_workflow_idx").on(table.workflowId, table.startedAt),
  uniqueIndex("project_automation_runs_dedupe_unique").on(table.workflowId, table.dedupeKey),
  index("project_automation_runs_project_idx").on(table.projectId, table.startedAt),
  index("project_automation_runs_live_lease_idx").on(table.leaseExpiresAt).where(sql`${table.status} = 'running'`),
  index("project_automation_runs_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  check("project_automation_runs_trigger_ck", sql`${table.triggerType} IN ('manual','schedule','event')`),
  check("project_automation_runs_status_ck", sql`${table.status} IN ('running','succeeded','failed','skipped')`),
  check("project_automation_runs_relevance_ck", sql`${table.relevanceScore} >= 0 AND ${table.relevanceScore} <= 1`),
]);

export const projectAutomationNotifications = pgTable("project_automation_notifications", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull().references(() => projectAutomationWorkflows.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => projectAutomationRuns.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("in_app"),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  relevanceScore: real("relevance_score").notNull().default(0),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("project_automation_notifications_project_idx").on(table.projectId, table.createdAt),
  index("project_automation_notifications_workflow_idx").on(table.workflowId, table.createdAt),
  index("project_automation_notifications_scope_idx").on(table.organizationId, table.ownerUserId, table.projectId),
  check("project_automation_notifications_channel_ck", sql`${table.channel} IN ('in_app')`),
  check("project_automation_notifications_status_ck", sql`${table.status} IN ('delivered','suppressed')`),
  check("project_automation_notifications_reason_ck", sql`${table.reason} IN ('success','failure','condition_met','change_detected')`),
  check("project_automation_notifications_relevance_ck", sql`${table.relevanceScore} >= 0 AND ${table.relevanceScore} <= 1`),
]);

export type ProjectAutomationWorkflow = typeof projectAutomationWorkflows.$inferSelect;
export type ProjectAutomationRun = typeof projectAutomationRuns.$inferSelect;
export type ProjectAutomationNotification = typeof projectAutomationNotifications.$inferSelect;
