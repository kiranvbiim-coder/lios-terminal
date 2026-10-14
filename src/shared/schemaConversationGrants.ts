import { pgTable, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizations, projects, users } from "./schemaCore";

/**
 * Project-scoped action grants (GM-11a, owner decision Q6). This table is the only authority for "allow for this
 * Project": the browser can show and request grants, but a request body never carries one. Revoking deletes the row
 * (the run ledger keeps the history of what each run was allowed to do). "Allow once" approvals are single-use and
 * request-bound, so they live in memory (server/conversationGrantStore.ts), not here.
 */
export const conversationActionGrants = pgTable("conversation_action_grants", {
  id: text("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("conversation_action_grants_scope_idx").on(table.projectId, table.ownerUserId, table.action),
  index("conversation_action_grants_owner_idx").on(table.ownerUserId),
]);

export type ConversationActionGrantRow = typeof conversationActionGrants.$inferSelect;
