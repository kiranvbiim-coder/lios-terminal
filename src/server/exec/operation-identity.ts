import crypto from "node:crypto";
import fs, { type BigIntStats } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { buildChildEnv, type ChildEnvProfile } from "./env";

type ExecutionInteractiveInputPolicy = "sandbox-readonly-console" | "sandbox-broker-rpc";

export interface ExecutionOperationInput {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envProfile?: ChildEnvProfile;
  argv0?: string;
  windowsVerbatimArguments?: boolean;
  input?: string;
  stdinMode?: "inherit" | "pipe-open" | "pipe-closed";
  interactiveInputPolicy?: ExecutionInteractiveInputPolicy;
  /** Mutable script/config operands already identified by canonical command analysis. */
  filePaths?: readonly string[];
}

export interface ExecutionFileIdentity {
  path: string;
  sha256: string;
  size: string;
  device: string;
  inode: string;
  mtimeNs: string;
  ctimeNs: string;
}

export type ExecutionExecutableIdentity = ExecutionFileIdentity;

export interface ExecutionOperationDescriptor {
  version: 1;
  argv: string[];
  cwd: string;
  environment: {
    keys: string[];
    sha256: string;
  };
  executable: ExecutionExecutableIdentity;
  files: ExecutionFileIdentity[];
  launch: {
    argv0: string;
    windowsVerbatimArguments: boolean;
    stdin: {
      mode: "pipe-closed" | "fixed-input" | "interactive-approved";
      sha256: string | null;
      bytes: number;
      interactiveInputPolicy: ExecutionInteractiveInputPolicy | null;
    };
  };
  digest: string;
}

export class ExecutionOperationMismatchError extends Error {
  constructor() {
    super("Approved execution operation no longer matches the operation being launched.");
    this.name = "ExecutionOperationMismatchError";
  }
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(filename: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function isExecutableFile(filename: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filename);
    if (!stat.isFile()) return false;
    await fsp.access(filename, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsCandidateNames(command: string, env: Record<string, string>): string[] {
  if (path.win32.extname(command)) return [command];
  const extensions = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

async function resolveExecutable(command: string, cwd: string, env: Record<string, string>): Promise<string> {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  const direct = path.isAbsolute(command) || hasPathSeparator;
  const roots = direct
    ? [""]
    : (env.PATH ?? "").split(path.delimiter);
  const names = process.platform === "win32" ? windowsCandidateNames(command, env) : [command];

  for (const root of roots) {
    for (const name of names) {
      const candidate = direct
        ? path.resolve(cwd, name)
        : path.resolve(path.isAbsolute(root) ? root : path.resolve(cwd, root), name);
      if (!await isExecutableFile(candidate)) continue;
      return fsp.realpath(candidate);
    }
  }
  throw new Error("Execution executable could not be resolved.");
}

function canonicalEnvironment(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function sameDigest(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function sameFileStat(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function isClosedInteractivePolicy(value: unknown): value is ExecutionInteractiveInputPolicy {
  return value === "sandbox-readonly-console" || value === "sandbox-broker-rpc";
}

export async function describeExecutionOperation(
  input: ExecutionOperationInput,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Promise<ExecutionOperationDescriptor> {
  if (!input.argv[0] || input.argv.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new Error("Execution argv must contain a nonempty executable and NUL-free string arguments.");
  }

  if (
    input.stdinMode === "inherit" ||
    (input.stdinMode === "pipe-open" && !isClosedInteractivePolicy(input.interactiveInputPolicy)) ||
    (input.interactiveInputPolicy !== undefined && input.stdinMode !== "pipe-open")
  ) {
    throw new Error("Approval-bound execution cannot use inherited or open stdin unless it is a fixed payload or a closed server-owned interactive policy.");
  }
  const cwd = await fsp.realpath(path.resolve(input.cwd ?? process.cwd()));
  const cwdStat = await fsp.stat(cwd);
  if (!cwdStat.isDirectory()) throw new Error("Execution working directory must be a directory.");

  const effectiveEnv = buildChildEnv(input.env, parentEnv, process.platform, input.envProfile);
  const environmentEntries = canonicalEnvironment(effectiveEnv);
  const snapshotFile = async (filename: string): Promise<ExecutionFileIdentity> => {
    const realPath = await fsp.realpath(path.isAbsolute(filename) ? filename : path.resolve(cwd, filename));
    const before = await fsp.stat(realPath, { bigint: true });
    if (!before.isFile()) throw new Error("Execution file identity requires a regular file.");
    const digest = await sha256File(realPath);
    const after = await fsp.stat(realPath, { bigint: true });
    if (!sameFileStat(before, after)) {
      throw new Error("Execution file changed while its identity was being captured.");
    }
    return {
      path: realPath,
      sha256: digest,
      size: after.size.toString(),
      device: after.dev.toString(),
      inode: after.ino.toString(),
      mtimeNs: after.mtimeNs.toString(),
      ctimeNs: after.ctimeNs.toString(),
    };
  };
  const executablePath = await resolveExecutable(input.argv[0], cwd, effectiveEnv);
  const executable: ExecutionExecutableIdentity = await snapshotFile(executablePath);
  const filesByPath = new Map<string, ExecutionFileIdentity>();
  for (const filename of input.filePaths ?? []) {
    if (typeof filename !== "string" || !filename || filename.includes("\0")) {
      throw new Error("Execution file paths must be nonempty NUL-free strings.");
    }
    const identity = await snapshotFile(filename);
    filesByPath.set(identity.path, identity);
  }
  const files = [...filesByPath.values()]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const environmentSha256 = sha256(JSON.stringify(environmentEntries));
  const inputBuffer = input.input === undefined ? null : Buffer.from(input.input, "utf8");
  const launch = {
    argv0: input.argv0 ?? input.argv[0],
    windowsVerbatimArguments: input.windowsVerbatimArguments === true,
    stdin: {
      mode: inputBuffer
        ? "fixed-input" as const
        : input.stdinMode === "pipe-open"
          ? "interactive-approved" as const
          : "pipe-closed" as const,
      sha256: inputBuffer ? sha256(inputBuffer) : null,
      bytes: inputBuffer?.byteLength ?? 0,
      interactiveInputPolicy: input.stdinMode === "pipe-open" ? input.interactiveInputPolicy! : null,
    },
  };
  const payload = {
    version: 1,
    argv: [...input.argv],
    cwd,
    environment: environmentEntries,
    executable,
    files,
    launch,
  };
  return {
    version: 1,
    argv: [...input.argv],
    cwd,
    environment: {
      keys: environmentEntries.map(([name]) => name),
      sha256: environmentSha256,
    },
    executable,
    files,
    launch,
    digest: sha256(JSON.stringify(payload)),
  };
}

export async function assertExecutionOperationBinding(
  input: ExecutionOperationInput,
  expectedDigest: string,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Promise<ExecutionOperationDescriptor> {
  const descriptor = await describeExecutionOperation(input, parentEnv);
  if (!sameDigest(descriptor.digest, expectedDigest)) throw new ExecutionOperationMismatchError();
  return descriptor;
}
