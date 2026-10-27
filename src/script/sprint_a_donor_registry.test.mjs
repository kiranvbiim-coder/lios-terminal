import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL("../../third_party/" + name, import.meta.url), "utf8");
const registry = JSON.parse(source("components.json"));
const lock = JSON.parse(source("upstream-lock.json"));
const notices = readFileSync(new URL("../../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8").toLowerCase().split(/\r?\n/).map(line => line.trim());

test("Sprint A retains immutable source pins and full legal notices for reused UX/transport donors", () => {
  const ids = [
    "beui-pulse-discovery-tabs",
    "watermelon-ui-p6-activities",
    "opensourceui-source-search",
    "openclaw-gm22-byoai-failover",
    "mcp-typescript-sdk-v2-client",
  ];
  const allowed = new Set(["adapted_source_component", "bundled"]);
  for (const id of ids) {
    const record = registry.components.find(entry => entry.id === id);
    const pinned = lock.locks.find(entry => entry.id === id);
    assert.ok(record, id + " donor record is present");
    assert.ok(pinned, id + " pinned source is present");
    assert.equal(record.repository, pinned.repository);
    assert.equal(record.commitSha, pinned.commitSha);
    assert.equal(record.license, pinned.license);
    assert.match(record.commitSha, /^[a-f0-9]{40}$/);
    assert.ok(allowed.has(record.posture));
    assert.equal(record.bundled, true);
    const heading = `## ${record.noticeHeading.toLowerCase()} — `;
    assert.ok(notices.some(line => line.startsWith(heading)), id + " exact MIT/Apache attribution heading");
  }
});

test("source adaptations never claim a new independent LiOS execution authority", () => {
  for (const id of ["beui-pulse-discovery-tabs", "watermelon-ui-p6-activities", "opensourceui-source-search"]) {
    const record = registry.components.find(entry => entry.id === id);
    assert.equal(record.classification, "adapt");
    assert.ok(record.destinationPaths.every(path => path.startsWith("client/")));
    assert.equal(record.externalRights, "separate_review_required");
  }
});
