import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const srcRoot = path.resolve(import.meta.dirname, "..");
const SCANNED = ["server", "shared", "script"];
const EXTRA_FILES = ["main.cjs"];
const ALLOWED = new Set(["dataRootCore.cjs", "dataRootCore.d.cts"]);

function* sources(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "data") yield* sources(full); continue; }
    if (/\.(ts|tsx|cjs|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) && !/\.d\.(ts|cts)$/.test(entry.name)) yield full;
  }
}

// Each pattern is a way to decide "where does user state live" without the resolver.
const FORBIDDEN: Array<[string, RegExp]> = [
  ["hand-built ~/.limuria-terminal path segment", /["'`]\.limuria-terminal["'`]/],
  ["reads LIMURIA_DATA_DIR directly", /\benv\.LIMURIA_DATA_DIR\b|\benv\[["']LIMURIA_DATA_DIR["']\]/],
  ["reads LIOS_DATA_ROOT directly", /\benv\.LIOS_DATA_ROOT\b(?!\??\.?\s*=[^=])/],
  ["hand-built cwd/data path", /\(\s*process\.cwd\(\)\s*,\s*["']data["']/],
];

test("only dataRootCore decides where user-owned state lives (GM-03)", () => {
  const files = [...SCANNED.flatMap((dir) => [...sources(path.join(srcRoot, dir))]), ...EXTRA_FILES.map((file) => path.join(srcRoot, file))];
  const offences: string[] = [];
  for (const file of files) {
    if (ALLOWED.has(path.basename(file))) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [label, pattern] of FORBIDDEN) {
        if (pattern.test(line)) offences.push(`${path.relative(srcRoot, file)}:${index + 1} ${label}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(offences, [], `Use server/dataRoot.ts (dataPath/stateDir/databaseDir):\n${offences.join("\n")}`);
});
