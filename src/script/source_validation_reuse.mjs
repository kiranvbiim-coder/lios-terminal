#!/usr/bin/env node
// Reuse only completed PR source checks for an identical post-merge Git tree. PR checks never skip.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPOSITORY = "kiranvbiim-coder/lios-terminal";
const WORKFLOW = ".github/workflows/source-cross-platform.yml";
const PLATFORMS = ["Linux", "macOS", "Windows"];
const SHA = /^[a-f0-9]{40}$/;
const RECEIPT = "LIOS_SOURCE_TREE_RECEIPT ";
const fallback = () => ({ reuse: false, reason: "No complete successful same-tree PR proof; run all source checks." });

export function parseSourceReceipt(line) {
  const text = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/^\d{4}-\d\d-\d\dT\S+\s/, "");
  if (!text.startsWith(RECEIPT)) return null;
  try {
    const receipt = JSON.parse(text.slice(RECEIPT.length));
    if (receipt.schema !== 1 || receipt.repository !== REPOSITORY || !PLATFORMS.includes(receipt.platform) ||
        !Number.isSafeInteger(receipt.runId) || receipt.runId < 1 || !Number.isSafeInteger(receipt.runAttempt) || receipt.runAttempt < 1 ||
        typeof receipt.tree !== "string" || !SHA.test(receipt.tree) || typeof receipt.checkout !== "string" || !SHA.test(receipt.checkout)) return null;
    return receipt;
  } catch { return null; }
}

/** Bounded API reads only. Missing/old receipts, stale heads, skipped jobs and API failures all rerun. */
export async function findReusableValidation(input, api) {
  if (input.repository !== REPOSITORY || input.eventName !== "push" || input.ref !== "refs/heads/main" ||
      !SHA.test(input.commitSha ?? "") || !SHA.test(input.treeSha ?? "")) return fallback();
  try {
    const repository = await api.json("");
    if (repository.full_name !== REPOSITORY || repository.private !== false) return fallback();
    const pulls = await api.json(`/commits/${input.commitSha}/pulls?per_page=100`);
    if (!Array.isArray(pulls)) return fallback();
    const merged = pulls.filter(pr => pr.merged_at && pr.merge_commit_sha === input.commitSha &&
      pr.base?.ref === "main" && pr.base?.repo?.full_name === REPOSITORY &&
      Number.isSafeInteger(pr.number) && pr.number > 0 && SHA.test(pr.head?.sha ?? "") &&
      typeof pr.head?.ref === "string" && pr.head.ref.length > 0 &&
      typeof pr.head?.repo?.full_name === "string" && pr.head.repo.full_name.length > 0).slice(0, 2);
    for (const pr of merged) {
      const response = await api.json(`/actions/workflows/source-cross-platform.yml/runs?event=pull_request&head_sha=${pr.head.sha}&status=success&per_page=10`);
      if (!Array.isArray(response.workflow_runs)) continue;
      const candidates = response.workflow_runs.filter(run => run.event === "pull_request" && run.status === "completed" &&
        run.conclusion === "success" && run.head_sha === pr.head.sha && run.path === WORKFLOW &&
        run.repository?.full_name === REPOSITORY && Number.isSafeInteger(run.id) && run.id > 0 &&
        Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 &&
        run.head_branch === pr.head.ref && run.head_repository?.full_name === pr.head.repo?.full_name &&
        // GitHub clears run.pull_requests after closure; exact merged head/repository/branch still bind the run.
        Array.isArray(run.pull_requests) && (run.pull_requests.length === 0 || run.pull_requests.some(candidate => candidate.number === pr.number))).slice(0, 2);
      for (const run of candidates) {
        const jobs = await api.json(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
        if (!Array.isArray(jobs.jobs) || jobs.total_count > 100) continue;
        const selected = PLATFORMS.map(platform => jobs.jobs.filter(job => job.name === `Source / ${platform}`));
        if (selected.some(matches => matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success" ||
            !Number.isSafeInteger(matches[0].id) || matches[0].id < 1)) continue;
        const receipts = await Promise.all(selected.map(async ([job]) => api.receipt(job.id)));
        if (receipts.some((receipt, index) => !receipt || receipt.schema !== 1 || receipt.repository !== REPOSITORY || receipt.runId !== run.id ||
            receipt.runAttempt !== run.run_attempt || receipt.platform !== PLATFORMS[index] || receipt.tree !== input.treeSha ||
            !SHA.test(receipt.checkout ?? ""))) continue;
        return { reuse: true, reason: "All three successful PR jobs tested the identical Git tree.",
          tree: input.treeSha, pullRequest: pr.number, sourceRunId: run.id, sourceRunAttempt: run.run_attempt,
          sourceJobs: selected.map(([job]) => job.id) };
      }
    }
  } catch {
    // Do not print API response/error bodies or credentials. Validation, never reuse, is the fallback.
  }
  return fallback();
}

async function readBoundedResponse(response, { maxBytes, stopAtReceipt = false }) {
  if (!response.ok || !response.body) throw new Error("GitHub proof read unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new Error("GitHub proof read exceeds bound");
      text += decoder.decode(next.value, { stream: true });
      if (stopAtReceipt) {
        const lines = text.split("\n");
        text = lines.pop() || "";
        for (const line of lines) {
          const receipt = parseSourceReceipt(line);
          if (receipt) return receipt;
        }
      }
    }
    text += decoder.decode();
    return stopAtReceipt ? parseSourceReceipt(text) : JSON.parse(text);
  } finally { await reader.cancel().catch(() => undefined); }
}

export function githubProofApi(token, fetcher = fetch) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "lios-source-tree-proof" };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = suffix => fetcher(`https://api.github.com/repos/${REPOSITORY}${suffix}`, { headers, signal: AbortSignal.timeout(20_000) });
  return {
    json: async suffix => readBoundedResponse(await request(suffix), { maxBytes: 2 * 1024 * 1024 }),
    // Receipt is emitted immediately after checkout/setup. Never download a complete test log to find it.
    receipt: async jobId => readBoundedResponse(await request(`/actions/jobs/${jobId}/logs`), { maxBytes: 256 * 1024, stopAtReceipt: true }),
  };
}

function currentGitFact(expression) {
  const value = execFileSync("git", ["rev-parse", expression], { encoding: "utf8", timeout: 10_000 }).trim();
  if (!SHA.test(value)) throw new Error("Invalid checkout Git identity");
  return value;
}

async function main() {
  if (process.argv[2] === "--receipt" && process.argv.length === 3) {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { stdio: "ignore", timeout: 10_000 });
    const receipt = { schema: 1, repository: process.env.GITHUB_REPOSITORY, runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), platform: process.env.LIOS_SOURCE_PLATFORM,
      tree: currentGitFact("HEAD^{tree}"), checkout: currentGitFact("HEAD") };
    const line = RECEIPT + JSON.stringify(receipt);
    if (!parseSourceReceipt(line)) throw new Error("Source receipt context is unavailable");
    console.log(line);
    return;
  }
  if (process.argv[2] !== "--verify-main" || process.argv.length !== 3) throw new Error("Usage: source_validation_reuse.mjs --receipt|--verify-main");
  let proof = fallback();
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { stdio: "ignore", timeout: 10_000 });
    const checkout = currentGitFact("HEAD");
    if (checkout === process.env.GITHUB_SHA) proof = await findReusableValidation({ repository: process.env.GITHUB_REPOSITORY,
      eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, commitSha: checkout,
      treeSha: currentGitFact("HEAD^{tree}") }, githubProofApi(process.env.GITHUB_TOKEN));
  } catch { /* Missing checkout/API evidence must run the complete matrix. */ }
  console.log(JSON.stringify(proof));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reuse=${proof.reuse ? "true" : "false"}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Post-merge source validation\n\n${proof.reason}\n\n${proof.reuse ? `Reused PR #${proof.pullRequest}, [run ${proof.sourceRunId}](https://github.com/${REPOSITORY}/actions/runs/${proof.sourceRunId}), tree \`${proof.tree}\`. PR checks were not skipped.` : "All Linux/macOS/Windows gates remain scheduled."}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
