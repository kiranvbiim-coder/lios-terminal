import { pgTable, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./schemaCore";

/**
 * Paired devices (GM-09a). The Home stores only the device's Ed25519 public key; there is no device secret here.
 * A device acts as `ownerUserId` with `scopes` capped below admin (see shared/devicePairing.ts). Revocation sets
 * `revokedAt`; the row is kept so a revoked key can never be paired again as a new device by accident.
 */
export const pairedDevices = pgTable("paired_devices", {
  id: text("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  publicKey: text("public_key").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'["read","write"]'::jsonb`),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  commands: jsonb("commands").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  advertisedAt: timestamp("advertised_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("paired_devices_public_key_idx").on(table.publicKey),
  index("paired_devices_owner_idx").on(table.ownerUserId),
]);

export type PairedDeviceRow = typeof pairedDevices.$inferSelect;
