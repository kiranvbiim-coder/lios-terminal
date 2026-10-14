import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearDataRootPointer, moveDataRoot, prepareDataRoot, readDataRootPointer, resolveDataRoot } from "../dataRootCore.cjs";

function setup(t: test.TestContext) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-move-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, "home");
  fs.mkdirSync(home, { recursive: true });
  const env = { NODE_ENV: "production" } satisfies NodeJS.ProcessEnv;
  return { base, home, env, opts: { env, homedir: home } };
}

function plant(root: string): void {
  fs.mkdirSync(path.join(root, "pgdata", "base"), { recursive: true });
  fs.writeFileSync(path.join(root, "pgdata", "PG_VERSION"), "17\n");
  fs.writeFileSync(path.join(root, "pgdata", "base", "rel"), "relation-bytes");
  fs.writeFileSync(path.join(root, "vault.key"), "KEY", { mode: 0o600 });
  fs.mkdirSync(path.join(root, "project-attachments", "1"), { recursive: true });
  fs.writeFileSync(path.join(root, "project-attachments", "1", "a.blob"), "blob");
}

test("the saved folder wins over the default, loses to explicit environment overrides, and relative pointers are ignored", (t) => {
  const { base, home, env, opts } = setup(t);
  assert.equal(resolveDataRoot(opts).source, "production_default");
  const chosen = path.join(base, "elsewhere");
  fs.mkdirSync(path.join(home, ".limuria-terminal"), { recursive: true });
  fs.writeFileSync(path.join(home, ".limuria-terminal", "data-root.json"), JSON.stringify({ version: 1, root: chosen }));
  assert.deepEqual([resolveDataRoot(opts).root, resolveDataRoot(opts).source], [chosen, "pointer"]);
  assert.equal(resolveDataRoot({ ...opts, env: { ...env, LIOS_DATA_ROOT: "/mnt/x" } }).source, "LIOS_DATA_ROOT");
  assert.equal(resolveDataRoot({ ...opts, env: { ...env, LIMURIA_DATA_DIR: "/mnt/y" } }).source, "LIMURIA_DATA_DIR");
  fs.writeFileSync(path.join(home, ".limuria-terminal", "data-root.json"), JSON.stringify({ version: 1, root: "relative/dir" }));
  assert.equal(readDataRootPointer(home), null);
  assert.equal(resolveDataRoot(opts).source, "production_default");
});

test("moving copies every file, verifies it, leaves the original, carries no process or anchor files and repoints the home", (t) => {
  const { base, home, opts } = setup(t);
  const source = path.join(home, ".limuria-terminal");
  plant(source);
  prepareDataRoot({ ...opts, localDatabase: true });
  fs.writeFileSync(path.join(source, "pgdata", "postmaster.pid"), "999999\n");
  const target = path.join(base, "drive", "lios");
  const result = moveDataRoot({ from: source, to: target, ...opts });
  assert.ok(result.files >= 4);
  assert.equal(fs.readFileSync(path.join(target, "project-attachments", "1", "a.blob"), "utf8"), "blob");
  assert.equal(fs.readFileSync(path.join(target, "vault.key"), "utf8"), "KEY");
  for (const absent of ["postmaster.pid"]) assert.equal(fs.existsSync(path.join(target, "pgdata", absent)), false);
  for (const anchor of ["data-root.json", "known-roots.json"]) assert.equal(fs.existsSync(path.join(target, anchor)), false, anchor);
  assert.equal(fs.existsSync(path.join(source, "vault.key")), true, "the original is kept");
  assert.deepEqual([resolveDataRoot(opts).root, resolveDataRoot(opts).source], [target, "pointer"]);
  // The moved root keeps its identity, so the next start recognises it and a missing drive is an error, not a fresh start.
  assert.equal(prepareDataRoot({ ...opts, localDatabase: true }).rootId, JSON.parse(fs.readFileSync(path.join(target, ".lios-root.json"), "utf8")).rootId);
  fs.rmSync(target, { recursive: true, force: true });
  assert.throws(() => prepareDataRoot({ ...opts, localDatabase: true }), /was used before but is not available now/);
  clearDataRootPointer(opts);
  assert.equal(resolveDataRoot(opts).source, "production_default");
});

test("a move is refused for non-empty targets, nested folders, a running database and relative paths, and changes nothing", (t) => {
  const { base, home, opts } = setup(t);
  const source = path.join(home, ".limuria-terminal");
  plant(source);
  const occupied = path.join(base, "occupied");
  fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, "keep.txt"), "x");
  assert.throws(() => moveDataRoot({ from: source, to: occupied, ...opts }), /empty folder/);
  assert.throws(() => moveDataRoot({ from: source, to: path.join(source, "inside"), ...opts }), /cannot be inside/);
  assert.throws(() => moveDataRoot({ from: source, to: source, ...opts }), /already the current/);
  assert.throws(() => moveDataRoot({ from: source, to: "relative/path", ...opts }), /absolute/);
  fs.writeFileSync(path.join(source, "pgdata", "postmaster.pid"), `${process.pid}\n`);
  assert.throws(() => moveDataRoot({ from: source, to: path.join(base, "new"), ...opts }), /still running/);
  assert.equal(fs.existsSync(path.join(base, "new")), false);
  assert.equal(fs.existsSync(path.join(home, ".limuria-terminal", "data-root.json")), false);
  assert.equal(fs.readFileSync(path.join(occupied, "keep.txt"), "utf8"), "x");
});
