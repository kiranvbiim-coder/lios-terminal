// Local pre-push gate: run what hosted CI would catch, but only where the diff can reach it.
// Every push to a PR restarts three ~40 minute required checks, so catch failures here first.
// Usage: npm run prepush [-- --base origin/main] [--dry]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const src = fileURLToPath(new URL("../", import.meta.url));
const repo = path.resolve(src, "..");
const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
const dry = args.includes("--dry");
const DEPTH = 2;
const MAX_TESTS = 120;

function git(...a) {
  const r = spawnSync("git", a, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.split("\n").filter(Boolean);
}

const changed = [...new Set([
  ...git("diff", "--name-only", `${base}...HEAD`),
  ...git("diff", "--name-only", "HEAD"),
  ...git("ls-files", "--others", "--exclude-standard"),
])].filter((file) => fs.existsSync(path.join(repo, file)));

const inSrc = changed.filter((file) => file.startsWith("src/")).map((file) => file.slice(4));
const code = (file) => /\.(?:ts|tsx|js|cjs|mjs)$/.test(file);
const isTest = (file) => /\.test\.(?:ts|tsx|js|cjs|mjs)$/.test(file);

// Import graph over first-party sources, so a changed module also selects its dependents' tests.
const roots = ["server", "shared", "client/src", "script", "."];
const files = [];
function walk(directory, recursive) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (recursive && entry.name !== "node_modules" && !entry.name.startsWith(".") && !/dist/.test(entry.name)) walk(full, true);
    } else if (entry.isFile() && code(entry.name)) files.push(path.relative(src, full).split(path.sep).join("/"));
  }
}
for (const root of roots) walk(path.join(src, root), root !== ".");
const known = new Set(files);

function resolveImport(from, spec) {
  let target;
  if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else if (spec.startsWith("@shared/")) target = `shared/${spec.slice(8)}`;
  else if (spec.startsWith("@/")) target = `client/src/${spec.slice(2)}`;
  else return null;
  for (const candidate of [target, ...[".ts", ".tsx", ".js", ".cjs", ".mjs"].map((e) => target + e), ...["/index.ts", "/index.tsx"].map((e) => target + e)]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

const dependents = new Map();
for (const file of files) {
  const text = fs.readFileSync(path.join(src, file), "utf8");
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g)) {
    const target = resolveImport(file, match[1]);
    if (!target) continue;
    if (!dependents.has(target)) dependents.set(target, new Set());
    dependents.get(target).add(file);
  }
}

const seeds = inSrc.filter((file) => code(file) && known.has(file));
const reached = new Set(seeds);
const distance = new Map(seeds.map((file) => [file, 0]));
let frontier = seeds;
for (let depth = 0; depth < DEPTH; depth += 1) {
  const next = [];
  for (const file of frontier) {
    for (const dependent of dependents.get(file) ?? []) {
      if (!reached.has(dependent)) { reached.add(dependent); distance.set(dependent, depth + 1); next.push(dependent); }
    }
  }
  frontier = next;
}
const tests = [...reached].filter(isTest).sort((a, b) => distance.get(a) - distance.get(b) || a.localeCompare(b));

const steps = [["npm", ["run", "check"]]];
const touched = (pattern) => changed.some((file) => pattern.test(file));
if (touched(/^src\/(?:package\.json|script\/)|^\.github\//)) steps.push(["npm", ["run", "check:manifests"]]);
if (touched(/^src\/server\/.*\.ts$/) && !touched(/^src\/server\/.*\.test\./) || touched(/ROUTE_MANIFEST|routes?\.ts$/i)) steps.push(["npm", ["run", "check:routes"]]);
if (touched(/^third_party\//)) steps.push(["npm", ["run", "audit:oss"]]);

console.log(`Changed vs ${base}: ${changed.length} files, ${seeds.length} first-party sources, ${tests.length} dependent tests.`);
if (tests.length > MAX_TESTS) {
  console.log(`More than ${MAX_TESTS} tests are reachable; running the ${MAX_TESTS} closest. Widen deliberately with node --test if needed.`);
}
const chosen = tests.slice(0, MAX_TESTS);
if (chosen.length) steps.push(["node", ["--import", "tsx", "--test", ...chosen]]);

for (const [command, commandArgs] of steps) {
  console.log(`\n$ ${command} ${commandArgs.length > 8 ? commandArgs.slice(0, 4).join(" ") + ` … (${commandArgs.length - 3} files)` : commandArgs.join(" ")}`);
  if (dry) continue;
  const result = spawnSync(command, commandArgs, { cwd: src, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\nprepush gate failed at: ${command} ${commandArgs.slice(0, 3).join(" ")}. Fix before pushing; a push restarts every required hosted check.`);
    process.exit(result.status ?? 1);
  }
}
if (!dry) console.log("\nprepush gate passed. One push is now justified.");
