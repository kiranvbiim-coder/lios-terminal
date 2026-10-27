"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Electron installers never embed restored private instrument catalogs", () => {
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const resources = pkg.build.extraResources || [];
  const files = pkg.build.files || [];
  const all = [...resources, ...files].map(item => typeof item === "string" ? item : item.from || "");
  assert.equal(all.some(v => v.replaceAll("\\", "/").includes("server/data")), false,
    "No wildcard or direct copy of ignored server/data into commercial installers");
  assert.equal(all.some(v => v.includes("instrument-catalogs") || v.includes("financedatabase_universe.json")), false);
  const gitignore = fs.readFileSync(path.join(root, "..", ".gitignore"), "utf8");
  assert.ok(gitignore.includes("src/server/data/"), "Private legacy provider snapshots must remain Git-ignored");
  assert.ok(gitignore.includes("/src/data/"), "User-owned reference and provider rows must remain Git-ignored");
});
