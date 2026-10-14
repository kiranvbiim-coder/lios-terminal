import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildP7DoclingIsolationRequest,
  parseLocalDocumentWithDoclingIsolated,
} from "./p7DocumentIntelligence";
import type { ExecutionBackend } from "./exec/backends/types";
import type { ExecutionBackendRunner } from "./exec/run-backend";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-docling-isolation-"));
  const file = path.join(root, "statement.pdf");
  fs.writeFileSync(file, Buffer.from("%PDF-test"));
  return { root, file };
}

function backend(): ExecutionBackend {
  return {
    id: "lios.execution.test-container",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["deny"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    },
    async prepare() {
      throw new Error("test runner injection should own execution");
    },
  };
}

function exit(overrides: Partial<{
  reason: "exit" | "manual-cancel" | "overall-timeout" | "no-output-timeout" | "spawn-error" | "signal";
  exitCode: number | null;
  stderr: string;
}> = {}) {
  return {
    reason: overrides.reason ?? "exit",
    exitCode: overrides.exitCode === undefined ? 0 : overrides.exitCode,
    exitSignal: null,
    durationMs: 1,
    stdout: "",
    stderr: overrides.stderr ?? "",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    noOutputTimedOut: false,
  };
}

test("isolated Docling request exposes only container paths and declared copy bridge facts", () => {
  const f = fixture();
  try {
    const { request, source } = buildP7DoclingIsolationRequest(f.file);
    assert.equal(source.absolutePath, fs.realpathSync(f.file));
    assert.equal(source.bytes, Buffer.byteLength("%PDF-test"));
    assert.equal(request.argv[0], "/usr/bin/python3");
    assert.ok(request.argv.includes("/workspace/statement.pdf"));
    assert.ok(request.argv.includes("/workspace/.lios-docling-result.json"));
    assert.equal(JSON.stringify(request.argv).includes(f.root), false, "host root is absent from command argv");
    assert.deepEqual(request.isolation, {
      filesystem: "sandbox",
      network: "deny",
      processes: "sandbox",
    });
    assert.equal(request.resources.maxWallTimeMs, 120_000);
    assert.equal(request.resources.maxMemoryBytes, 2 * 1024 * 1024 * 1024);
    assert.equal(request.resources.maxProcesses, 32);
    assert.equal(request.env, undefined, "host proxy/cache environment is not inherited");
    assert.deepEqual(request.workspaceTransfer?.inputs, ["statement.pdf"]);
    assert.deepEqual(request.workspaceTransfer?.outputs, [".lios-docling-result.json"]);
    assert.equal(request.workspaceTransfer?.mode, "write-return");
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("isolated Docling validates the in-image Python path", () => {
  const f = fixture();
  try {
    assert.throws(
      () => buildP7DoclingIsolationRequest(f.file, { sandboxPythonPath: "python3" }),
      /absolute NUL-free path/,
    );
    assert.throws(
      () => buildP7DoclingIsolationRequest(f.file, { sandboxPythonPath: "/usr/bin/python3\0bad" }),
      /absolute NUL-free path/,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("isolated Docling returns declared output through backend finalization", async () => {
  const f = fixture();
  let capturedRoot: string | undefined;
  try {
    const structured = {
      texts: [{
        self_ref: "#/texts/0",
        label: "section_header",
        text: "Parsed section",
        prov: [{ page_no: 3, bbox: { l: 10, t: 20, r: 30, b: 40 } }],
      }],
      tables: [],
    };
    const payload = Buffer.from(JSON.stringify({ markdown: "# Parsed\n\nValue", structured }));
    const runner: ExecutionBackendRunner = async (_backend, request) => {
      capturedRoot = request.workspaceTransfer?.root;
      return {
        backendId: "lios.execution.test-container",
        facts: {
          isolation: { ...request.isolation },
          resources: { ...request.resources },
          runtimeGenerationId: "lios-exec-test",
          workspaceTransfer: {
            mode: "write-return",
            inputs: [{
              path: "statement.pdf",
              size: Buffer.byteLength("%PDF-test"),
              sha256: crypto.createHash("sha256").update("%PDF-test").digest("hex"),
            }],
            outputs: [".lios-docling-result.json"],
          },
        },
        exit: exit({ stderr: "parser warning" }),
        finalization: {
          workspaceOutputs: [{
            path: ".lios-docling-result.json",
            size: payload.length,
            sha256: crypto.createHash("sha256").update(payload).digest("hex"),
            data: payload,
          }],
        },
      };
    };

    const result = await parseLocalDocumentWithDoclingIsolated(f.file, {
      backend: backend(),
      runner,
    });

    assert.equal(capturedRoot, fs.realpathSync(f.root));
    assert.equal(result.markdown, "# Parsed\n\nValue");
    assert.deepEqual(result.structuredDocument, structured);
    assert.equal(result.sourcePath, fs.realpathSync(f.file));
    assert.equal(result.sourceBytes, Buffer.byteLength("%PDF-test"));
    assert.deepEqual(result.warnings, ["parser warning"]);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("isolated Docling fails closed on nonzero execution", async () => {
  const f = fixture();
  try {
    const runner: ExecutionBackendRunner = async (_backend, request) => ({
      backendId: "lios.execution.test-container",
      facts: {
        isolation: { ...request.isolation },
        resources: { ...request.resources },
      },
      exit: exit({ exitCode: 7, stderr: "docling failed" }),
      finalization: {},
    });
    await assert.rejects(
      () => parseLocalDocumentWithDoclingIsolated(f.file, { backend: backend(), runner }),
      /Isolated Docling failed: docling failed/,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("isolated Docling requires its declared output file", async () => {
  const f = fixture();
  try {
    const runner: ExecutionBackendRunner = async (_backend, request) => ({
      backendId: "lios.execution.test-container",
      facts: {
        isolation: { ...request.isolation },
        resources: { ...request.resources },
      },
      exit: exit(),
      finalization: { workspaceOutputs: [] },
    });
    await assert.rejects(
      () => parseLocalDocumentWithDoclingIsolated(f.file, { backend: backend(), runner }),
      /did not return its declared result file/,
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
