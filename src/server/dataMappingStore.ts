import crypto from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  confirmedMappingInputSchema,
  validateConfirmedMappingTarget,
  type ConfirmedMappingInput,
  type DataTransform,
  type MappingTargetKind,
} from "@shared/dataMapping";
import { getDb } from "./db";

/**
 * Confirmed mappings need their own durable semantics: reusing entitlement,
 * finance-normalization, or generic settings tables would couple unrelated
 * domains. The table is owned by this store and bootstrapped idempotently on
 * first use so both embedded PGlite and hosted Postgres follow the same path.
 */
export const dataFieldMappings = pgTable("data_field_mappings", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id"),
  ownerUserId: integer("owner_user_id").notNull(),
  providerId: text("provider_id").notNull(),
  datasetKey: text("dataset_key").notNull(),
  providerField: text("provider_field").notNull(),
  targetFieldId: text("target_field_id").notNull(),
  targetKind: text("target_kind").notNull(),
  transform: text("transform").notNull().default("identity"),
  version: integer("version").notNull(),
  active: boolean("active").notNull().default(true),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("data_field_mapping_scope_idx").on(table.organizationId, table.ownerUserId),
  index("data_field_mapping_lookup_idx").on(table.organizationId, table.ownerUserId, table.providerId, table.datasetKey, table.providerField),
]);

export interface DataMappingScope {
  organizationId: number | null;
  ownerUserId: number;
}

export interface DataMappingIdentity extends DataMappingScope {
  providerId: string;
  datasetKey: string;
  providerField: string;
}

export interface StoredDataMapping extends DataMappingIdentity {
  id: string;
  targetFieldId: string;
  targetKind: MappingTargetKind;
  transform: DataTransform;
  version: number;
  active: boolean;
  executable: true;
  confirmedAt: string;
}

export interface DataMappingPersistence {
  list(scope?: Partial<DataMappingIdentity>): Promise<StoredDataMapping[]>;
  replaceActive(scope: DataMappingIdentity, next: StoredDataMapping): Promise<StoredDataMapping>;
}

function sameOrganization(left: number | null, right: number | null | undefined): boolean {
  return right === undefined || left === right;
}

function isSameIdentity(row: StoredDataMapping, identity: DataMappingIdentity): boolean {
  return row.organizationId === identity.organizationId &&
    row.ownerUserId === identity.ownerUserId &&
    row.providerId === identity.providerId &&
    row.datasetKey === identity.datasetKey &&
    row.providerField === identity.providerField;
}

function isInScope(row: StoredDataMapping, scope: Partial<DataMappingIdentity>): boolean {
  return sameOrganization(row.organizationId, scope.organizationId) &&
    (scope.ownerUserId === undefined || row.ownerUserId === scope.ownerUserId) &&
    (scope.providerId === undefined || row.providerId === scope.providerId) &&
    (scope.datasetKey === undefined || row.datasetKey === scope.datasetKey) &&
    (scope.providerField === undefined || row.providerField === scope.providerField);
}

export function createDataMappingStore(persistence: DataMappingPersistence) {
  return {
    async confirm(input: ConfirmedMappingInput): Promise<StoredDataMapping> {
      const parsed = validateConfirmedMappingTarget(confirmedMappingInputSchema.parse(input));
      const identity: DataMappingIdentity = {
        organizationId: parsed.organizationId,
        ownerUserId: parsed.ownerUserId,
        providerId: parsed.providerId,
        datasetKey: parsed.datasetKey,
        providerField: parsed.providerField,
      };
      const { providerField: _field, ...datasetScope } = identity;
      const activeDataset = await persistence.list(datasetScope);
      if (activeDataset.some(row => isInScope(row, datasetScope) && row.active && row.providerField !== parsed.providerField && row.targetFieldId === parsed.targetFieldId)) throw new Error("This canonical target already has an active mapping from another source column.");
      const prior = (await persistence.list(identity)).filter((row) => isSameIdentity(row, identity));
      const version = prior.reduce((max, row) => Math.max(max, row.version), 0) + 1;
      const next: StoredDataMapping = {
        id: crypto.randomUUID(),
        ...identity,
        targetFieldId: parsed.targetFieldId,
        targetKind: parsed.targetKind,
        transform: parsed.transform,
        version,
        active: true,
        executable: true,
        confirmedAt: new Date().toISOString(),
      };
      return persistence.replaceActive(identity, next);
    },

    async list(scope: DataMappingScope): Promise<StoredDataMapping[]> {
      if (scope.organizationId !== null && (!Number.isInteger(scope.organizationId) || scope.organizationId <= 0)) {
        throw new Error("organizationId must be null or a positive integer");
      }
      if (!Number.isInteger(scope.ownerUserId) || scope.ownerUserId <= 0) throw new Error("ownerUserId must be a positive integer");
      const rows = await persistence.list(scope);
      return rows.filter((row) => isInScope(row, scope)).sort((a, b) => b.version - a.version);
    },

    async getActive(identity: DataMappingIdentity): Promise<StoredDataMapping | null> {
      const rows = await persistence.list(identity);
      return rows
        .filter((row) => isSameIdentity(row, identity) && row.active)
        .sort((a, b) => b.version - a.version)[0] ?? null;
    },
  };
}

let tableReady: Promise<void> | null = null;

async function ensureDataMappingTable(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    await getDb().execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS data_field_mappings (
        id text PRIMARY KEY,
        organization_id integer,
        owner_user_id integer NOT NULL,
        provider_id text NOT NULL,
        dataset_key text NOT NULL,
        provider_field text NOT NULL,
        target_field_id text NOT NULL,
        target_kind text NOT NULL CHECK (target_kind IN ('canonical', 'extended')),
        transform text NOT NULL DEFAULT 'identity',
        version integer NOT NULL CHECK (version > 0),
        active boolean NOT NULL DEFAULT true,
        confirmed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `));
    await getDb().execute(sql.raw(`CREATE INDEX IF NOT EXISTS data_field_mapping_scope_idx
      ON data_field_mappings (organization_id, owner_user_id)`));
    await getDb().execute(sql.raw(`CREATE INDEX IF NOT EXISTS data_field_mapping_lookup_idx
      ON data_field_mappings (organization_id, owner_user_id, provider_id, dataset_key, provider_field)`));
    await getDb().execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS data_field_mapping_active_target_personal
      ON data_field_mappings (owner_user_id, provider_id, dataset_key, target_field_id)
      WHERE active = true AND organization_id IS NULL`));
    await getDb().execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS data_field_mapping_active_target_org
      ON data_field_mappings (organization_id, owner_user_id, provider_id, dataset_key, target_field_id)
      WHERE active = true AND organization_id IS NOT NULL`));
  })().catch((error) => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

function rowToStored(row: typeof dataFieldMappings.$inferSelect): StoredDataMapping {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    providerId: row.providerId,
    datasetKey: row.datasetKey,
    providerField: row.providerField,
    targetFieldId: row.targetFieldId,
    targetKind: row.targetKind as MappingTargetKind,
    transform: row.transform as DataTransform,
    version: row.version,
    active: row.active,
    executable: true,
    confirmedAt: row.confirmedAt.toISOString(),
  };
}

function organizationCondition(organizationId: number | null | undefined) {
  if (organizationId === undefined) return undefined;
  return organizationId === null
    ? isNull(dataFieldMappings.organizationId)
    : eq(dataFieldMappings.organizationId, organizationId);
}

export const databaseDataMappingPersistence: DataMappingPersistence = {
  async list(scope = {}) {
    await ensureDataMappingTable();
    const conditions = [
      organizationCondition(scope.organizationId),
      scope.ownerUserId === undefined ? undefined : eq(dataFieldMappings.ownerUserId, scope.ownerUserId),
      scope.providerId === undefined ? undefined : eq(dataFieldMappings.providerId, scope.providerId),
      scope.datasetKey === undefined ? undefined : eq(dataFieldMappings.datasetKey, scope.datasetKey),
      scope.providerField === undefined ? undefined : eq(dataFieldMappings.providerField, scope.providerField),
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
    const query = getDb().select().from(dataFieldMappings);
    const rows = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(dataFieldMappings.version))
      : await query.orderBy(desc(dataFieldMappings.version));
    return rows.map(rowToStored);
  },

  async replaceActive(scope, next) {
    await ensureDataMappingTable();
    const db = getDb();
    return db.transaction(async (tx) => {
      const orgCondition = organizationCondition(scope.organizationId);
      if (!orgCondition) throw new Error("mapping scope organization condition is required");
      const collisions = await tx.select({ id: dataFieldMappings.id, providerField: dataFieldMappings.providerField }).from(dataFieldMappings).where(and(
        orgCondition, eq(dataFieldMappings.ownerUserId, scope.ownerUserId),
        eq(dataFieldMappings.providerId, scope.providerId), eq(dataFieldMappings.datasetKey, scope.datasetKey),
        eq(dataFieldMappings.targetFieldId, next.targetFieldId), eq(dataFieldMappings.active, true),
      ));
      if (collisions.some(row => row.providerField !== scope.providerField)) throw new Error("This canonical target already has an active mapping from another source column.");
      await tx.update(dataFieldMappings).set({ active: false }).where(and(
        orgCondition,
        eq(dataFieldMappings.ownerUserId, scope.ownerUserId),
        eq(dataFieldMappings.providerId, scope.providerId),
        eq(dataFieldMappings.datasetKey, scope.datasetKey),
        eq(dataFieldMappings.providerField, scope.providerField),
        eq(dataFieldMappings.active, true),
      ));
      const [inserted] = await tx.insert(dataFieldMappings).values({
        id: next.id,
        organizationId: next.organizationId,
        ownerUserId: next.ownerUserId,
        providerId: next.providerId,
        datasetKey: next.datasetKey,
        providerField: next.providerField,
        targetFieldId: next.targetFieldId,
        targetKind: next.targetKind,
        transform: next.transform,
        version: next.version,
        active: next.active,
        confirmedAt: new Date(next.confirmedAt),
      }).returning();
      if (!inserted) throw new Error("Failed to persist confirmed data mapping");
      return rowToStored(inserted);
    });
  },
};

export const dataMappingStore = createDataMappingStore(databaseDataMappingPersistence);
