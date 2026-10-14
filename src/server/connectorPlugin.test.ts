import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateConnectorPluginManifest } from "@shared/connectorPlugin";
import { discoverConnectorPlugins } from "./connectorPluginService";

const manifest = {
  apiVersion: "1",
  id: "custom_research_feed",
  version: "1.0.0",
  name: "Research Feed",
  category: "research",
  sourceType: "private_api",
  authMode: "bearer",
  custodyMode: "client_private",
  capabilities: [{ contractFamily: "research_documents", fields: ["title", "publishedAt"] }],
  setupGuide: "Configure the private research endpoint and a vault credential.",
  executable: false,
};

test("connector plugin manifest rejects executable code and malformed ids", () => {
  assert.equal(validateConnectorPluginManifest({ ...manifest, executable: true }).valid, false);
  assert.equal(validateConnectorPluginManifest({ ...manifest, id: "research_feed" }).valid, false);
  assert.equal(validateConnectorPluginManifest(manifest).valid, true);
});

test("connector plugin discovery loads valid manifests and reports rejected files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-connectors-"));
  fs.writeFileSync(path.join(directory, "valid.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(directory, "invalid.json"), JSON.stringify({ ...manifest, id: "bad" }));
  const result = discoverConnectorPlugins(directory);
  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0].id, "custom_research_feed");
  assert.equal(result.rejectedFiles.length, 1);
});
