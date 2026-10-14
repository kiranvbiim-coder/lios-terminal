import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { conversationAttachmentRefSchema } from "@shared/conversationRuntime";
import {
  resolveConversationAttachmentContentIsolated,
} from "./projectAttachmentContent";
import type { ExecutionBackend } from "./exec/backends/types";
import type { ExecutionBackendRunner } from "./exec/run-backend";

function reference(fileName: string, mimeType: string, bytes: Buffer) {
  const id = crypto.randomUUID();
  return conversationAttachmentRefSchema.parse({
    id,
    kind: "document",
    sourceRef: `project-attachment:${id}`,
    fileName,
    mimeType,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    textPreview: null,
  });
}

function backend(): ExecutionBackend {
  return {
    id: "test.container",
    capabilities: {
      filesystem: ["sandbox"],
      network: ["deny"],
      processes: ["sandbox"],
      resourceControls: ["wall-time", "captured-output", "memory", "process-count"],
    },
    async prepare() {
      throw new Error("injected runner owns execution");
    },
  };
}

test("isolated Project PDF uses the Docling backend route and removes host staging", async () => {
  const bytes = Buffer.from("%PDF-isolated-test", "ascii");
  const ref = reference("annual-report.pdf", "application/pdf", bytes);
  let stagingRoot = "";
  const runner: ExecutionBackendRunner = async (_backend, request) => {
    stagingRoot = request.workspaceTransfer?.root ?? "";
    assert.ok(stagingRoot);
    assert.equal(fs.existsSync(stagingRoot), true);
    const payload = Buffer.from(JSON.stringify({
      markdown: "# Financial results\n\nRevenue increased 10%.",
      structured: {
        texts: [{
          self_ref: "#/texts/0",
          label: "section_header",
          text: "Financial results",
          prov: [{ page_no: 4, bbox: { l: 70, t: 700, r: 520, b: 680 } }],
        }],
        tables: [],
      },
    }));
    return {
      backendId: "test.container",
      facts: {
        isolation: { ...request.isolation },
        resources: { ...request.resources },
      },
      exit: {
        reason: "exit",
        exitCode: 0,
        exitSignal: null,
        durationMs: 1,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        noOutputTimedOut: false,
      },
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

  const result = await resolveConversationAttachmentContentIsolated(ref, bytes, {
    backend: backend(),
    runner,
  });

  assert.equal(result.textContent, "# Financial results\n\nRevenue increased 10%.");
  assert.equal(result.reference.id, ref.id);
  assert.equal(result.documentStructure?.sourceMode, "docling");
  assert.equal(result.documentStructure?.sections[0]?.title, "Financial results");
  assert.equal(result.documentStructure?.sections[0]?.anchor.pageNumber, 4);
  assert.equal(fs.existsSync(stagingRoot), false, "temporary host staging is removed");
});

test("isolated Project attachment verifies stored bytes before any runtime call", async () => {
  const bytes = Buffer.from("%PDF-original", "ascii");
  const ref = reference("annual-report.pdf", "application/pdf", bytes);
  let called = false;
  const runner: ExecutionBackendRunner = async () => {
    called = true;
    throw new Error("must not run");
  };

  await assert.rejects(
    () => resolveConversationAttachmentContentIsolated(
      ref,
      Buffer.from("%PDF-tampered", "ascii"),
      { backend: backend(), runner },
    ),
    /integrity check/,
  );
  assert.equal(called, false);
});

test("isolated attachment API keeps simple text decoding in-process without invoking sandbox", async () => {
  const bytes = Buffer.from("bounded text", "utf8");
  const ref = reference("note.txt", "text/plain", bytes);
  let called = false;
  const runner: ExecutionBackendRunner = async () => {
    called = true;
    throw new Error("must not run");
  };

  const result = await resolveConversationAttachmentContentIsolated(ref, bytes, {
    backend: backend(),
    runner,
  });
  assert.equal(result.textContent, "bounded text");
  assert.equal(called, false);
});
