"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { requireCleanBetaSourceCommit } = require("./clean_beta_source.cjs");

test("D10 beta stamp refuses dirty root files and untracked source, but permits ignored build outputs", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-exact-beta-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function git(...args) {
    const r = spawnSync("git", args, {
      cwd: root, encoding: "utf8", windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr || "Git command failed.");
    return String(r.stdout || "").trim();
  }
  git("init", "-q");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, ".gitignore"), "build/\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "release owner instructions\n");
  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const clean = true;\n");
  git("add", "-A");
  git("-c", "user.name=LiOS Test", "-c", "user.email=lios-test@example.invalid",
    "commit", "-q", "-m", "recorded clean source");
  const cwd = path.join(root, "src");
  const head = git("rev-parse", "--verify", "HEAD");
  assert.equal(requireCleanBetaSourceCommit(cwd), head);

  fs.mkdirSync(path.join(root, "build"));
  fs.writeFileSync(path.join(root, "build", "sidecar.bin"), "generated ignored asset");
  assert.equal(requireCleanBetaSourceCommit(cwd), head);

  fs.writeFileSync(path.join(root, "root-untracked.txt"), "missing from reviewed source");
  assert.throws(() => requireCleanBetaSourceCommit(cwd), /complete Git checkout to be clean/);
  fs.unlinkSync(path.join(root, "root-untracked.txt"));

  fs.writeFileSync(path.join(root, "src", "new-import.ts"), "export default 1;");
  assert.throws(() => requireCleanBetaSourceCommit(cwd), /complete Git checkout to be clean/);
  fs.unlinkSync(path.join(root, "src", "new-import.ts"));

  fs.writeFileSync(path.join(root, "AGENTS.md"), "changed root instructions\n");
  assert.throws(() => requireCleanBetaSourceCommit(cwd), /complete Git checkout to be clean/);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "release owner instructions\n");
  assert.equal(requireCleanBetaSourceCommit(cwd), head);

  fs.writeFileSync(path.join(root, "src", "index.ts"), "export const clean = false;\n");
  git("add", "src/index.ts");
  assert.throws(() => requireCleanBetaSourceCommit(cwd), /complete Git checkout to be clean/);
});
