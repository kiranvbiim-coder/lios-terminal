import test from "node:test";
import assert from "node:assert/strict";
import { persistSourceSnapshot } from "./sourceSnapshotStore";

test("source snapshots reject oversized record counts before database access", async () => {
  await assert.rejects(
    persistSourceSnapshot({
      connectionId: 1,
      userId: 1,
      organizationId: 1,
      connectorId: "private_api",
      operation: "api_fetch",
      records: Array.from({ length: 10_001 }, () => ({ value: 1 })),
    }),
    /reduce the connector page size or page limit/i,
  );
});

test("source snapshots reject oversized serialized payloads before database access", async () => {
  await assert.rejects(
    persistSourceSnapshot({
      connectionId: 1,
      userId: 1,
      organizationId: 1,
      connectorId: "private_api",
      operation: "api_mapping",
      records: [{ value: "x".repeat(5 * 1024 * 1024) }],
    }),
    /reduce the connector result/i,
  );
});
