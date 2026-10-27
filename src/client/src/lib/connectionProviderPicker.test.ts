import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseConnectionProviders,
  connectionPickerStatus,
} from "./connectionProviderPicker";

const catalog = [
  { id: "fred", name: "FRED", description: "Macro data", category: "macro", adapterImplemented: true },
  { id: "simfin", name: "SimFin", description: "Company fundamentals", category: "fundamentals" },
  { id: "future", name: "Future Broker", description: "Execution research only", category: "trading", adapterImplemented: false },
] as const;

test("provider picker searches a local immutable catalog independently of the main catalog filters", () => {
  assert.deepEqual(chooseConnectionProviders(catalog, "  macro "), [catalog[0]]);
  assert.deepEqual(chooseConnectionProviders(catalog, "Fundamental"), [catalog[1]]);
  assert.deepEqual(chooseConnectionProviders(catalog, "future"), [catalog[2]]);
  assert.equal(chooseConnectionProviders(catalog, "nonexistent").length, 0);
  assert.deepEqual(chooseConnectionProviders(catalog, ""), catalog);
  assert.equal(catalog[0].name, "FRED", "search does not rewrite canonical options");
});

test("catalog-only is never connectable; saved configuration does not imply a verified live source", () => {
  assert.deepEqual(connectionPickerStatus(catalog[2], false), {
    canSelect: false, label: "Catalog only · adapter unavailable",
  });
  assert.deepEqual(connectionPickerStatus(catalog[2], true), {
    canSelect: false, label: "Catalog only · adapter unavailable",
  });
  assert.deepEqual(connectionPickerStatus(catalog[1], true), {
    canSelect: true, label: "Saved configuration · review verification separately",
  });
  assert.deepEqual(connectionPickerStatus(catalog[0], false), {
    canSelect: true, label: "Available to configure · not yet connected",
  });
});


