import assert from "node:assert/strict";
import test from "node:test";
import { SP01_DEPENDENCY_INVENTORY } from "./sp01DependencyInventory";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

test("SP-01 inventory names each required dependency and its existing authority and provenance", () => {
  const entries = SP01_DEPENDENCY_INVENTORY.components;
  assert.equal(SP01_DEPENDENCY_INVENTORY.schemaVersion, 1);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const id of [
    "desktop-shell", "native-pty", "home-server-and-renderer", "database-and-migrations",
    "vault-and-storage", "governed-execution", "managed-python-core", "python-sidecar-assets",
  ]) assert.ok(entries.some((entry) => entry.id === id), `Missing ${id}`);
  for (const component of entries) {
    assert.ok(component.authority && component.provenance && component.verification && component.repair);
  }
  const python = entries.find((entry) => entry.id === "managed-python-core");
  assert.ok(python);
  assert.equal(python.manifestVersion, MANAGED_RUNTIME_MANIFEST.manifestVersion);
  assert.equal(python.releaseHashesRequired, true);
  assert.match(python.provenance, /release artifact/);
});
