import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findReusableValidation, githubProofApi, parseSourceReceipt } from "./source_validation_reuse.mjs";

const repository = "kiranvbiim-coder/lios-terminal";
const input = { repository, eventName: "push", ref: "refs/heads/main", commitSha: "a".repeat(40), treeSha: "b".repeat(40) };
const platforms = ["Linux", "macOS", "Windows"];
function fixture(change = () => {}) {
  const data = {
    repository: { full_name: repository, private: false },
    pr: { number: 400, merged_at: "2026-10-29T00:00:00Z", merge_commit_sha: input.commitSha, base: { ref: "main", repo: { full_name: repository } }, head: { sha: "c".repeat(40), ref: "candidate", repo: { full_name: repository } } },
    run: { id: 99, run_attempt: 2, event: "pull_request", status: "completed", conclusion: "success", head_sha: "c".repeat(40), head_branch: "candidate", head_repository: { full_name: repository }, path: ".github/workflows/source-cross-platform.yml", repository: { full_name: repository }, pull_requests: [] },
    jobs: platforms.map((platform, index) => ({ id: index + 1, name: `Source / ${platform}`, status: "completed", conclusion: "success" })),
    receipts: platforms.map(platform => ({ schema: 1, repository, platform, runId: 99, runAttempt: 2, tree: input.treeSha, checkout: "d".repeat(40) })),
  };
  change(data);
  let requests = 0;
  const api = {
    async json(route) {
      requests++;
      if (route === "") return structuredClone(data.repository);
      if (route.startsWith("/commits/")) return [structuredClone(data.pr)];
      if (route.startsWith("/actions/workflows/")) return { workflow_runs: [structuredClone(data.run)] };
      if (route === "/actions/runs/99/attempts/2/jobs?per_page=100") return { total_count: data.jobs.length, jobs: structuredClone(data.jobs) };
      throw new Error("Unexpected proof request");
    },
    async receipt(id) { requests++; return structuredClone(data.receipts[id - 1]); },
  };
  return { api, requests: () => requests };
}

test("reuses all three successful exact-tree jobs even after GitHub clears closed PR associations", async () => {
  const { api } = fixture();
  const proof = await findReusableValidation(input, api);
  assert.equal(proof.reuse, true);
  assert.equal(proof.pullRequest, 400);
  assert.equal(proof.sourceRunId, 99);
  assert.equal(proof.sourceRunAttempt, 2);
  assert.deepEqual(proof.sourceJobs, [1, 2, 3]);
});

test("PRs, explicit manual runs and non-main pushes cannot reuse or contact the proof API", async () => {
  for (const delta of [{ eventName: "pull_request" }, { eventName: "workflow_dispatch" }, { ref: "refs/heads/candidate" }, { repository: "another/repository" }]) {
    const f = fixture();
    assert.equal((await findReusableValidation({ ...input, ...delta }, f.api)).reuse, false);
    assert.equal(f.requests(), 0);
  }
});

test("wrong tree, missing platform, failed or skipped platform, and duplicate job names run the full matrix", async () => {
  for (const mutate of [
    data => { data.receipts[1].tree = "e".repeat(40); },
    data => { data.jobs.pop(); },
    data => { data.jobs[2].conclusion = "failure"; },
    data => { data.jobs[2].conclusion = "skipped"; },
    data => { data.jobs.push({ ...data.jobs[0], id: 4 }); },
  ]) {
    const { api } = fixture(mutate);
    assert.equal((await findReusableValidation(input, api)).reuse, false);
  }
});

test("unrelated heads, branches, repositories and workflows cannot provide validation proof", async () => {
  for (const mutate of [
    data => { data.pr.merge_commit_sha = "f".repeat(40); },
    data => { data.run.head_sha = "f".repeat(40); },
    data => { data.run.head_branch = "another-candidate"; },
    data => { data.run.head_repository.full_name = "another/repository"; },
    data => { data.run.path = ".github/workflows/another.yml"; },
    data => { data.run.event = "workflow_dispatch"; },
    data => { data.run.pull_requests = [{ number: 401 }]; },
  ]) {
    const { api } = fixture(mutate);
    assert.equal((await findReusableValidation(input, api)).reuse, false);
  }
});

test("old, cross-platform and cross-attempt receipts never justify skipping a source job", async () => {
  for (const mutate of [
    data => { data.receipts[0] = null; },
    data => { data.receipts[0].schema = 0; },
    data => { data.receipts[0].runId = 98; },
    data => { data.receipts[0].runAttempt = 1; },
    data => { data.receipts[0].platform = "Windows"; },
    data => { data.receipts[0].repository = "another/repository"; },
    data => { data.receipts[0].checkout = "not-a-checkout"; },
  ]) {
    const { api } = fixture(mutate);
    assert.equal((await findReusableValidation(input, api)).reuse, false);
  }
});

test("API failures preserve validation without copying sensitive error text", async () => {
  const proof = await findReusableValidation(input, { json: async () => { throw new Error("private API response text"); } });
  assert.equal(proof.reuse, false);
  assert.doesNotMatch(JSON.stringify(proof), /private API response text/);
});

test("receipt reader finds a real streamed log record and cancels before the test log body", async () => {
  const receipt = fixture().api.receipt;
  const value = await receipt(1);
  let cancelled = false;
  const log = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("2026-10-29T00:00:00Z checkout complete\n2026-10-29T00:00:01Z LIOS_SOURCE_TREE_RECEIPT " + JSON.stringify(value) + "\n"));
    },
    cancel() { cancelled = true; },
  });
  const api = githubProofApi("synthetic-token", async url => {
    assert.equal(url, `https://api.github.com/repos/${repository}/actions/jobs/1/logs`);
    return new Response(log);
  });
  assert.deepEqual(await api.receipt(1), value);
  assert.equal(cancelled, true);
  assert.equal(parseSourceReceipt("arbitrary unprefixed log " + JSON.stringify(value)), null);
});

test("oversized or malformed proof responses are refused instead of becoming reuse evidence", async () => {
  const tooLarge = githubProofApi(null, async () => new Response("x".repeat(256 * 1024 + 1)));
  await assert.rejects(tooLarge.receipt(1), /exceeds bound/);
  const malformed = githubProofApi(null, async () => new Response("not-json"));
  await assert.rejects(malformed.json(""), SyntaxError);
  assert.equal(parseSourceReceipt('LIOS_SOURCE_TREE_RECEIPT {"schema":1}'), null);
});

test("CLI receipts bind actual clean source and refuse tracked worktree drift", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-source-proof-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const globalConfig = path.join(root, "empty.gitconfig");
  fs.writeFileSync(globalConfig, "");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "0",
    GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", LIOS_SOURCE_PLATFORM: "Linux" });
  const git = args => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
  };
  git(["init", "--quiet"]);
  fs.writeFileSync(path.join(root, "source.txt"), "validated source");
  git(["add", "source.txt"]);
  git(["-c", "user.name=Source proof", "-c", "user.email=source-proof@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "source"]);
  const args = [fileURLToPath(new URL("./source_validation_reuse.mjs", import.meta.url)), "--receipt"];
  const clean = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10_000 });
  assert.equal(clean.status, 0, clean.stderr);
  assert.ok(parseSourceReceipt(clean.stdout.trim()));
  fs.writeFileSync(path.join(root, "source.txt"), "different source");
  const changed = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 10_000 });
  assert.notEqual(changed.status, 0);
  assert.equal(parseSourceReceipt(changed.stdout.trim()), null);
});
