#!/usr/bin/env node
// Development source qualification only. Never registers a service or publishes runtime bytes.
import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sourceCommit = "c074824a27c96d3983043f9eeb33823cd1772d8c";
const sourceArchiveSha256 = "b46d105119db2d5cf96601af4f287d562997fd672e2f94f9f4bb68b4ecdf468c";
const image = "node@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f";
const pnpmRootSha512 = "e3f305bc784a2bc89f5ad3b6138889470fae8d2af5f36b61216ec91c2c3d64089775f9de38aac331044ea40f245cb0d5666392dfdf65824e1907ef6a2c62de5f";
const nativeIntegrity = "sha512-3PkUBYo5z4dgtlnTNIFj7QGpcDUAuqXz9WGVigPDCeccEnhGiRkWmA5102TmYJHtwJP3LfmE+ZF9PGeWhn8p9Q==";
const registryKey = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY6Ya7W++7aUPzvMTrezH6Ycx3c+HOKYCcNGybJZSCJq/fd7Qa8uuAKtdIkUQtQiEKERhAmE5lMMJhP8OkDOa2g==";
const nativeSignature = "MEUCIQCTS9y2/ZT/OB604KbwSJwSPxTIlwW3VijIIkuXjASGIwIgcnN7YITaIhwqFjp/ezjpfK+yyg5WNvwsPsXLoOFk8mQ=";
const plan = {
  kind: "approved-source-build-only", sourceCommit, sourceArchiveSha256, image,
  packageManager: "pnpm@12.5.1", platform: "linux/x64", compilerMemoryBytes: 12 * 1024 ** 3,
  phases: ["verified-downloads", "frozen-install-without-hooks", "offline-runtime-build", "offline-compiled-cli-version"],
  donorProfile: "qaRuntime", installScripts: false, pnpmfileHooks: false,
  hostSecretsPassed: false, runtimeArtifactsPublished: false, releaseQualification: false,
};

function command(binary, args, { capture = false, timeout = 120_000 } = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${binary} failed (${result.status ?? result.error?.code}): ${result.stderr?.slice(-2000) ?? "see phase output"}`);
  }
  return result.stdout?.trim() ?? "";
}

async function digestFile(filename, algorithm = "sha256", encoding = "hex") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

async function download(url, filename, maxBytes, algorithm, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download refused: ${response.status} ${url}`);
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error("Download length exceeds bound");
  const output = await open(filename, "wx", 0o600);
  let received = 0;
  try {
    for await (const bytes of response.body) {
      received += bytes.byteLength;
      if (received > maxBytes) throw new Error("Download body exceeds bound");
      let offset = 0;
      while (offset < bytes.byteLength) offset += (await output.write(bytes, offset)).bytesWritten;
    }
  } finally { await output.close(); }
  if (await digestFile(filename, algorithm) !== expected) throw new Error(`Artifact integrity mismatch: ${url}`);
}

async function inventory(directory, relative = "", result = []) {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.posix.join(relative, entry.name);
    // Audit link facts without following them or treating the development output as distributable.
    if (entry.isSymbolicLink()) result.push({ path: child, kind: "symlink", target: await readlink(path.join(directory, child)) });
    else if (entry.isDirectory()) await inventory(directory, child, result);
    else if (entry.isFile()) result.push({ path: child, kind: "file", sha256: await digestFile(path.join(directory, child)) });
  }
  return result;
}

async function build() {
  if (process.platform !== "linux" || process.arch !== "x64" || process.env.GITHUB_REPOSITORY !== "kiranvbiim-coder/lios-terminal") {
    throw new Error("This diagnostic build is restricted to the approved public repository's Linux x64 runner");
  }
  const capacity = JSON.parse(command("docker", ["info", "--format", "{{json .MemTotal}}"], { capture: true }));
  if (!Number.isSafeInteger(capacity) || capacity < plan.compilerMemoryBytes) throw new Error("Insufficient Docker memory; do not override the donor compiler admission");
  const root = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "lios-openclaw-source-build-"));
  const source = path.join(root, "source");
  const tools = path.join(root, "tools");
  await mkdir(source); await mkdir(tools);
  const sourceArchive = path.join(root, "source.tar.gz");
  const rootPnpm = path.join(root, "pnpm-root.tgz");
  const nativePnpm = path.join(root, "pnpm-native.tgz");
  let phase = "verified-downloads";
  const names = [];
  try {
    await Promise.all([
      download(`https://api.github.com/repos/openclaw/openclaw/tarball/${sourceCommit}`, sourceArchive, 256 * 1024 ** 2, "sha256", sourceArchiveSha256),
      download("https://registry.npmjs.org/pnpm/-/pnpm-12.5.1.tgz", rootPnpm, 8 * 1024 ** 2, "sha512", pnpmRootSha512),
      download("https://registry.npmjs.org/@pnpm/exe.linux-x64/-/exe.linux-x64-12.5.1.tgz", nativePnpm, 64 * 1024 ** 2, "sha512", Buffer.from(nativeIntegrity.slice(7), "base64").toString("hex")),
    ]);
    const key = createPublicKey({ key: Buffer.from(registryKey, "base64"), type: "spki", format: "der" });
    if (!verify("sha256", Buffer.from(`@pnpm/exe.linux-x64@12.5.1:${nativeIntegrity}`), key, Buffer.from(nativeSignature, "base64"))) throw new Error("Pinned package-manager registry signature invalid");
    command("tar", ["-xzf", sourceArchive, "--strip-components", "1", "--no-same-owner", "-C", source]);
    command("tar", ["-xzf", nativePnpm, "--strip-components", "1", "--no-same-owner", "-C", tools]);
    const packageJson = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    if (packageJson.packageManager !== `pnpm@12.5.1+sha512.${pnpmRootSha512}`) throw new Error("Source package-manager contract changed");
    command("docker", ["pull", "--platform", "linux/amd64", image]);
    const uid = `${process.getuid()}:${process.getgid()}`;
    const sharedArgs = ["--rm", "--init", "--read-only", "--user", uid, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--cpus", "2", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=128m", "--mount", `type=bind,source=${source},target=/work`, "--mount", `type=bind,source=${tools},target=/tools,readonly`, "--workdir", "/work", "--env", "HOME=/work/.build-home", "--env", "XDG_CACHE_HOME=/work/.cache", "--env", "CI=true", "--env", "PATH=/tools:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin", "--env", `GIT_COMMIT=${sourceCommit}`];
    const dockerPhase = (label, network, memory, entrypoint, args, capture = false) => {
      phase = label;
      const name = `lios-openclaw-${label}-${randomUUID().slice(0, 8)}`;
      names.push(name);
      return command("docker", ["run", ...sharedArgs, "--name", name, "--network", network, "--memory", memory, "--entrypoint", entrypoint, image, ...args], { capture, timeout: label === "compile" ? 30 * 60_000 : 15 * 60_000 });
    };
    dockerPhase("install", "bridge", "2g", "/tools/pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--network-concurrency", "8", "--reporter", "append-only", "--filter", "openclaw...", "--filter", "./packages/**", "--filter", "./extensions/**"]);
    dockerPhase("compile", "none", "12g", "/bin/sh", ["-c", 'node --import ./scripts/tsx.mjs scripts/build-all.mts qaRuntime; status=$?; printf "\\nCompiler cgroup memory events / peak bytes:\\n"; cat /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.peak; exit "$status"']);
    const compiledCliVersion = dockerPhase("version", "none", "512m", "/usr/local/bin/node", ["dist/entry.js", "--version"], true);
    if (!compiledCliVersion.includes(packageJson.version)) throw new Error("Compiled CLI did not report the pinned source version");
    phase = "output-inventory";
    const files = await inventory(path.join(source, "dist"));
    const manifest = JSON.stringify(files);
    await writeFile(path.join(root, "compiled-files.json"), manifest, { flag: "wx" });
    const report = { ...plan, status: "compiled-and-version-exercised", compiledCliVersion, compiledFiles: files.length, compiledInventorySha256: createHash("sha256").update(manifest).digest("hex"), dependencyScriptsExecuted: false, compilerNetwork: "none", runtimeArtifactsPublished: false, localWorkspace: root };
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `## Approved OpenClaw source build\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n\nBuild/CLI proof only. No runtime bytes, services, providers, native acceptance or release are published.\n`, { flag: "a" });
  } catch (error) {
    console.error(JSON.stringify({ ...plan, status: "failed", phase, error: String(error?.message ?? error) }));
    throw error;
  } finally {
    for (const name of names) spawnSync("docker", ["rm", "--force", name], { stdio: "ignore", timeout: 15_000 });
  }
}

if (process.argv.length === 3 && process.argv[2] === "--plan") console.log(JSON.stringify(plan, null, 2));
else if (process.argv.length === 3 && process.argv[2] === "--build") await build();
else throw new Error("Usage: node script/build_approved_openclaw_runtime.mjs --plan|--build");
