import crypto from "node:crypto";
import { and, desc, eq, like } from "drizzle-orm";
import { datasetSnapshots } from "@shared/schema";
import { getDb } from "./db";
import { stableSnapshotHash } from "./pointInTimeDatasetStore";

const MAX_SNAPSHOT_RECORDS = 10_000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export interface SourceSnapshotInput {
  connectionId: number;
  userId: number;
  organizationId: number | null;
  connectorId: string;
  operation: "api_fetch" | "api_mapping" | "database_query" | "database_profile";
  records?: Array<Record<string, unknown>>;
  columns?: string[];
  contractFamily?: string;
  mappings?: Array<{ sourceColumn: string; contractField: string; confidence: string }>;
  missingFields?: string[];
  rowCount?: number;
  retrievedAt?: string;
  sourceConfig?: Record<string, unknown>;
}

export interface SourceSnapshotResult {
  id: string;
  contentHash: string;
  created: boolean;
}

function snapshotPayload(input: SourceSnapshotInput): Record<string, unknown> {
  return {
    operation: input.operation,
    records: input.records ?? [],
    columns: input.columns ?? [],
    contractFamily: input.contractFamily ?? null,
    mappings: input.mappings ?? [],
    missingFields: input.missingFields ?? [],
    rowCount: input.rowCount ?? input.records?.length ?? 0,
  };
}

function snapshotSource(input: SourceSnapshotInput): string {
  return `source_connection:${input.connectionId}:${input.connectorId}`;
}

export async function persistSourceSnapshot(input: SourceSnapshotInput): Promise<SourceSnapshotResult> {
  const payload = snapshotPayload(input);
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (records.length > MAX_SNAPSHOT_RECORDS) {
    throw new Error(`Source result contains ${records.length} records; reduce the connector page size or page limit below ${MAX_SNAPSHOT_RECORDS}.`);
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (payloadBytes > MAX_SNAPSHOT_BYTES) {
    throw new Error(`Source result is ${payloadBytes} bytes; reduce the connector result below ${MAX_SNAPSHOT_BYTES} bytes.`);
  }

  const retrievedAt = input.retrievedAt ? new Date(input.retrievedAt) : new Date();
  if (Number.isNaN(retrievedAt.getTime())) throw new Error("Source retrieval time is invalid.");
  const source = snapshotSource(input);
  const datasetKey = `${source}:${input.operation}`;
  const entityKey = source;
  const lineage = {
    sourceConnectionId: input.connectionId,
    userId: input.userId,
    organizationId: input.organizationId,
    connectorId: input.connectorId,
    operation: input.operation,
    sourceConfig: input.sourceConfig ?? {},
  };
  const contentHash = stableSnapshotHash({ payload, lineage });
  const id = crypto.createHash("sha256").update(`${datasetKey}:${contentHash}`).digest("hex");
  const db = getDb();
  const [existing] = await db.select({ id: datasetSnapshots.id }).from(datasetSnapshots).where(eq(datasetSnapshots.id, id)).limit(1);
  if (existing) return { id, contentHash, created: false };
  const [parent] = await db.select({ id: datasetSnapshots.id }).from(datasetSnapshots)
    .where(and(eq(datasetSnapshots.datasetKey, datasetKey), eq(datasetSnapshots.entityKey, entityKey)))
    .orderBy(desc(datasetSnapshots.createdAt)).limit(1);
  await db.insert(datasetSnapshots).values({
    id,
    datasetKey,
    entityKey,
    dataClass: "external_source",
    schemaVersion: "1.0.0",
    source,
    provider: input.connectorId,
    frequency: "on_demand",
    timezone: "UTC",
    retrievedAt,
    availableAt: retrievedAt,
    contentHash,
    parentSnapshotId: parent?.id ?? null,
    quality: {
      recordCount: input.rowCount ?? records.length,
      persistedRecordCount: records.length,
      payloadBytes,
      missingFields: input.missingFields ?? [],
    },
    lineage,
    payload,
    createdByUserId: input.userId,
    organizationId: input.organizationId,
  });
  return { id, contentHash, created: true };
}

export async function getSourceSnapshot(id: string, userId: number) {
  const [snapshot] = await getDb().select().from(datasetSnapshots).where(and(
    eq(datasetSnapshots.id, id),
    eq(datasetSnapshots.dataClass, "external_source"),
    eq(datasetSnapshots.createdByUserId, userId),
  )).limit(1);
  return snapshot ?? null;
}

export async function listSourceSnapshots(connectionId: number, userId: number, limit = 100) {
  const sourcePrefix = `source_connection:${connectionId}:`;
  return getDb().select().from(datasetSnapshots).where(and(
    eq(datasetSnapshots.dataClass, "external_source"),
    eq(datasetSnapshots.createdByUserId, userId),
    like(datasetSnapshots.entityKey, `${sourcePrefix}%`),
  )).orderBy(desc(datasetSnapshots.createdAt)).limit(Math.min(Math.max(limit, 1), 250));
}
