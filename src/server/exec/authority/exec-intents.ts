// LiOS GM-11b.5 — registered internal execution intents.
//
// Donor mechanism reference: OpenClaw exec-safe-bin policy/validator/semantics
// (MIT, Copyright (c) 2026 OpenClaw Foundation), pinned commit
// c074824a27c96d3983043f9eeb33823cd1772d8c.
//
// LiOS adapts the fixed semantic-profile idea, not OpenClaw's allowlist or
// approval authority. An ExecIntent is a closed LiOS-owned argv template whose
// mutable file operands can later be bound by GM-11 exact-operation identity.

import type { ChildEnvProfile } from "../env";

export type InternalExecIntentId =
  | "sandbox.terminal.readonly"
  | "market.community.history"
  | "market.community.fundamentals"
  | "archive.zip.extract.unzip"
  | "archive.zip.extract.python-stdlib"
  | "agent.python.data"
  | "agent.shell.command"
  | "coding.workspace.check"
  | "voice.whisper-cpp.transcribe";

export type InternalExecIntentRequest =
  | {
      intentId: "sandbox.terminal.readonly";
      executable: string;
    }
  | {
      intentId: "market.community.history";
      executable: string;
      scriptPath: string;
      symbol: string;
      range: string;
      interval: string;
    }
  | {
      intentId: "market.community.fundamentals";
      executable: string;
      scriptPath: string;
      symbol: string;
    }
  | {
      intentId: "archive.zip.extract.unzip";
      executable: string;
      archivePath: string;
      destinationPath: string;
    }
  | {
      intentId: "archive.zip.extract.python-stdlib";
      executable: string;
      archivePath: string;
      destinationPath: string;
    }
  | {
      intentId: "agent.python.data";
      executable: string;
      code: string;
    }
  | {
      intentId: "agent.shell.command";
      executable: string;
      command: string;
    }
  | {
      intentId: "coding.workspace.check";
      executable: string;
      check: "npm-check" | "npm-test" | "git-diff-check" | "node-test";
      targets?: string[];
    }
  | {
      intentId: "voice.whisper-cpp.transcribe";
      executable: string;
      modelPath: string;
      audioPath: string;
      language?: string | null;
    };

export interface InternalExecIntentDescriptor {
  readonly version: 1;
  readonly intentId: InternalExecIntentId;
  /** Static secret-safe label suitable for approval/receipt UI. */
  readonly label: string;
  /** Exact argv template after request validation. */
  readonly argv: readonly string[];
  /**
   * Mutable code/config/archive operands whose contents can change the approved
   * side effect and therefore belong in GM-11 exact-operation identity.
   * Large domain data/model inputs are not automatically hashed here; their
   * provenance belongs to the owning capability/receipt layer.
   */
  readonly operationFilePaths: readonly string[];
  /** Environment profile to use if/when this intent is wired to runCommand. */
  readonly envProfile: ChildEnvProfile;
  /** Environment names the caller may source; values are never stored here. */
  readonly environmentKeys: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
  readonly stdinMode?: "pipe-closed" | "pipe-open";
  readonly allowedInteractiveInputs?: readonly string[];
  readonly interactiveInputPolicy?: "sandbox-readonly-console";
}

const MARKET_ENVIRONMENT_KEYS = Object.freeze([
  "PYTHONDONTWRITEBYTECODE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
] as const);

const MARKET_RANGES = new Set([
  "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max",
]);
const MARKET_INTERVALS = new Set([
  "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h",
  "1d", "5d", "1wk", "1mo", "3mo",
]);

function assertLiteral(value: unknown, field: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0") ||
    /[\r\n]/u.test(value)
  ) {
    throw new Error(`Internal execution intent ${field} is invalid.`);
  }
  return value;
}

function assertExecutable(value: unknown): string {
  const executable = assertLiteral(value, "executable", 4096);
  if (executable.startsWith("-")) {
    throw new Error("Internal execution intent executable is invalid.");
  }
  return executable;
}

function assertPath(value: unknown, field: string): string {
  const filename = assertLiteral(value, field, 4096);
  if (filename === "-" || filename.startsWith("-")) {
    throw new Error(`Internal execution intent ${field} must be an explicit path token.`);
  }
  return filename;
}

function assertMarketSymbol(value: unknown): string {
  const symbol = assertLiteral(value, "symbol", 64);
  if (!/^[A-Za-z0-9^.=:_-]+$/u.test(symbol)) {
    throw new Error("Internal execution intent symbol contains unsupported characters.");
  }
  return symbol;
}

function assertMarketRange(value: unknown): string {
  const range = assertLiteral(value, "range", 16);
  if (!MARKET_RANGES.has(range)) {
    throw new Error("Internal execution intent market range is unsupported.");
  }
  return range;
}

function assertMarketInterval(value: unknown): string {
  const interval = assertLiteral(value, "interval", 16);
  if (!MARKET_INTERVALS.has(interval)) {
    throw new Error("Internal execution intent market interval is unsupported.");
  }
  return interval;
}

function assertAgentPayload(value: unknown, field: "code" | "command"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16 * 1024 || value.includes("\0")) {
    throw new Error(`Internal execution intent ${field} is invalid.`);
  }
  return value;
}

function assertLanguage(value: unknown): string {
  const language = assertLiteral(value, "language", 35);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(language)) {
    throw new Error("Internal execution intent language is unsupported.");
  }
  return language;
}

function descriptor(input: Omit<InternalExecIntentDescriptor, "version">): InternalExecIntentDescriptor {
  const argv = Object.freeze([...input.argv]);
  const operationFilePaths = Object.freeze([...input.operationFilePaths]);
  const environmentKeys = Object.freeze([...input.environmentKeys]);
  return Object.freeze({
    version: 1 as const,
    ...input,
    argv,
    operationFilePaths,
    environmentKeys,
  });
}

export function buildInternalExecIntent(request: InternalExecIntentRequest): InternalExecIntentDescriptor {
  switch (request.intentId) {

    case "sandbox.terminal.readonly": {
      const executable = assertExecutable(request.executable);
      const shellProgram = [
        "printf 'Read-only sandbox console. Type help for allowed commands.\\n'",
        "while IFS= read -r line; do",
        "  case \"$line\" in",
        "    help) printf 'Allowed commands: help, pwd, id -u, ls /tmp, exit\\n' ;;",
        "    pwd) pwd ;;",
        "    'id -u') id -u ;;",
        "    'ls /tmp') ls -la /tmp ;;",
        "    exit) exit 0 ;;",
        "    *) printf 'Denied: input is not in the reviewed read-only command set.\\n' >&2 ;;",
        "  esac",
        "done",
      ].join("\n");
      return descriptor({
        intentId: request.intentId,
        label: "Open restricted read-only sandbox console",
        argv: [executable, "-c", shellProgram],
        operationFilePaths: [],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 5 * 60_000,
        maxOutputChars: 256 * 1024,
        stdinMode: "pipe-open",
        interactiveInputPolicy: "sandbox-readonly-console",
        allowedInteractiveInputs: Object.freeze(["help", "pwd", "id -u", "ls /tmp", "exit"]),
      });
    }

    case "market.community.history": {
      const executable = assertExecutable(request.executable);
      const scriptPath = assertPath(request.scriptPath, "scriptPath");
      const symbol = assertMarketSymbol(request.symbol);
      const range = assertMarketRange(request.range);
      const interval = assertMarketInterval(request.interval);
      return descriptor({
        intentId: request.intentId,
        label: "Download community market history",
        argv: [executable, scriptPath, "--symbol", symbol, "--range", range, "--interval", interval],
        operationFilePaths: [scriptPath],
        envProfile: "python-runtime",
        environmentKeys: MARKET_ENVIRONMENT_KEYS,
        timeoutMs: 60_000,
        maxOutputChars: 50 * 1024 * 1024,
      });
    }

    case "market.community.fundamentals": {
      const executable = assertExecutable(request.executable);
      const scriptPath = assertPath(request.scriptPath, "scriptPath");
      const symbol = assertMarketSymbol(request.symbol);
      return descriptor({
        intentId: request.intentId,
        label: "Download community fundamentals",
        argv: [executable, scriptPath, "--symbol", symbol],
        operationFilePaths: [scriptPath],
        envProfile: "python-runtime",
        environmentKeys: MARKET_ENVIRONMENT_KEYS,
        timeoutMs: 60_000,
        maxOutputChars: 10 * 1024 * 1024,
      });
    }

    case "archive.zip.extract.unzip": {
      const executable = assertExecutable(request.executable);
      const archivePath = assertPath(request.archivePath, "archivePath");
      const destinationPath = assertPath(request.destinationPath, "destinationPath");
      return descriptor({
        intentId: request.intentId,
        label: "Extract ZIP archive",
        argv: [executable, "-o", "-q", archivePath, "-d", destinationPath],
        operationFilePaths: [archivePath],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 30_000,
        maxOutputChars: 1024 * 1024,
      });
    }

    case "archive.zip.extract.python-stdlib": {
      const executable = assertExecutable(request.executable);
      const archivePath = assertPath(request.archivePath, "archivePath");
      const destinationPath = assertPath(request.destinationPath, "destinationPath");
      return descriptor({
        intentId: request.intentId,
        label: "Extract ZIP archive with Python",
        argv: [executable, "-m", "zipfile", "-e", archivePath, destinationPath],
        operationFilePaths: [archivePath],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 30_000,
        maxOutputChars: 1024 * 1024,
      });
    }

    case "agent.python.data": {
      const executable = assertExecutable(request.executable);
      const code = assertAgentPayload(request.code, "code");
      return descriptor({
        intentId: request.intentId,
        label: "Run governed Python/data code in the strict sandbox",
        argv: [executable, "-I", "-B", "-c", code],
        operationFilePaths: [],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 2 * 60_000,
        maxOutputChars: 1024 * 1024,
      });
    }

    case "agent.shell.command": {
      const executable = assertExecutable(request.executable);
      const command = assertAgentPayload(request.command, "command");
      return descriptor({
        intentId: request.intentId,
        label: "Run governed shell command in the strict sandbox",
        argv: [executable, "-c", command],
        operationFilePaths: [],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 60_000,
        maxOutputChars: 1024 * 1024,
      });
    }

    case "coding.workspace.check": {
      const executable = assertExecutable(request.executable);
      const check = request.check;
      const targets = (request.targets ?? []).map((value) => {
        const target = assertPath(value, "target");
        if (target.startsWith("/") || target.includes("\\") || target.split("/").includes("..")) {
          throw new Error("Internal coding check target must be a repository-relative POSIX path.");
        }
        return target;
      });
      let argv: string[];
      let operationFilePaths: string[];
      if (check === "npm-check") {
        if (targets.length) throw new Error("npm-check does not accept test targets.");
        argv = [executable, "run", "check"];
        operationFilePaths = ["package.json"];
      } else if (check === "npm-test") {
        if (targets.length) throw new Error("npm-test does not accept test targets.");
        argv = [executable, "test"];
        operationFilePaths = ["package.json"];
      } else if (check === "git-diff-check") {
        if (targets.length) throw new Error("git-diff-check does not accept test targets.");
        argv = [executable, "diff", "--check"];
        operationFilePaths = [];
      } else {
        if (targets.length < 1 || targets.length > 10) throw new Error("node-test requires 1 to 10 bounded test targets.");
        argv = [executable, "--test", ...targets];
        operationFilePaths = [...targets];
      }
      return descriptor({
        intentId: request.intentId,
        label: `Run governed coding check: ${check}`,
        argv,
        operationFilePaths,
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 2 * 60_000,
        maxOutputChars: 200_000,
      });
    }

    case "voice.whisper-cpp.transcribe": {
      const executable = assertExecutable(request.executable);
      const modelPath = assertPath(request.modelPath, "modelPath");
      const audioPath = assertPath(request.audioPath, "audioPath");
      const language = request.language == null ? null : assertLanguage(request.language);
      return descriptor({
        intentId: request.intentId,
        label: "Transcribe audio with whisper.cpp",
        argv: [
          executable,
          "-m", modelPath,
          "-f", audioPath,
          "-nt",
          ...(language ? ["-l", language] : []),
        ],
        operationFilePaths: [],
        envProfile: "default",
        environmentKeys: [],
        timeoutMs: 15 * 60 * 1000,
        maxOutputChars: 2 * 1024 * 1024,
      });
    }
  }
}
