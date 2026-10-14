import { pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  userRoleEnum,
  organizationLifecycleStageEnum,
  projectStatusEnum,
} from "./schemaEnums";

/**
 * Identity, tenancy and canonical Project root tables.
 *
 * This module is deliberately dependency-light so every other schema domain
 * can depend on it without importing the monolithic compatibility barrel.
 */

// ─── Licensees (white-label tenants; null licenseeId = your own clients) ──
export const licensees = pgTable("licensees", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  brandConfig: jsonb("brand_config").$type<{ logoUrl?: string; primaryColor?: string }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Trial-to-Contract subsystem (see BUILD_PLAN): an org's commercial stage,
// orthogonal to `status` above (status is "can this org's users log in at
// all right now"; lifecycleStage is "where are they in the funnel"). Stored
// rather than derived so the internal pipeline dashboard (Phase C.5) can
// filter/index on it cheaply. Defaults to "client" -- every org that existed
// before this column was added is a real relationship already, not a trial.




// LV4-03-04: "mapped" once paddleProvider.parseWebhookEvent successfully
// normalizes the raw provider event; "unmapped" when the provider sent an
// event_type this adapter does not yet recognize. Unmapped events are
// still durably recorded (see billingWebhookEvents below) -- the event is
// acknowledged to stop pointless retries of a permanent code gap, not
// silently dropped.




// LV4-05-03: a "regular" session type can repeat (sequence 0, 1, ...) for
// exchanges with a split session -- Tokyo, Hong Kong, Shanghai, Shenzhen,
// and Singapore all close for a midday break rather than trading
// continuously, so "regular" is not always a single (start, end) pair.




// ─── Organizations (client companies) ──────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  licenseeId: integer("licensee_id").references(() => licensees.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"), // active | inactive
  lifecycleStage: organizationLifecycleStageEnum("lifecycle_stage").notNull().default("client"),
  // Null until the org's one-time trial credit allotment is granted; set
  // atomically (UPDATE ... WHERE trial_credits_granted_at IS NULL) so a
  // race between two concurrent first-access requests can never grant twice.
  // See server/trialAccess.ts.
  trialCreditsGrantedAt: timestamp("trial_credits_granted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Users (unified: internal employees AND client-org users) ─────────────
export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull(),
  // Set for client_admin/client_user, null for every internal_* role.
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at"),
  // Set whenever a password is admin-generated (new account or reset) --
  // cleared once the user sets their own permanent password. Enforced by
  // the client gating on this flag right after login, not just a hint.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Login lockout (brute-force protection): failedLoginAttempts resets to 0
  // on any successful login; hitting the threshold sets lockedUntil instead
  // of continuing to count indefinitely.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
});

export const insertUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  role: z.enum(["internal_admin", "internal_analyst", "internal_compliance", "client_admin", "client_user"]),
  organizationId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;


// ─── Projects (LIOS-P1-01) ─────────────────────────────────────────────────
// The Project is the primary organizational primitive per
// LIOS_MASTER_PLAN.md §3.1: a durable unit of work that may contain chats,
// entities/securities, files, models/assumptions, charts/tables/screens,
// reports, automations, branches/scenarios and decisions.
//
// Isolated by default per §5.2: "Project A does not silently retrieve
// Project B's private files or memory." RLS is not yet enabled (see
// src/migrations/0042_rls_tenant_isolation.sql), so isolation here is enforced at
// the service layer (server/projectStore.ts) via explicit
// ownerUserId/organizationId matching on every read and write -- never by
// trusting a bare id from the caller.
//
// This table is the base contract only. Linked chats (LIOS-P1-03),
// files/resources (LIOS-P1-04) and artifact references (LIOS-P4-*) are
// separate tables that reference projects.id; this table intentionally
// does not hold them inline.
export const projects = pgTable("projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  // Null for internal users (who have no organization, see tenantContext.ts);
  // set for client_admin/client_user, matching users.organizationId.
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  // Free-text "project instructions" per Master Plan §3.7 (Project Context).
  instructions: text("instructions"),
  // One-time P1 migration marker for the older filesystem Workbench store.
  // Never used as a credential/provider identifier.
  legacyWorkspaceId: text("legacy_workspace_id"),
  status: projectStatusEnum("status").notNull().default("active"),
  pinned: boolean("pinned").notNull().default(false),
  // Bumped on chat/artifact activity so Project Home can surface "recent"
  // without scanning child tables; see touchProjectActivity() in
  // projectStore.ts. Defaults to creation time so a brand-new empty project
  // still sorts sensibly before any activity exists.
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
}, (table) => [
  index("projects_owner_status_pinned_idx").on(table.ownerUserId, table.status, table.pinned),
  index("projects_owner_activity_idx").on(table.ownerUserId, table.lastActivityAt),
  index("projects_org_idx").on(table.organizationId),
  uniqueIndex("projects_owner_legacy_workspace_unique").on(table.ownerUserId, table.legacyWorkspaceId),
  index("projects_owner_trash_idx").on(table.ownerUserId, table.trashedAt),
]);

export const insertProjectSchema = z.object({
  ownerUserId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(4000).nullable().optional(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
