import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

/**
 * A user who points LiOS at their own venv/Conda/enterprise environment
 * has not asked LiOS to modify it. Inspection must therefore only ever
 * read -- never install, uninstall, upgrade, or write into that
 * environment. This is a source-level guard (same approach as
 * globalInstrumentMasterBoundary.test.ts) rather than a behavioural test,
 * because the failure it prevents is a future edit quietly adding a
 * mutating command to the inspection path.
 */
const MUTATING_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "pip install", pattern: /\bpip\b[^\n]*\binstall\b/ },
  { label: "pip uninstall", pattern: /\buninstall\b/ },
  { label: "pip download", pattern: /\bdownload\b/ },
  { label: "venv creation", pattern: /"-m",\s*"venv"/ },
  { label: "ensurepip", pattern: /ensurepip/ },
  { label: "filesystem write", pattern: /\bwriteFileSync\b|\bmkdirSync\b|\brmSync\b|\brenameSync\b/ },
];

test("the BYO Python inspection module never mutates the user's environment", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server", "pythonRuntime.ts"), "utf8");
  const violations = MUTATING_PATTERNS
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => `server/pythonRuntime.ts performs a mutating operation: ${label}`);
  assert.deepEqual(violations, []);
});

test("external-environment inspection runs a single read-only metadata query", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "server", "pythonRuntime.ts"), "utf8");
  // The one command it may run against a user's interpreter: importlib
  // metadata listing. Anything else executed in that environment would be
  // outside what "inspection" promises.
  assert.match(source, /importlib\.metadata/, "inspection should read distributions via importlib.metadata");
  assert.ok(!/subprocess|shell:\s*true/.test(source), "inspection must not open a shell in the user's environment");
});

test("runtime installation lives in a separate module from inspection", () => {
  // installManagedRuntime (which legitimately does create a venv and run
  // pip) must stay out of the inspection module, so that pointing LiOS at
  // a BYO environment can never reach install code.
  const inspection = fs.readFileSync(path.resolve(process.cwd(), "server", "pythonRuntime.ts"), "utf8");
  assert.ok(
    !/installManagedRuntime|pythonRuntimeManager/.test(inspection),
    "pythonRuntime.ts (inspection) must not import or call the managed-install path",
  );
});
