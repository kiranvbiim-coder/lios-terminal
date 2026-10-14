import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findManifestProblems, workflowCommands } from "./validate_script_manifests";

test("a deleted test named in a script is a failure, not a silent skip", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "server"));
  fs.writeFileSync(path.join(dir, "server", "kept.test.ts"), "");
  fs.writeFileSync(path.join(dir, "server", "other.test.ts"), "");

  const scripts = {
    good: "node --import tsx --test server/kept.test.ts server/*.test.ts",
    stale: "node --import tsx --test server/kept.test.ts server/removed.test.ts",
    emptyGlob: "node --import tsx --test client/*.test.ts",
    ignored: "tsc && vite build --config=vite.config.ts https://example.com/a.js $HOME/x.ts -p tsconfig.json",
    chained: "npm run good && tsx script/gone.ts",
    generated: "node dist/index.cjs && node ./build/tool.js && vitest out/report.json",
  };
  assert.deepEqual(findManifestProblems(scripts, dir), [
    { script: "stale", path: "server/removed.test.ts", kind: "missing_file" },
    { script: "emptyGlob", path: "client/*.test.ts", kind: "empty_glob" },
    { script: "chained", path: "script/gone.ts", kind: "missing_file" },
  ]);
});

test("this repository's package scripts reference only files that exist", () => {
  const scripts = (JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.deepEqual(findManifestProblems(scripts, process.cwd()), []);
});

test("workflow run commands are checked at the exact step, and block scalars are left alone", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-workflow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "ci.yml"), [
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: node --test gone/*.test.ts",
    "      - name: block",
    "        run: |",
    "          node --test also/gone.test.ts",
    "      - name: single",
    "        run: npm run test:trust",
  ].join("\n"));
  const commands = workflowCommands(dir);
  assert.deepEqual(commands, { "ci.yml:4": "node --test gone/*.test.ts", "ci.yml:9": "npm run test:trust" });
  assert.deepEqual(findManifestProblems(commands, dir), [{ script: "ci.yml:4", path: "gone/*.test.ts", kind: "empty_glob" }]);
});
