import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  applyCodingPatch,
  inspectCodingWorkspace,
  previewCodingPatch,
  snapshotCodingWorkspace,
} from "./coding-workspace";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lios-coding-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "answer.ts"), "export const answer = 41;\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { check: "node --check src/answer.ts" } }));
  return { root, env: { ...process.env, LIOS_CODING_WORKSPACE_ROOT: root } };
}

test("coding inspection is bounded, fingerprints content and refuses path escape/symlink aliases", async (t) => {
  const { root, env } = await fixture(t);
  const inspected = await inspectCodingWorkspace(["src/answer.ts"], env);
  assert.match(inspected.workspaceSha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.previews[0]?.text, "export const answer = 41;\n");
  assert.equal(inspected.previews[0]?.path, "src/answer.ts");

  await assert.rejects(inspectCodingWorkspace(["../outside"], env), /path|repository/i);

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "lios-coding-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "secret.txt"), "not visible");
  await fs.symlink(path.join(outside, "secret.txt"), path.join(root, "src", "alias.txt"));
  await assert.rejects(inspectCodingWorkspace(["src/alias.txt"], env), /symbolic-link/i);
});

test("patch preview never writes; exact preview applies atomically and stale workspace/file identity refuses", async (t) => {
  const { root, env } = await fixture(t);
  const before = await snapshotCodingWorkspace(env);
  const file = before.files.find((candidate) => candidate.path === "src/answer.ts");
  assert.ok(file);

  const changes = [{
    path: "src/answer.ts",
    beforeSha256: file.sha256,
    content: "export const answer = 42;\n",
  }];
  const preview = await previewCodingPatch(before.workspaceSha256, changes, env);
  assert.match(preview.previewSha256, /^[a-f0-9]{64}$/);
  assert.match(preview.diff, /-export const answer = 41;/);
  assert.match(preview.diff, /\+export const answer = 42;/);
  assert.equal(await fs.readFile(path.join(root, "src", "answer.ts"), "utf8"), "export const answer = 41;\n", "preview must not write");

  const applied = await applyCodingPatch(before.workspaceSha256, preview.previewSha256, changes, env);
  assert.equal(await fs.readFile(path.join(root, "src", "answer.ts"), "utf8"), "export const answer = 42;\n");
  assert.notEqual(applied.workspaceSha256After, before.workspaceSha256);

  await fs.writeFile(path.join(root, "src", "answer.ts"), "export const answer = 43;\n");
  await assert.rejects(
    applyCodingPatch(applied.workspaceSha256After, preview.previewSha256, changes, env),
    /changed|digest|target/i,
  );
});

test("a changed workspace refuses an old patch before any file is written", async (t) => {
  const { root, env } = await fixture(t);
  const before = await snapshotCodingWorkspace(env);
  const file = before.files.find((candidate) => candidate.path === "src/answer.ts")!;
  const changes = [{ path: file.path, beforeSha256: file.sha256, content: "export const answer = 42;\n" }];
  const preview = await previewCodingPatch(before.workspaceSha256, changes, env);
  await fs.writeFile(path.join(root, "README.md"), "drift");
  await assert.rejects(
    applyCodingPatch(before.workspaceSha256, preview.previewSha256, changes, env),
    /workspace changed/i,
  );
  assert.equal(await fs.readFile(path.join(root, "src", "answer.ts"), "utf8"), "export const answer = 41;\n");
});
