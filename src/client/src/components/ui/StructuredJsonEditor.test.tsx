import test from "node:test";
import assert from "node:assert/strict";
import {
  StructuredJsonEditor,
  applySchemaDefaults,
  removeRecordValue,
  updateObjectArrayRow,
  updateRecordValue,
  type JsonFieldSchema,
} from "./StructuredJsonEditor";

test("exports the documented component and pure helper as functions", () => {
  assert.equal(typeof StructuredJsonEditor, "function");
  assert.equal(typeof applySchemaDefaults, "function");
});

test("applySchemaDefaults fills missing keys on a flat schema and preserves existing ones", () => {
  const schema: JsonFieldSchema[] = [
    { kind: "number", key: "riskAversion", label: "RISK AVERSION", default: 1 },
    { kind: "string", key: "mode", label: "MODE", default: "balanced" },
    { kind: "boolean", key: "allowShorts", label: "ALLOW SHORTS", default: false },
    { kind: "select", key: "horizon", label: "HORIZON", options: ["1Y", "5Y"], default: "1Y" },
  ];

  const result = applySchemaDefaults(schema, { mode: "aggressive" });

  assert.deepEqual(result, { riskAversion: 1, mode: "aggressive", allowShorts: false, horizon: "1Y" });
});

test("applySchemaDefaults preserves falsy existing values instead of overwriting with defaults", () => {
  const schema: JsonFieldSchema[] = [
    { kind: "number", key: "turnoverPenalty", label: "TURNOVER PENALTY", default: 0.2 },
    { kind: "boolean", key: "enabled", label: "ENABLED", default: true },
    { kind: "string", key: "note", label: "NOTE", default: "n/a" },
  ];

  const result = applySchemaDefaults(schema, { turnoverPenalty: 0, enabled: false, note: "" });

  assert.deepEqual(result, { turnoverPenalty: 0, enabled: false, note: "" });
});

test("applySchemaDefaults does not mutate its input value object", () => {
  const schema: JsonFieldSchema[] = [{ kind: "number", key: "x", label: "X", default: 5 }];
  const input = {};

  const result = applySchemaDefaults(schema, input);

  assert.deepEqual(input, {});
  assert.deepEqual(result, { x: 5 });
  assert.notEqual(result, input);
});

test("applySchemaDefaults recurses into nested object schema, filling only missing sibling keys", () => {
  const schema: JsonFieldSchema[] = [
    { kind: "string", key: "source", label: "SOURCE", default: "manual" },
    {
      kind: "object",
      key: "sourceMetadata",
      label: "SOURCE METADATA",
      fields: [
        { kind: "string", key: "source", label: "SOURCE", default: "internal" },
        { kind: "string", key: "asOf", label: "AS OF", default: "2026-01-01" },
      ],
      default: { source: "internal", asOf: "2026-01-01" },
    },
  ];

  // sourceMetadata.asOf is present, sourceMetadata.source is missing, and top-level source is present.
  const result = applySchemaDefaults(schema, { source: "live-feed", sourceMetadata: { asOf: "2026-08-25" } });

  assert.deepEqual(result, {
    source: "live-feed",
    sourceMetadata: { source: "internal", asOf: "2026-08-25" },
  });
});

test("applySchemaDefaults fills an entirely missing nested object from field.default", () => {
  const schema: JsonFieldSchema[] = [
    {
      kind: "object",
      key: "riskLimits",
      label: "RISK LIMITS",
      fields: [
        { kind: "number", key: "maxDrawdownPct", label: "MAX DRAWDOWN %", default: 20 },
        { kind: "number", key: "maxLeverage", label: "MAX LEVERAGE", default: 2 },
      ],
      default: { maxDrawdownPct: 20, maxLeverage: 2 },
    },
  ];

  const result = applySchemaDefaults(schema, {});

  assert.deepEqual(result, { riskLimits: { maxDrawdownPct: 20, maxLeverage: 2 } });
});

test("applySchemaDefaults leaves an existing objectArray value fully untouched", () => {
  const itemFields: JsonFieldSchema[] = [
    { kind: "string", key: "asset", label: "ASSET" },
    { kind: "number", key: "currentWeight", label: "CURRENT WEIGHT", default: 0 },
  ];
  const schema: JsonFieldSchema[] = [
    { kind: "objectArray", key: "lots", label: "LOTS", itemFields, default: [{ asset: "A", currentWeight: 0.5 }] },
  ];

  const existing = [{ asset: "B", currentWeight: 0.3 }, { asset: "C", currentWeight: 0.1 }];
  const result = applySchemaDefaults(schema, { lots: existing });

  assert.deepEqual(result.lots, existing);
  assert.equal(result.lots, existing);
});

test("applySchemaDefaults fills a missing objectArray from field.default", () => {
  const itemFields: JsonFieldSchema[] = [
    { kind: "string", key: "asset", label: "ASSET" },
    { kind: "number", key: "currentWeight", label: "CURRENT WEIGHT", default: 0 },
  ];
  const schema: JsonFieldSchema[] = [
    { kind: "objectArray", key: "lots", label: "LOTS", itemFields, default: [{ asset: "A", currentWeight: 0.5 }] },
  ];

  const result = applySchemaDefaults(schema, {});

  assert.deepEqual(result, { lots: [{ asset: "A", currentWeight: 0.5 }] });
});

test("applySchemaDefaults is idempotent (re-applying to its own output is a no-op)", () => {
  const schema: JsonFieldSchema[] = [
    { kind: "number", key: "a", label: "A", default: 1 },
    {
      kind: "object",
      key: "b",
      label: "B",
      fields: [{ kind: "number", key: "c", label: "C", default: 2 }],
    },
  ];

  const once = applySchemaDefaults(schema, {});
  const twice = applySchemaDefaults(schema, once);

  assert.deepEqual(once, twice);
});

test("applySchemaDefaults applies nested defaults inside existing objectArray rows without losing unknown fields", () => {
  const schema: JsonFieldSchema[] = [
    {
      kind: "objectArray",
      key: "rows",
      label: "ROWS",
      itemFields: [
        {
          kind: "object",
          key: "metadata",
          label: "METADATA",
          fields: [{ kind: "string", key: "region", label: "REGION", default: "US" }],
        },
      ],
    },
  ];
  const result = applySchemaDefaults(schema, { rows: [{ metadata: { desk: "cash" }, untouched: true }] });
  assert.deepEqual(result, { rows: [{ metadata: { desk: "cash", region: "US" }, untouched: true }] });
});

test("nested objectArray and record JSON values round-trip through pure update helpers", () => {
  const rows = [{ id: "A", nested: { values: [1, 2] } }];
  const row = { ...rows[0], nested: { values: [1, 2, 3] } };
  const updatedRows = updateObjectArrayRow(rows, 0, row);
  assert.deepEqual(updatedRows, [{ id: "A", nested: { values: [1, 2, 3] } }]);
  assert.deepEqual(rows, [{ id: "A", nested: { values: [1, 2] } }]);

  const record = updateRecordValue({}, "payload", { items: [{ code: "X" }] });
  assert.deepEqual(removeRecordValue(record, "missing"), record);
  assert.deepEqual(removeRecordValue(record, "payload"), {});
});

test("record schemas accept recursive object and array values", () => {
  const schema: JsonFieldSchema = {
    kind: "record",
    key: "dynamic",
    label: "DYNAMIC",
    valueKind: "object",
    valueSchema: [{ kind: "string", key: "status", label: "STATUS", default: "new" }],
  };
  const arraySchema: JsonFieldSchema = {
    kind: "record",
    key: "items",
    label: "ITEMS",
    valueKind: "array",
    itemSchema: { kind: "json", key: "item", label: "ITEM" },
  };
  assert.equal(schema.valueKind, "object");
  assert.equal(arraySchema.valueKind, "array");
});

test("applySchemaDefaults recursively normalizes object and array record values", () => {
  const schema: JsonFieldSchema[] = [
    {
      kind: "record",
      key: "dynamic",
      label: "DYNAMIC",
      valueKind: "object",
      valueSchema: [{ kind: "string", key: "status", label: "STATUS", default: "new" }],
    },
    {
      kind: "record",
      key: "batches",
      label: "BATCHES",
      valueKind: "array",
      itemSchema: {
        kind: "object",
        key: "batch",
        label: "BATCH",
        fields: [{ kind: "boolean", key: "enabled", label: "ENABLED", default: true }],
      },
    },
  ];
  assert.deepEqual(
    applySchemaDefaults(schema, { dynamic: { first: {} }, batches: { today: [{}] } }),
    { dynamic: { first: { status: "new" } }, batches: { today: [{ enabled: true }] } },
  );
});
