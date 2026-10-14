import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTIVE_DIRS = ["server", "shared", path.join("client", "src"), "python-service"];
const ACTIVE_ROOT_FILES = ["main.cjs", "preload.cjs", "package.json", ".env.example"];
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".py", ".txt", ".yaml", ".yml"]);

function collectFiles(root) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return [root];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name.startsWith(".")) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
  }
  return files;
}

test("LIOS-P0-01 removes OpenBB from every active runtime surface", () => {
  const files = [
    ...ACTIVE_DIRS.flatMap((dir) => collectFiles(path.join(SRC_ROOT, dir))),
    ...ACTIVE_ROOT_FILES.map((file) => path.join(SRC_ROOT, file)).filter((file) => fs.existsSync(file)),
  ];

  const matches = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    if (/openbb/i.test(content)) {
      matches.push(path.relative(SRC_ROOT, file));
    }
  }

  assert.deepEqual(
    matches,
    [],
    `OpenBB references remain in active runtime files: ${matches.join(", ")}`,
  );

  for (const removedPath of [
    "server/openbbData.ts",
    "server/openbbRoutes.ts",
    "server/openbbService.ts",
    "server/openbbConsentGate.test.ts",
    "client/src/lib/useOpenBB.ts",
    "openbb-service",
  ]) {
    assert.equal(
      fs.existsSync(path.join(SRC_ROOT, removedPath)),
      false,
      `Obsolete OpenBB path still exists: ${removedPath}`,
    );
  }
});
