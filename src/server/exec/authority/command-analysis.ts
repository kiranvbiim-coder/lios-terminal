// Adapted conceptually from OpenClaw command-carriers.ts and command-analysis/*
// (MIT, Copyright (c) 2026 OpenClaw Foundation), pinned commit
// c074824a27c96d3983043f9eeb33823cd1772d8c.
//
// LiOS GM-11b.4 keeps only pure argv/carrier analysis. It does not import
// OpenClaw approval persistence or policy authority. Results deliberately omit
// raw argv, inline code and environment values so analysis facts are safe to
// attach to approval/receipt metadata.

import path from "node:path";

export type ExecutionCommandKind = "node" | "python" | "posix-shell" | "unknown";

export type ExecutionCommandAnalysisReason =
  | "invalid-argv"
  | "carrier-command-missing"
  | "carrier-option-unrecognized"
  | "carrier-split-payload-requires-shell-analysis"
  | "carrier-shell-mode-requires-shell-analysis"
  | "carrier-depth-exceeded"
  | "inline-shell-payload-requires-shell-analysis"
  | "shell-stdin-payload-requires-shell-analysis"
  | "module-specifier-requires-resolution"
  | "interpreter-option-unrecognized"
  | "unclassified-command-operands";

export interface ExecutionCommandAnalysis {
  version: 1;
  analyzable: boolean;
  reason: ExecutionCommandAnalysisReason | null;
  kind: ExecutionCommandKind;
  executable: string | null;
  carriers: string[];
  environmentAssignmentKeys: string[];
  operationFilePaths: string[];
  inlineEvaluation: "node" | "python" | null;
}

type CarrierResult =
  | { ok: true; argv: string[]; carrier: string; environmentAssignmentKeys?: string[] }
  | { ok: false; reason: ExecutionCommandAnalysisReason; carrier: string; environmentAssignmentKeys?: string[] };

const MAX_CARRIER_DEPTH = 16;
const ENV_STANDALONE = new Set(["-0", "-i", "--ignore-environment", "--null"]);
const ENV_WITH_VALUE = new Set([
  "-C", "-P", "-s", "-u", "--argv0", "--block-signal", "--chdir",
  "--default-signal", "--ignore-signal", "--unset",
]);
const ENV_SPLIT = new Set(["-S", "-s", "--split-string"]);
const SUDO_STANDALONE = new Set([
  "-A", "-B", "-b", "-E", "-H", "-i", "-k", "-N", "-n", "-P", "-S", "-s",
  "--askpass", "--background", "--bell", "--login", "--no-update", "--non-interactive",
  "--preserve-env", "--preserve-groups", "--reset-home", "--reset-timestamp",
  "--set-home", "--stdin",
]);
const SUDO_WITH_VALUE = new Set([
  "-C", "-D", "-g", "-h", "-p", "-R", "-T", "-U", "-u",
  "--chdir", "--chroot", "--close-from", "--command-timeout", "--group", "--host",
  "--other-user", "--prompt", "--role", "--type", "--user",
]);
const SUDO_SHELL_MODE = new Set(["-i", "-s", "--login"]);
const DOAS_SHELL_MODE = new Set(["-s"]);
const SUDO_NON_EXEC = new Set([
  "-K", "-l", "-V", "-v", "-e", "--edit", "--help", "--list",
  "--remove-timestamp", "--validate", "--version",
]);
const DOAS_STANDALONE = new Set(["-L", "-n", "-s"]);
const DOAS_WITH_VALUE = new Set(["-a", "-C", "-u"]);
const EXEC_STANDALONE = new Set(["-c", "-l"]);
const EXEC_WITH_VALUE = new Set(["-a"]);
const COMMAND_EXEC = new Set(["-p"]);
const COMMAND_QUERY = new Set(["-v", "-V"]);

const NODE_NAMES = new Set(["node", "nodejs"]);
const PYTHON_NAMES = new Set(["python", "python3", "python2", "py"]);
const POSIX_SHELL_NAMES = new Set(["sh", "bash", "dash", "zsh", "ksh"]);

const NODE_STANDALONE = new Set([
  "--abort-on-uncaught-exception", "--enable-source-maps", "--experimental-strip-types",
  "--experimental-transform-types", "--no-addons", "--no-deprecation", "--no-warnings",
  "--preserve-symlinks", "--preserve-symlinks-main", "--trace-deprecation",
  "--trace-uncaught", "--trace-warnings", "--use-bundled-ca", "--use-openssl-ca",
  "--watch", "-v", "--version", "-h", "--help",
]);
const NODE_WITH_VALUE = new Set([
  "--conditions", "--icu-data-dir", "--inspect-port", "--input-type", "--max-http-header-size",
  "--openssl-config", "--redirect-warnings", "--title",
]);
const NODE_FILE_OPTIONS = new Set([
  "-r", "--require", "--import", "--env-file", "--env-file-if-exists",
  "--loader", "--experimental-loader",
]);
const NODE_INLINE = new Set(["-e", "--eval", "-p", "--print"]);

const PYTHON_STANDALONE = new Set([
  "-B", "-E", "-I", "-O", "-OO", "-P", "-q", "-s", "-S", "-u", "-v", "-V",
  "-b", "-d", "-i",
]);
const PYTHON_WITH_VALUE = new Set(["-W", "-X", "--check-hash-based-pycs"]);
const SHELL_SHORT_STANDALONE = new Set([
  "-a", "-b", "-e", "-f", "-h", "-k", "-m", "-n", "-p", "-t", "-u", "-v", "-x",
  "-B", "-C", "-D", "-E", "-H", "-P", "-T", "-l", "-r",
]);
const SHELL_LONG_STANDALONE = new Set([
  "--debugger", "--noprofile", "--norc", "--noediting", "--posix", "--restricted",
  "--verbose", "--version",
]);
const SHELL_FILE_OPTIONS = new Set(["--rcfile", "--init-file"]);
const SHELL_VALUE_OPTIONS = new Set(["-o", "-O"]);

function executableName(token: string): string {
  let name = path.basename(token).toLowerCase();
  if (name.endsWith(".exe")) name = name.slice(0, -4);
  return name;
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*$/u.test(token);
}

function envAssignmentKey(token: string): string | null {
  if (!isEnvAssignment(token)) return null;
  const delimiter = token.indexOf("=");
  return delimiter > 0 ? token.slice(0, delimiter) : null;
}

function splitLongOption(token: string): { name: string; inlineValue: string | null } {
  const delimiter = token.indexOf("=");
  return delimiter > 2
    ? { name: token.slice(0, delimiter), inlineValue: token.slice(delimiter + 1) }
    : { name: token, inlineValue: null };
}

function shortClusterContainsOption(
  token: string,
  targets: ReadonlySet<string>,
  standalone: ReadonlySet<string>,
  withValue: ReadonlySet<string>,
): boolean {
  if (!/^-[A-Za-z0-9]/u.test(token) || token.startsWith("--")) return false;
  for (let index = 1; index < token.length; index += 1) {
    const option = `-${token[index] ?? ""}`;
    if (targets.has(option)) return true;
    if (withValue.has(option)) return false;
    if (!standalone.has(option)) return false;
  }
  return false;
}

function parseShortCluster(
  token: string,
  standalone: ReadonlySet<string>,
  withValue: ReadonlySet<string>,
): { ok: true; consumesNext: boolean } | { ok: false } {
  if (!/^-[A-Za-z0-9]/u.test(token) || token.startsWith("--")) return { ok: false };
  for (let index = 1; index < token.length; index += 1) {
    const option = `-${token[index] ?? ""}`;
    if (withValue.has(option)) {
      return { ok: true, consumesNext: index === token.length - 1 };
    }
    if (!standalone.has(option)) return { ok: false };
  }
  return { ok: true, consumesNext: false };
}

function unwrapEnv(argv: readonly string[]): CarrierResult {
  const keys: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    const key = envAssignmentKey(token);
    if (key) {
      keys.push(key);
      continue;
    }
    if (token === "--" || token === "-") {
      return index + 1 < argv.length
        ? { ok: true, argv: argv.slice(index + 1), carrier: "env", environmentAssignmentKeys: keys }
        : { ok: false, reason: "carrier-command-missing", carrier: "env", environmentAssignmentKeys: keys };
    }
    if (!token.startsWith("-")) {
      return { ok: true, argv: argv.slice(index), carrier: "env", environmentAssignmentKeys: keys };
    }
    const long = splitLongOption(token);
    if (
      ENV_SPLIT.has(long.name) ||
      shortClusterContainsOption(token, new Set(["-S", "-s"]), ENV_STANDALONE, ENV_WITH_VALUE)
    ) {
      return {
        ok: false,
        reason: "carrier-split-payload-requires-shell-analysis",
        carrier: "env",
        environmentAssignmentKeys: keys,
      };
    }
    if (token.startsWith("--")) {
      if (ENV_STANDALONE.has(long.name)) continue;
      if (ENV_WITH_VALUE.has(long.name)) {
        if (long.inlineValue === null) index += 1;
        if (index >= argv.length) {
          return { ok: false, reason: "carrier-command-missing", carrier: "env", environmentAssignmentKeys: keys };
        }
        continue;
      }
      return { ok: false, reason: "carrier-option-unrecognized", carrier: "env", environmentAssignmentKeys: keys };
    }
    const parsed = parseShortCluster(token, ENV_STANDALONE, new Set([...ENV_WITH_VALUE, "-s"]));
    if (!parsed.ok) {
      return { ok: false, reason: "carrier-option-unrecognized", carrier: "env", environmentAssignmentKeys: keys };
    }
    if (parsed.consumesNext) index += 1;
    if (index >= argv.length) {
      return { ok: false, reason: "carrier-command-missing", carrier: "env", environmentAssignmentKeys: keys };
    }
  }
  return { ok: false, reason: "carrier-command-missing", carrier: "env", environmentAssignmentKeys: keys };
}

function unwrapOptionCarrier(
  argv: readonly string[],
  carrier: "sudo" | "doas" | "exec",
): CarrierResult {
  const standalone = carrier === "sudo" ? SUDO_STANDALONE : carrier === "doas" ? DOAS_STANDALONE : EXEC_STANDALONE;
  const withValue = carrier === "sudo" ? SUDO_WITH_VALUE : carrier === "doas" ? DOAS_WITH_VALUE : EXEC_WITH_VALUE;
  const nonExec = carrier === "sudo" ? SUDO_NON_EXEC : new Set<string>();
  const shellMode = carrier === "sudo" ? SUDO_SHELL_MODE : carrier === "doas" ? DOAS_SHELL_MODE : new Set<string>();
  const assignmentKeys: string[] = [];
  let index = 1;
  for (; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      index += 1;
      break;
    }
    if (!token.startsWith("-")) break;
    const long = splitLongOption(token);
    if (nonExec.has(long.name)) return { ok: false, reason: "carrier-command-missing", carrier };
    if (shellMode.has(long.name)) return { ok: false, reason: "carrier-shell-mode-requires-shell-analysis", carrier };
    if (token.startsWith("--")) {
      if (standalone.has(long.name)) continue;
      if (withValue.has(long.name)) {
        if (long.inlineValue === null) index += 1;
        if (index >= argv.length) return { ok: false, reason: "carrier-command-missing", carrier };
        continue;
      }
      return { ok: false, reason: "carrier-option-unrecognized", carrier };
    }
    if (shortClusterContainsOption(token, shellMode, standalone, withValue)) {
      return { ok: false, reason: "carrier-shell-mode-requires-shell-analysis", carrier };
    }
    const parsed = parseShortCluster(token, standalone, withValue);
    if (!parsed.ok) return { ok: false, reason: "carrier-option-unrecognized", carrier };
    if (parsed.consumesNext) index += 1;
    if (index >= argv.length) return { ok: false, reason: "carrier-command-missing", carrier };
  }
  if (carrier === "sudo") {
    while (index < argv.length && isEnvAssignment(argv[index] ?? "")) {
      const key = envAssignmentKey(argv[index] ?? "");
      if (key) assignmentKeys.push(key);
      index += 1;
    }
  }
  return index < argv.length
    ? { ok: true, argv: argv.slice(index), carrier, environmentAssignmentKeys: assignmentKeys }
    : { ok: false, reason: "carrier-command-missing", carrier, environmentAssignmentKeys: assignmentKeys };
}

function unwrapCommandBuiltin(argv: readonly string[], carrier: "command" | "builtin"): CarrierResult {
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      return index + 1 < argv.length
        ? { ok: true, argv: argv.slice(index + 1), carrier }
        : { ok: false, reason: "carrier-command-missing", carrier };
    }
    if (!token.startsWith("-")) return { ok: true, argv: argv.slice(index), carrier };
    if (COMMAND_QUERY.has(token)) return { ok: false, reason: "carrier-command-missing", carrier };
    if (!COMMAND_EXEC.has(token)) return { ok: false, reason: "carrier-option-unrecognized", carrier };
  }
  return { ok: false, reason: "carrier-command-missing", carrier };
}

function unwrapOneCarrier(argv: readonly string[]): CarrierResult | null {
  const name = executableName(argv[0] ?? "");
  if (name === "env") return unwrapEnv(argv);
  if (name === "sudo" || name === "doas" || name === "exec") return unwrapOptionCarrier(argv, name);
  if (name === "command" || name === "builtin") return unwrapCommandBuiltin(argv, name);
  return null;
}

function pathLikeModuleSpecifier(value: string): boolean {
  return value.startsWith(".") || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(value);
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

function analyzeNode(argv: readonly string[]): Omit<ExecutionCommandAnalysis, "version" | "carriers" | "environmentAssignmentKeys"> {
  const files: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      const script = argv[index + 1];
      if (script && script !== "-") pushUnique(files, script);
      return { analyzable: true, reason: null, kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
    }
    const long = splitLongOption(token);
    if (NODE_INLINE.has(long.name) || (token.startsWith("-e") && token !== "-") || (token.startsWith("-p") && token !== "-")) {
      return { analyzable: true, reason: null, kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: "node" };
    }
    if (NODE_FILE_OPTIONS.has(long.name)) {
      const value = long.inlineValue ?? argv[++index];
      if (!value) return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      if (long.name === "--env-file" || long.name === "--env-file-if-exists" || pathLikeModuleSpecifier(value)) {
        pushUnique(files, value);
      } else {
        return { analyzable: false, reason: "module-specifier-requires-resolution", kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      }
      continue;
    }
    if (NODE_STANDALONE.has(long.name)) continue;
    if (NODE_WITH_VALUE.has(long.name)) {
      if (long.inlineValue === null) index += 1;
      if (index >= argv.length) return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      continue;
    }
    if (token.startsWith("-")) {
      return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
    }
    if (token !== "-") pushUnique(files, token);
    return { analyzable: true, reason: null, kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
  }
  return { analyzable: true, reason: null, kind: "node", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
}

function analyzePython(argv: readonly string[]): Omit<ExecutionCommandAnalysis, "version" | "carriers" | "environmentAssignmentKeys"> {
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      const script = argv[index + 1];
      return { analyzable: true, reason: null, kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: script && script !== "-" ? [script] : [], inlineEvaluation: null };
    }
    if (token === "-c" || token.startsWith("-c")) {
      return { analyzable: true, reason: null, kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: [], inlineEvaluation: "python" };
    }
    if (token === "-m" || token.startsWith("-m")) {
      return { analyzable: false, reason: "module-specifier-requires-resolution", kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: [], inlineEvaluation: null };
    }
    const long = splitLongOption(token);
    if (PYTHON_STANDALONE.has(long.name)) continue;
    if ((token.startsWith("-W") && token !== "-W") || (token.startsWith("-X") && token !== "-X")) continue;
    if (PYTHON_WITH_VALUE.has(long.name)) {
      if (long.inlineValue === null) index += 1;
      if (index >= argv.length) return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: [], inlineEvaluation: null };
      continue;
    }
    if (token.startsWith("-")) {
      return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: [], inlineEvaluation: null };
    }
    return { analyzable: true, reason: null, kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: token === "-" ? [] : [token], inlineEvaluation: null };
  }
  return { analyzable: true, reason: null, kind: "python", executable: executableName(argv[0] ?? ""), operationFilePaths: [], inlineEvaluation: null };
}

function shellShortClusterKind(token: string): "inline" | "stdin" | "standalone" | "unknown" {
  if (!/^-[A-Za-z]+$/u.test(token) || token.startsWith("--")) return "unknown";
  for (let index = 1; index < token.length; index += 1) {
    const option = `-${token[index] ?? ""}`;
    if (option === "-c") return "inline";
    if (option === "-s") return "stdin";
    if (SHELL_VALUE_OPTIONS.has(option)) return "unknown";
    if (!SHELL_SHORT_STANDALONE.has(option)) return "unknown";
  }
  return "standalone";
}

function analyzePosixShell(argv: readonly string[]): Omit<ExecutionCommandAnalysis, "version" | "carriers" | "environmentAssignmentKeys"> {
  const files: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      const script = argv[index + 1];
      if (!script) {
        return { analyzable: false, reason: "shell-stdin-payload-requires-shell-analysis", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      }
      pushUnique(files, script);
      return { analyzable: true, reason: null, kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
    }

    const long = splitLongOption(token);
    if (token.startsWith("--")) {
      if (SHELL_LONG_STANDALONE.has(long.name)) continue;
      if (SHELL_FILE_OPTIONS.has(long.name)) {
        const value = long.inlineValue ?? argv[++index];
        if (!value) return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
        pushUnique(files, value);
        continue;
      }
      return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
    }

    if (SHELL_VALUE_OPTIONS.has(token)) {
      index += 1;
      if (index >= argv.length) return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      continue;
    }
    if (token.startsWith("-")) {
      const cluster = shellShortClusterKind(token);
      if (cluster === "inline") {
        return { analyzable: false, reason: "inline-shell-payload-requires-shell-analysis", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      }
      if (cluster === "stdin") {
        return { analyzable: false, reason: "shell-stdin-payload-requires-shell-analysis", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      }
      if (cluster === "unknown") {
        return { analyzable: false, reason: "interpreter-option-unrecognized", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
      }
      continue;
    }

    pushUnique(files, token);
    return { analyzable: true, reason: null, kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
  }
  return { analyzable: false, reason: "shell-stdin-payload-requires-shell-analysis", kind: "posix-shell", executable: executableName(argv[0] ?? ""), operationFilePaths: files, inlineEvaluation: null };
}

export function analyzeExecutionCommand(input: readonly string[]): ExecutionCommandAnalysis {
  if (input.length === 0 || input.some((value) => typeof value !== "string" || !value || value.includes("\0"))) {
    return {
      version: 1, analyzable: false, reason: "invalid-argv", kind: "unknown", executable: null,
      carriers: [], environmentAssignmentKeys: [], operationFilePaths: [], inlineEvaluation: null,
    };
  }

  let argv = [...input];
  const carriers: string[] = [];
  const environmentAssignmentKeys: string[] = [];
  for (let depth = 0; depth < MAX_CARRIER_DEPTH; depth += 1) {
    const carrier = unwrapOneCarrier(argv);
    if (!carrier) break;
    carriers.push(carrier.carrier);
    for (const key of carrier.environmentAssignmentKeys ?? []) pushUnique(environmentAssignmentKeys, key);
    if (!carrier.ok) {
      return {
        version: 1, analyzable: false, reason: carrier.reason, kind: "unknown", executable: null,
        carriers, environmentAssignmentKeys, operationFilePaths: [], inlineEvaluation: null,
      };
    }
    argv = carrier.argv;
    if (argv.length === 0) {
      return {
        version: 1, analyzable: false, reason: "carrier-command-missing", kind: "unknown", executable: null,
        carriers, environmentAssignmentKeys, operationFilePaths: [], inlineEvaluation: null,
      };
    }
  }

  if (unwrapOneCarrier(argv)) {
    return {
      version: 1, analyzable: false, reason: "carrier-depth-exceeded", kind: "unknown", executable: null,
      carriers, environmentAssignmentKeys, operationFilePaths: [], inlineEvaluation: null,
    };
  }

  const name = executableName(argv[0] ?? "");
  const detail = NODE_NAMES.has(name)
    ? analyzeNode(argv)
    : PYTHON_NAMES.has(name)
      ? analyzePython(argv)
      : POSIX_SHELL_NAMES.has(name)
        ? analyzePosixShell(argv)
        : {
            analyzable: false,
            reason: "unclassified-command-operands" as const,
            kind: "unknown" as const,
            executable: name || null,
            operationFilePaths: [],
            inlineEvaluation: null,
          };

  return { version: 1, carriers, environmentAssignmentKeys, ...detail };
}
