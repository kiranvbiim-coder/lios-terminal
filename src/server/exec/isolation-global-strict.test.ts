import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { conversationAttachmentRefSchema } from "@shared/conversationRuntime";
import { callPythonService } from "../pythonService";
import { LepSidecarSupervisor } from "../p11SidecarSupervisor";
import { installManagedRuntime } from "../pythonRuntimeManager";
import { parseLocalDocumentWithDocling } from "../p7DocumentIntelligence";
import { resolveConversationAttachmentContent } from "../projectAttachmentContent";
import { parseSpreadsheetArtifactImport } from "../spreadsheetArtifactImport";
import { createPlaywrightBrowserAdapter } from "../playwrightBrowserAdapter";

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

test("global strict mode is a non-downgrade floor for every risky host fallback", async () => {
  const previous = process.env.LIOS_EXECUTION_ISOLATION;
  process.env.LIOS_EXECUTION_ISOLATION = "strict";
  try {
    await assert.rejects(
      () => callPythonService("/health", {}, { isolationMode: "legacy-host" }),
      /host-sidecar fallback is refused/,
    );

    assert.throws(
      () => new LepSidecarSupervisor({
        command: process.execPath,
        isolationMode: "legacy-host",
      }),
      /host-sidecar fallback is refused/,
    );

    await assert.rejects(
      () => installManagedRuntime(["core"], [], { isolationMode: "legacy-host" }),
      /host pip\/venv fallback is refused/,
    );

    await assert.rejects(
      () => parseLocalDocumentWithDocling("/path/that/must/not/be-opened.pdf"),
      /host Docling fallback is refused/,
    );

    const pdf = Buffer.from("%PDF-strict-refusal", "ascii");
    await assert.rejects(
      () => resolveConversationAttachmentContent(
        reference("report.pdf", "application/pdf", pdf),
        pdf,
      ),
      /in-process pdf-parse fallback is refused/,
    );

    assert.throws(
      () => parseSpreadsheetArtifactImport({
        bytes: Buffer.from("Name,Revenue\nAlpha,125\n", "utf8"),
        originalName: "strict.csv",
      }),
      /in-process SheetJS fallback is refused/,
    );

    await assert.rejects(
      () => createPlaywrightBrowserAdapter({ isolationMode: "host-policy-only" }),
      /No canonical browser runtime currently proves|isolated Playwright transport is not implemented/,
    );
  } finally {
    if (previous === undefined) delete process.env.LIOS_EXECUTION_ISOLATION;
    else process.env.LIOS_EXECUTION_ISOLATION = previous;
  }
});

test("global strict mode still permits bounded non-parser text attachment handling", async () => {
  const previous = process.env.LIOS_EXECUTION_ISOLATION;
  process.env.LIOS_EXECUTION_ISOLATION = "strict";
  try {
    const bytes = Buffer.from("bounded plain text", "utf8");
    const resolved = await resolveConversationAttachmentContent(
      reference("note.txt", "text/plain", bytes),
      bytes,
    );
    assert.equal(resolved.textContent, "bounded plain text");
  } finally {
    if (previous === undefined) delete process.env.LIOS_EXECUTION_ISOLATION;
    else process.env.LIOS_EXECUTION_ISOLATION = previous;
  }
});
