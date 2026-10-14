import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DATA_ROOT_EXIT_CODE,
  DataRootUnavailableError,
  databaseDir,
  markDatabaseInitialized,
  prepareDataRoot,
  stateDir,
} from "./dataRoot";
import { foldLegacyWorkspace, readMarker, resolveDataRoot } from "../dataRootCore.cjs";

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lios-dataroot-"));
  const home = path.join(base, "home");
  fs.mkdirSync(home, { recursive: true });
  return { base, home, cwd: path.join(base, "cwd") };
}
const pgFiles = (dir: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "PG_VERSION"), "16\n"); };

test("resolution order: LIOS_DATA_ROOT, then legacy LIMURIA_DATA_DIR, then production home, then cwd/data", () => {
  const { home, cwd } = sandbox();
  const at = (env: NodeJS.ProcessEnv) => resolveDataRoot({ env, home, homedir: home, cwd } as never);
  assert.deepEqual([at({ LIOS_DATA_ROOT: "/mnt/a", LIMURIA_DATA_DIR: "/mnt/b" }).root, at({ LIOS_DATA_ROOT: "/mnt/a" }).source], [path.resolve("/mnt/a"), "LIOS_DATA_ROOT"]);
  assert.deepEqual([at({ LIMURIA_DATA_DIR: "/mnt/b" }).root, at({ LIMURIA_DATA_DIR: "/mnt/b" }).source], [path.resolve("/mnt/b"), "LIMURIA_DATA_DIR"]);
  assert.equal(at({ NODE_ENV: "production" }).root, path.join(home, ".limuria-terminal"));
  assert.equal(at({}).root, path.join(cwd, "data"));
  assert.equal(at({ LIOS_DATA_ROOT: "  " }).source, "development_default", "a blank override is ignored");
});

test("database lives in <root>/pgdata, except the legacy layout that already holds a database in the root", () => {
  const { home, cwd } = sandbox();
  const env = { NODE_ENV: "production" };
  const resolution = resolveDataRoot({ env, homedir: home, cwd });
  assert.equal(databaseDir({ env, homedir: home, cwd }), path.join(resolution.root, "pgdata"));
  pgFiles(resolution.root);
  assert.equal(databaseDir({ env, homedir: home, cwd }), resolution.root, "legacy LIMURIA_DATA_DIR layout is preserved");
  pgFiles(path.join(resolution.root, "pgdata"));
  assert.equal(databaseDir({ env, homedir: home, cwd }), path.join(resolution.root, "pgdata"), "a nested database wins once it exists");
});

test("state files keep their historical location: <root>/data in production, the root itself in development", () => {
  const { home, cwd } = sandbox();
  assert.equal(stateDir({ env: { NODE_ENV: "production" }, homedir: home, cwd }), path.join(home, ".limuria-terminal", "data"));
  assert.equal(stateDir({ env: {}, homedir: home, cwd }), path.join(cwd, "data"));
  assert.equal(stateDir({ env: { LIOS_DATA_ROOT: path.join(home, "x") }, homedir: home, cwd }), path.join(home, "x", "data"));
});

test("first run creates the root and a marker; the database is protected only once it is marked initialized", () => {
  const { home, cwd } = sandbox();
  const options = { env: { NODE_ENV: "production" }, homedir: home, cwd };
  const first = prepareDataRoot(options);
  assert.equal(first.firstRun, true);
  assert.equal(readMarker(first.root)?.databaseInitialized, false);
  assert.equal(prepareDataRoot(options).firstRun, true, "no database yet: still a first run after a crash before init");
  pgFiles(databaseDir(options)); markDatabaseInitialized(options);
  assert.equal(readMarker(first.root)?.databaseInitialized, true);
  assert.equal(prepareDataRoot(options).firstRun, false);
});

test("a database folder that vanished from an initialized root is refused, never recreated empty", () => {
  const { home, cwd } = sandbox();
  const options = { env: { NODE_ENV: "production" }, homedir: home, cwd };
  const prepared = prepareDataRoot(options);
  pgFiles(databaseDir(options)); markDatabaseInitialized(options);
  fs.rmSync(path.join(prepared.root, "pgdata"), { recursive: true });
  assert.throws(() => prepareDataRoot(options), (error: unknown) => error instanceof DataRootUnavailableError && error.code === "database_missing" && /will not create an empty database/.test(error.message));
  assert.equal(fs.existsSync(path.join(prepared.root, "pgdata")), false, "the refusal must not create anything");
});

test("a custom root that disappeared (unmounted drive) is refused, using the home-anchor ledger", () => {
  const { base, home, cwd } = sandbox();
  const external = path.join(base, "external-drive", "LiOS");
  const options = { env: { LIOS_DATA_ROOT: external }, homedir: home, cwd };
  prepareDataRoot(options); pgFiles(databaseDir(options)); markDatabaseInitialized(options);
  fs.rmSync(path.join(base, "external-drive"), { recursive: true });
  assert.throws(() => prepareDataRoot(options), (error: unknown) => error instanceof DataRootUnavailableError && error.code === "root_missing");
  assert.equal(fs.existsSync(external), false, "the unmounted path must not be recreated on the system disk");
});

test("an install that predates markers keeps its database and is adopted, not reset", () => {
  const { home, cwd } = sandbox();
  const options = { env: { NODE_ENV: "production" }, homedir: home, cwd };
  const root = path.join(home, ".limuria-terminal");
  pgFiles(path.join(root, "pgdata"));
  const prepared = prepareDataRoot(options);
  assert.equal(prepared.firstRun, false);
  assert.equal(readMarker(root)?.adoptedExistingData, true);
  assert.equal(readMarker(root)?.databaseInitialized, true);
});

test("a user-managed PostgreSQL install is not blocked by the absence of a local database", () => {
  const { home, cwd } = sandbox();
  const env = { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@db/lios" };
  const prepared = prepareDataRoot({ env, homedir: home, cwd });
  assert.equal(prepareDataRoot({ env, homedir: home, cwd }).rootId, prepared.rootId);
});

test("the startup refusal has a distinct exit code so the desktop does not restart-loop on it", () => {
  assert.equal(DATA_ROOT_EXIT_CODE, 78);
});

function legacyWorkspace(root: string) {
  for (const dir of ["connectors", "datasets", "exports"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, "connectors", "custom_a.json"), "{\"id\":\"custom_a\"}");
  fs.writeFileSync(path.join(root, "workspace.json"), JSON.stringify({ version: 1, workspaceId: "ws_" + "a".repeat(32), createdAt: "2026-01-01T00:00:00.000Z", connectorDirectory: path.join(root, "connectors") }));
}

test("legacy Electron workspace folds into the data root verified, with identity preserved and the original kept", () => {
  const { base } = sandbox();
  const legacyRoot = path.join(base, "userData", "workspace");
  const targetRoot = path.join(base, "root", "workspace");
  legacyWorkspace(legacyRoot);
  const result = foldLegacyWorkspace({ legacyRoot, targetRoot });
  assert.deepEqual(result, { action: "folded", files: 2, workspaceId: "ws_" + "a".repeat(32) });
  const metadata = JSON.parse(fs.readFileSync(path.join(targetRoot, "workspace.json"), "utf8"));
  assert.equal(metadata.workspaceId, "ws_" + "a".repeat(32));
  assert.equal(metadata.connectorDirectory, path.join(targetRoot, "connectors"), "absolute paths follow the move");
  assert.equal(fs.readFileSync(path.join(targetRoot, "connectors", "custom_a.json"), "utf8"), "{\"id\":\"custom_a\"}");
  assert.equal(fs.existsSync(path.join(legacyRoot, "workspace.json")), true, "original is left as a backup");
  assert.equal(foldLegacyWorkspace({ legacyRoot, targetRoot }).action, "already_folded");
  assert.deepEqual(fs.readdirSync(path.dirname(targetRoot)).filter((name) => name.includes("fold-")), [], "no staging folder remains");
});

test("a failed fold leaves no half-written target and reports the error", () => {
  const { base } = sandbox();
  const legacyRoot = path.join(base, "userData", "workspace");
  const targetRoot = path.join(base, "root", "workspace");
  legacyWorkspace(legacyRoot);
  fs.symlinkSync(path.join(legacyRoot, "workspace.json"), path.join(legacyRoot, "datasets", "link.json"));
  assert.throws(() => foldLegacyWorkspace({ legacyRoot, targetRoot }), /symbolic link/);
  assert.equal(fs.existsSync(targetRoot), false);
  assert.deepEqual(fs.readdirSync(path.join(base, "root")), []);
});

test("no legacy workspace means nothing to fold", () => {
  const { base } = sandbox();
  assert.equal(foldLegacyWorkspace({ legacyRoot: path.join(base, "none"), targetRoot: path.join(base, "root", "workspace") }).action, "no_legacy_workspace");
});

test("only user-chosen roots touch the home-anchor ledger; tests and legacy overrides never write to the real home", () => {
  const { home, cwd } = sandbox();
  prepareDataRoot({ env: { LIMURIA_DATA_DIR: path.join(home, "legacy") }, homedir: home, cwd });
  prepareDataRoot({ env: { NODE_ENV: "production" }, homedir: home, cwd });
  prepareDataRoot({ env: {}, homedir: home, cwd });
  assert.equal(fs.existsSync(path.join(home, ".limuria-terminal", "known-roots.json")), false);
  prepareDataRoot({ env: { LIOS_DATA_ROOT: path.join(home, "chosen") }, homedir: home, cwd });
  assert.equal(fs.existsSync(path.join(home, ".limuria-terminal", "known-roots.json")), true);
});
