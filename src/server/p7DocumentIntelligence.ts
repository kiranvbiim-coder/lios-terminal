import { runCommand } from "./exec/run-command";
import {
  runExecutionBackendRequest,
  type ExecutionBackendRunner,
} from "./exec/run-backend";
import type {
  ExecutionBackend,
  ExecutionBackendRequest,
} from "./exec/backends/types";
import fs from "node:fs";
import path from "node:path";
import { assertLocalByodRuntime } from "./runtimeSecurity";
import { sandboxIsolationMode } from "./exec/sandbox-runtime-profile";
import { managedRuntimePythonPath, readManagedRuntimeState } from "./pythonRuntimeManager";

const DOCLING_TIMEOUT_MS = 120_000;
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ISOLATED_MAX_INPUT_BYTES = 64 * 1024 * 1024;
const ISOLATED_CAPTURED_OUTPUT_CHARS = 64 * 1024;
const ISOLATED_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const ISOLATED_MAX_PROCESSES = 32;
const ISOLATED_RESULT_PATH = ".lios-docling-result.json";
export const P7_DOCLING_UPSTREAM_COMMIT = "14789f2c2c542f8d127a0aac85eb779d5bba554e";
export const P7_DOCLING_VERSION = "2.129.0";

export interface P7DocumentParseResult {
  parser: "docling";
  parserVersion: string;
  upstreamCommit: string;
  markdown: string;
  /** Raw donor structure exists only at the parser boundary; P7 projects it immediately into LiOS-owned bounded structure. */
  structuredDocument: unknown | null;
  sourcePath: string;
  sourceBytes: number;
  warnings: string[];
}

export interface P7DoclingIsolationOptions {
  backend: ExecutionBackend;
  /** Absolute Python path inside the immutable sandbox image. */
  sandboxPythonPath?: string;
  signal?: AbortSignal;
  /** Test/integration injection; production defaults to the canonical GM-11c runner. */
  runner?: ExecutionBackendRunner;
}

export interface P7DocumentRuntimeStatus {
  docling: {
    installed: boolean;
    selected: boolean;
    version: string;
    upstreamCommit: string;
    reason: string | null;
  };
  semanticSearch: {
    baseline: "builtin_lexical";
    vectorAcceleration: "optional_adapter";
    canonicalStore: "postgres_pglite";
    sqliteVecActive: false;
  };
}

function assertLocalFile(inputPath: string): { absolutePath: string; bytes: number } {
  if (!path.isAbsolute(inputPath)) throw new Error("Docling input must be an absolute local file path.");
  const absolutePath = fs.realpathSync(inputPath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error("Docling input must be a regular local file.");
  if (stat.size <= 0) throw new Error("Docling input file is empty.");
  if (stat.size > MAX_INPUT_BYTES) throw new Error("Docling input exceeds the 100 MB local parsing limit.");
  return { absolutePath, bytes: stat.size };
}

export function p7DocumentRuntimeStatus(): P7DocumentRuntimeStatus {
  const state = readManagedRuntimeState();
  const selected = Boolean(state?.selectedPackIds.includes("research-docs"));
  const python = managedRuntimePythonPath();
  return {
    docling: {
      installed: selected && Boolean(python),
      selected,
      version: P7_DOCLING_VERSION,
      upstreamCommit: P7_DOCLING_UPSTREAM_COMMIT,
      reason: !selected
        ? "Install/activate the optional research-docs managed runtime pack."
        : !python
          ? "The managed Python runtime is not available."
          : null,
    },
    semanticSearch: {
      baseline: "builtin_lexical",
      vectorAcceleration: "optional_adapter",
      canonicalStore: "postgres_pglite",
      sqliteVecActive: false,
    },
  };
}

function doclingScript(writeToFile: boolean, isolatedNativePdf = false): string {
  const lines = ["import json, sys"];
  if (isolatedNativePdf) {
    lines.push(
      "import os",
      "os.environ['PYTHONNOUSERSITE'] = '1'",
      "os.environ['PYTHONDONTWRITEBYTECODE'] = '1'",
      "os.environ['TOKENIZERS_PARALLELISM'] = 'false'",
      "os.environ['HF_HUB_OFFLINE'] = '1'",
      "os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'",
      "os.environ['TRANSFORMERS_OFFLINE'] = '1'",
      "os.environ['DOCLING_ALLOW_REMOTE_SERVICES'] = 'false'",
      "from pathlib import Path",
      "from docling.datamodel.base_models import InputFormat",
      "from docling.datamodel.pipeline_options import NativePdfPipelineOptions",
      "from docling.document_converter import DocumentConverter, NativePdfFormatOption",
      "source = sys.argv[1]",
      "if Path(source).suffix.lower() == '.pdf':",
      "    pipeline_options = NativePdfPipelineOptions()",
      "    converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: NativePdfFormatOption(pipeline_options=pipeline_options)})",
      "else:",
      "    converter = DocumentConverter()",
      "result = converter.convert(source)",
    );
  } else {
    lines.push(
      "from docling.document_converter import DocumentConverter",
      "source = sys.argv[1]",
      "result = DocumentConverter().convert(source)",
    );
  }
  lines.push("document = result.document");
  if (writeToFile) {
    lines.push(
      "handle = open(sys.argv[2], 'w', encoding='utf-8')",
      "json.dump({'markdown': document.export_to_markdown(), 'structured': document.export_to_dict()}, handle)",
      "handle.close()",
    );
  } else {
    lines.push("print(json.dumps({'markdown': document.export_to_markdown(), 'structured': document.export_to_dict()}))");
  }
  return lines.join("\n");
}

function parseDoclingPayload(
  bytes: Buffer | string,
  source: { absolutePath: string; bytes: number },
  stderr: string,
): P7DocumentParseResult {
  const raw = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes;
  if (Buffer.byteLength(raw, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error("Docling output exceeds the 16 MB local parsing limit.");
  }
  const payload = JSON.parse(raw) as { markdown?: unknown; structured?: unknown };
  if (typeof payload.markdown !== "string" || !payload.markdown.trim()) {
    throw new Error("Docling returned no searchable document text.");
  }
  return {
    parser: "docling",
    parserVersion: P7_DOCLING_VERSION,
    upstreamCommit: P7_DOCLING_UPSTREAM_COMMIT,
    markdown: payload.markdown.slice(0, 2_000_000),
    structuredDocument: payload.structured && typeof payload.structured === "object" ? payload.structured : null,
    sourcePath: source.absolutePath,
    sourceBytes: source.bytes,
    warnings: stderr.trim() ? [stderr.trim().slice(0, 4_000)] : [],
  };
}

export function buildP7DoclingIsolationRequest(
  inputPath: string,
  options: Pick<P7DoclingIsolationOptions, "sandboxPythonPath" | "signal"> = {},
): {
  request: ExecutionBackendRequest;
  source: { absolutePath: string; bytes: number };
} {
  const source = assertLocalFile(inputPath);
  if (source.bytes > ISOLATED_MAX_INPUT_BYTES) {
    throw new Error("Isolated Docling currently accepts files up to 64 MB.");
  }

  const python = options.sandboxPythonPath ?? "/usr/bin/python3";
  if (!python.startsWith("/") || python.includes("\0")) {
    throw new Error("Isolated Docling Python path must be an absolute NUL-free path inside the sandbox image.");
  }

  const root = path.dirname(source.absolutePath);
  const inputName = path.basename(source.absolutePath);
  if (inputName === ISOLATED_RESULT_PATH) {
    throw new Error("Docling input name conflicts with the reserved isolated result path.");
  }

  return {
    source,
    request: {
      argv: [
        python,
        "-c",
        doclingScript(true, true),
        "/workspace/" + inputName,
        "/workspace/" + ISOLATED_RESULT_PATH,
      ],
      isolation: {
        filesystem: "sandbox",
        network: "deny",
        processes: "sandbox",
      },
      resources: {
        maxWallTimeMs: DOCLING_TIMEOUT_MS,
        maxCapturedOutputChars: ISOLATED_CAPTURED_OUTPUT_CHARS,
        maxMemoryBytes: ISOLATED_MEMORY_BYTES,
        maxProcesses: ISOLATED_MAX_PROCESSES,
      },
      signal: options.signal,
      workspaceTransfer: {
        root,
        inputs: [inputName],
        outputs: [ISOLATED_RESULT_PATH],
        mode: "write-return",
        maxFileBytes: ISOLATED_MAX_INPUT_BYTES,
        maxTotalBytes: ISOLATED_MAX_INPUT_BYTES,
      },
    },
  };
}

/**
 * Explicit isolated P7 Docling route. The caller must provide a provisioned
 * backend whose immutable image contains Docling. PDF parsing uses Docling's
 * model-free NativePdfPipeline so network-denied execution does not require
 * runtime model downloads. Offline flags are set inside the sandboxed Python
 * process before Docling imports, keeping the canonical container request
 * environment empty and avoiding a second env authority. No host Python
 * executable, proxy variables, cache directories or host bind mounts are
 * inherited into this execution.
 */
export async function parseLocalDocumentWithDoclingIsolated(
  inputPath: string,
  options: P7DoclingIsolationOptions,
): Promise<P7DocumentParseResult> {
  assertLocalByodRuntime("Docling document intelligence");
  const { request, source } = buildP7DoclingIsolationRequest(inputPath, options);
  const runner = options.runner ?? runExecutionBackendRequest;
  const executed = await runner(options.backend, request);

  if (executed.exit.reason !== "exit" || executed.exit.exitCode !== 0) {
    const detail = executed.exit.stderr.trim().slice(0, 4_000);
    throw new Error(
      detail
        ? `Isolated Docling failed: ${detail}`
        : `Isolated Docling failed (reason=${executed.exit.reason}, code=${executed.exit.exitCode ?? "null"}).`,
    );
  }

  const returned = executed.finalization.workspaceOutputs?.find(
    (file) => file.path === ISOLATED_RESULT_PATH,
  );
  if (!returned) {
    throw new Error("Isolated Docling did not return its declared result file.");
  }
  return parseDoclingPayload(returned.data, source, executed.exit.stderr);
}

export async function parseLocalDocumentWithDocling(inputPath: string): Promise<P7DocumentParseResult> {
  assertLocalByodRuntime("Docling document intelligence");
  if (sandboxIsolationMode() === "strict") {
    throw new Error(
      "Strict SI-01.12 isolation requires parseLocalDocumentWithDoclingIsolated(); host Docling fallback is refused.",
    );
  }
  const status = p7DocumentRuntimeStatus();
  if (!status.docling.installed) throw new Error(status.docling.reason ?? "Docling runtime is unavailable.");
  const python = managedRuntimePythonPath();
  if (!python) throw new Error("Managed Python runtime is unavailable.");
  const { absolutePath, bytes } = assertLocalFile(inputPath);

  const result = await runCommand({
    argv: [python, "-c", doclingScript(false), absolutePath],
    timeoutMs: DOCLING_TIMEOUT_MS,
    maxOutputChars: MAX_OUTPUT_BYTES,
    env: {
      PYTHONNOUSERSITE: "1",
      TOKENIZERS_PARALLELISM: "false",
      PYTHONDONTWRITEBYTECODE: "1",
      HF_HOME: process.env.HF_HOME,
      HF_HUB_CACHE: process.env.HF_HUB_CACHE,
      TORCH_HOME: process.env.TORCH_HOME,
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY,
      http_proxy: process.env.http_proxy,
      https_proxy: process.env.https_proxy,
      all_proxy: process.env.all_proxy,
      no_proxy: process.env.no_proxy,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE,
      SSL_CERT_DIR: process.env.SSL_CERT_DIR,
      REQUESTS_CA_BUNDLE: process.env.REQUESTS_CA_BUNDLE,
      CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE,
    },
  });
  return parseDoclingPayload(
    result.stdout,
    { absolutePath, bytes },
    result.stderr,
  );
}
