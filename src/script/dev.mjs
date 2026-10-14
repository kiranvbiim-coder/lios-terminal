import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const REQUIRED_MAJOR = 22;

function versionParts(binary) {
  const match = binary.match(/(?:^|[\/])v(\d+)\.(\d+)\.(\d+)(?:[\/]|$)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isSupported(binary) {
  const parts = versionParts(binary);
  return parts ? parts[0] >= REQUIRED_MAJOR : false;
}

export function resolveSupportedNode(current = process.execPath) {
  const candidates = [];
  if (process.env.LIMURIA_NODE_PATH) candidates.push(process.env.LIMURIA_NODE_PATH);

  if (platform() === "darwin") {
    candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");
  }

  try {
    const nvmDir = join(homedir(), ".nvm", "versions", "node");
    if (existsSync(nvmDir)) {
      for (const version of readdirSync(nvmDir)) {
        const binary = join(nvmDir, version, "bin", "node");
        if (existsSync(binary)) candidates.push(binary);
      }
    }
  } catch {
    // Fall through to an explicit error if no supported runtime is found.
  }

  const supported = [current, ...candidates].filter(isSupported).sort((a, b) => {
    const av = versionParts(a);
    const bv = versionParts(b);
    return (bv?.[0] ?? 0) - (av?.[0] ?? 0) || (bv?.[1] ?? 0) - (av?.[1] ?? 0) || (bv?.[2] ?? 0) - (av?.[2] ?? 0);
  });
  return supported[0] ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const node = resolveSupportedNode();
  if (!node) {
    console.error("LiOS requires Node.js >=22.12. Install a supported Node runtime or set LIMURIA_NODE_PATH.");
    process.exit(1);
  }
  const child = spawn(node, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}
