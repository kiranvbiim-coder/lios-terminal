import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TenantContext } from "./tenantContext";

// Select an isolated real PGlite Home before loading database-dependent stores.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-data-pages-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, datasetSnapshots, columnarArtifacts } = await import("@shared/schema");
const { flattenSnapshotForColumnar, writeParquetRecords, scanColumnarArtifact } = await import("./columnarArtifactStore");
const { queryDataArtifact } = await import("./dataArtifactStore");

const inlineContent = {
  kind: "data",
  columns: [{ name: "value", type: "number" }],
  previewRows: Array.from({ length: 250 }, (_, value) => ({ value })),
  rowCount: 10_000,
  columnarArtifactId: null,
};

function values(result: { sample: Record<string, unknown>[] }) {
  return result.sample.map(row => row.value);
}

function sequence(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => start + index);
}

test("SI-04.07 DataArtifact pages use actual tenant-bound Parquet and bounded inline previews", { timeout: 90_000 }, async (t) => {
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await initDb();
  const [organization, otherOrganization] = await getDb().insert(organizations).values([
    { name: "Data page owner", slug: `data-pages-${crypto.randomUUID()}` },
    { name: "Other data page tenant", slug: `data-pages-${crypto.randomUUID()}` },
  ]).returning();
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Data owner", role: "internal_analyst" as const, organizationId: organization.id },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Other tenant", role: "internal_analyst" as const, organizationId: otherOrganization.id },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, role: owner.role, organizationId: organization.id };
  const strangerCtx: TenantContext = { userId: stranger.id, role: stranger.role, organizationId: otherOrganization.id };
  const snapshotId = crypto.randomUUID();
  const payload = {
    seriesId: "PAGE_FIXTURE", name: "Paging fixture", unit: "units", category: "test", provider: "fixture", frequency: "daily",
    observations: Array.from({ length: 525 }, (_, value) => ({
      date: value < 275 ? "2026-10-06" : "2026-10-07", value,
      realtimeStart: null, realtimeEnd: null, availableAt: "2026-10-07T12:00:00.000Z",
    })),
  };
  const [snapshot] = await getDb().insert(datasetSnapshots).values({
    id: snapshotId, datasetKey: `paging:${snapshotId}`, entityKey: "PAGE_FIXTURE", dataClass: "economic_series", schemaVersion: "1.0.0",
    source: "import", provider: "fixture", frequency: "daily", retrievedAt: new Date("2026-10-07T12:00:00Z"), availableAt: new Date("2026-10-07T12:00:00Z"),
    contentHash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"), quality: {}, lineage: {}, payload,
    organizationId: organization.id, createdByUserId: owner.id,
  }).returning();
  const relativePath = `economic_series/${snapshotId}.parquet`;
  const file = path.join(dataDir, "columnar", relativePath);
  const written = await writeParquetRecords(flattenSnapshotForColumnar(snapshot).records, file);
  const contentHash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const [artifact] = await getDb().insert(columnarArtifacts).values({
    id: crypto.randomUUID(), datasetSnapshotId: snapshotId, relativePath, contentHash,
    rowCount: written.rowCount, schema: written.schema, createdByUserId: owner.id,
  }).returning();
  const content = { ...inlineContent, rowCount: 525, columnarArtifactId: artifact.id };

  await t.test("linked P4 bridge forwards offsets, preserves date ties, and reaches every actual row once", async () => {
    const observed: unknown[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await queryDataArtifact(content, { offset, limit: 100 }, ctx);
      assert.equal(page.mode, "duckdb");
      assert.equal(page.offset, offset);
      assert.equal(page.limit, 100);
      assert.equal(page.rowCount, 525);
      assert.equal(page.availableRowCount, 525);
      assert.ok("summary" in page && page.summary && typeof page.summary === "object");
      const summary = page.summary;
      assert.ok("row_count" in summary && "valid_count" in summary && "minimum" in summary && "maximum" in summary && "mean" in summary && "standard_deviation" in summary);
      assert.deepEqual([summary.row_count, summary.valid_count, summary.minimum, summary.maximum, summary.mean], [525, 525, 0, 524, 262]);
      assert.equal(typeof summary.standard_deviation, "number");
      assert.ok(Math.abs(Number(summary.standard_deviation) - Math.sqrt(525 * 526 / 12)) < 1e-10);
      assert.ok(page.sample.length > 0 && page.sample.length <= 100);
      assert.ok(page.sample.every(row => !("file_row_number" in row)));
      observed.push(...values(page));
      if (page.nextOffset !== null) assert.equal(page.nextOffset, offset + page.sample.length);
      offset = page.nextOffset;
    }
    assert.deepEqual(observed, [...sequence(275, 250), ...sequence(0, 275)]);
    assert.equal(new Set(observed).size, 525);
    const repeat = await queryDataArtifact(content, { offset: 100, limit: 100 }, ctx);
    assert.deepEqual(values(repeat), sequence(375, 100));
    const last = await queryDataArtifact(content, { offset: 500, limit: 100 }, ctx);
    assert.deepEqual(values(last), sequence(250, 25));
    assert.equal(last.nextOffset, null);
    for (const endOffset of [525, 900]) {
      const end = await queryDataArtifact(content, { offset: endOffset, limit: 100 }, ctx);
      assert.equal(end.offset, endOffset);
      assert.equal(end.availableRowCount, 525);
      assert.deepEqual(end.sample, []);
      assert.equal(end.nextOffset, null);
    }
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), contentHash, "paging never rewrites the source projection");
  });

  await t.test("date filters count all matching rows, not only the page, and retain source total", async () => {
    const filtered = await queryDataArtifact(content, { dateFrom: "2026-10-07", dateTo: "2026-10-07", offset: 200, limit: 100 }, ctx);
    assert.equal(filtered.rowCount, 525);
    assert.equal(filtered.availableRowCount, 250);
    assert.equal(filtered.offset, 200);
    assert.deepEqual(values(filtered), sequence(475, 50));
    assert.equal(filtered.nextOffset, null);
    assert.ok("summary" in filtered && filtered.summary && typeof filtered.summary === "object" && "row_count" in filtered.summary);
    assert.equal(filtered.summary.row_count, 250);
    const empty = await queryDataArtifact(content, { dateFrom: "2026-10-08", limit: 100 }, ctx);
    assert.equal(empty.availableRowCount, 0);
    assert.deepEqual(empty.sample, []);
    assert.equal(empty.nextOffset, null);
  });

  await t.test("direct scanner retains its sample default, cap, and summary behavior", async () => {
    const defaultPage = await scanColumnarArtifact(artifact.id, {}, ctx);
    assert.ok(defaultPage);
    assert.equal(defaultPage.limit, 20);
    assert.equal(defaultPage.offset, 0);
    assert.equal(defaultPage.nextOffset, 20);
    assert.deepEqual(values(defaultPage), sequence(275, 20));
    const capped = await queryDataArtifact(content, { limit: 500, offset: 200 }, ctx);
    assert.equal(capped.limit, 200);
    assert.equal(capped.sample.length, 200);
    assert.equal(capped.nextOffset, 400);
  });

  await t.test("actual scanner denies foreign tenants before opening their Parquet file", async () => {
    await assert.rejects(queryDataArtifact(content, { offset: 100, limit: 100 }, strangerCtx), /outside the active tenant boundary/);
    await assert.rejects(scanColumnarArtifact(artifact.id, { offset: 100 }), /Tenant context is required/);
    fs.renameSync(file, `${file}.hidden`);
    try {
      await assert.rejects(queryDataArtifact(content, { offset: 100, limit: 100 }, strangerCtx), /outside the active tenant boundary/);
    } finally {
      fs.renameSync(`${file}.hidden`, file);
    }
  });

  await t.test("inline paging ends at available preview rows rather than declared full row count", async () => {
    const first = await queryDataArtifact(inlineContent, {});
    assert.equal(first.mode, "inline");
    assert.equal(first.rowCount, 10_000);
    assert.equal(first.availableRowCount, 250);
    assert.equal(first.limit, 100);
    assert.equal(first.nextOffset, 100);
    assert.deepEqual(values(first), sequence(0, 100));
    const second = await queryDataArtifact(inlineContent, { offset: 100, limit: 100 });
    assert.deepEqual(values(second), sequence(100, 100));
    assert.equal(second.nextOffset, 200);
    const last = await queryDataArtifact(inlineContent, { offset: 200, limit: 100 });
    assert.deepEqual(values(last), sequence(200, 50));
    assert.equal(last.nextOffset, null);
    const end = await queryDataArtifact(inlineContent, { offset: 250, limit: 100 });
    assert.deepEqual(end.sample, []);
    assert.equal(end.nextOffset, null);
    const far = await queryDataArtifact(inlineContent, { offset: Number.MAX_SAFE_INTEGER, limit: 100 });
    assert.deepEqual(far.sample, []);
    assert.equal(far.nextOffset, null);
    const capped = await queryDataArtifact(inlineContent, { limit: 1000 });
    assert.equal(capped.limit, 500);
    assert.equal(capped.sample.length, 250);
    assert.equal(capped.nextOffset, null);
    const empty = await queryDataArtifact({ ...inlineContent, previewRows: [] }, {});
    assert.equal(empty.availableRowCount, 0);
    assert.equal(empty.nextOffset, null);
  });

  await t.test("both entrypoints reject unsafe or fractional paging rather than coerce it", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(queryDataArtifact(inlineContent, { limit }), /Limit must be a positive safe integer/);
      await assert.rejects(scanColumnarArtifact(artifact.id, { limit }, ctx), /Limit must be a positive safe integer/);
    }
    for (const offset of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(queryDataArtifact(content, { offset }, ctx), /Offset must be a nonnegative safe integer/);
      await assert.rejects(scanColumnarArtifact(artifact.id, { offset }, ctx), /Offset must be a nonnegative safe integer/);
    }
  });
});
