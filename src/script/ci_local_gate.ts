import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Mirrors the five source validation commands from the standard hosted workflow.
 * Node/native and Python dependencies must already be installed locally, and
 * PYTHON_EXECUTABLE must name a supported interpreter. Installation and runner
 * setup are not validation steps. No native/SP/release qualification is implied.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");
const workflow = path.resolve(srcRoot, "..", ".github", "workflows", "source-cross-platform.yml");
const SOURCE_COMMANDS = new Set([
  "npm run check", "npm run test:offline", "npm run test:desktop",
  "python -m unittest discover -s python-service -p 'test_*.py' -v", "npm run build",
]);

interface GateStep {
  name: string;
  command: string;
  needsDatabase: boolean;
}

/** The workflow is regular: `      - name: X` starts a step and a one-line command is `        run: <command>`. */
export function parseGateSteps(text: string): GateStep[] {
  const steps: GateStep[] = [];
  let current: { name: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const command = current.lines.map((line) => /^ {8}run: (?![|>])(.+)$/.exec(line)?.[1]).find(Boolean);
    if (command) steps.push({ name: current.name, command: command.trim(), needsDatabase: current.lines.some((line) => /^ {10}LIOS_RLS_INTEGRATION:/.test(line)) });
    current = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const start = /^ {6}- name: (.+)$/.exec(line);
    if (start) {
      flush();
      current = { name: start[1]!.trim(), lines: [] };
    } else if (current && /^ {0,5}\S/.test(line) && !line.startsWith("      ")) {
      flush();
    } else {
      current?.lines.push(line);
    }
  }
  flush();
  return steps;
}

function main(): number {
  const logDirectory = process.env.LOGDIR ?? path.join(os.tmpdir(), "lios-gate-local");
  fs.mkdirSync(logDirectory, { recursive: true });
  const steps = parseGateSteps(fs.readFileSync(workflow, "utf8"))
    .filter(step => SOURCE_COMMANDS.has(step.command));
  if (steps.length !== SOURCE_COMMANDS.size || new Set(steps.map(step => step.command)).size !== SOURCE_COMMANDS.size) {
    throw new Error(`Source validation commands drifted in ${workflow}; refusing an incomplete local gate.`);
  }
  const failed: string[] = [];
  for (const step of steps) {
    const started = Date.now();
    const logFile = path.join(logDirectory, `${step.name.replace(/[^A-Za-z0-9]+/g, "_")}.log`);
    console.log(`START ${step.name} -> ${logFile}`);
    const logFd = fs.openSync(logFile, "w");
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync("bash", ["-c", step.command], {
        cwd: srcRoot, stdio: ["ignore", logFd, logFd],
      });
    } finally {
      fs.closeSync(logFd);
    }
    if (result.error) fs.appendFileSync(logFile, `\nGate launch failed: ${result.error.message}\n`);
    const code = result.status ?? 1;
    if (code !== 0) failed.push(step.name);
    console.log(`${code === 0 ? "ok  " : "FAIL"} ${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s  ${step.name}${code === 0 ? "" : `  -> ${logFile}`}`);
  }
  console.log(`\nMirrored all ${steps.length} source validation steps. Dependencies and interpreter setup are prerequisites, not passing checks.`);
  console.log(failed.length ? `FAILED: ${failed.join("; ")}` : "All source validation steps passed.");
  console.log("Real-data benchmark, native hardware, packaged SP and P14 release qualification: NOT_RUN.");
  return failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
