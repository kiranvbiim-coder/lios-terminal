import assert from "node:assert/strict";
import test from "node:test";
import {
  attachMultimodalInputs,
  multimodalPipelineRoute,
  normalizeMultimodalAttachment,
} from "./p12Multimodal";

const baseRequest = {
  requestId: "00000000-0000-4000-8000-000000001250",
  continuationOf: null,
  message: "explain these attachments",
  executionMode: "deterministic_first" as const,
  aiDirectApproved: false,
  approvals: [],
  transmissionPolicy: {
    mode: "configured" as const,
    providerAllow: [],
    providerDeny: [],
    allowProjectInstructions: true,
    allowResourceReferences: true,
    allowSelection: true,
    allowToolCalling: true,
    dataClassification: "private" as const,
  },
  attachments: [],
  context: { view: "research", activeObjectRefs: ["artifact:1"] },
};

test("P12 PNG screenshots become governed ConversationRequest attachment refs", () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
  const attachment = normalizeMultimodalAttachment({
    bytes: png,
    fileName: "screen.png",
    mimeType: "image/png",
    kind: "screenshot",
    width: 1200,
    height: 800,
  });
  const request = attachMultimodalInputs(baseRequest, [attachment]);
  assert.equal(request.attachments.length, 1);
  assert.equal(request.attachments[0]?.kind, "screenshot");
  assert.deepEqual(request.context, baseRequest.context);
  assert.equal(multimodalPipelineRoute(attachment).componentId, "lios.conversation-runtime");
});

test("P12 PDF documents reuse document-intelligence pipeline", () => {
  const attachment = normalizeMultimodalAttachment({
    bytes: Buffer.from("%PDF-1.7\n"),
    fileName: "filing.pdf",
    mimeType: "application/pdf",
  });
  assert.equal(attachment.kind, "document");
  assert.equal(multimodalPipelineRoute(attachment).pipeline, "document_intelligence");
});

test("P12 image signatures fail closed on spoofed files", () => {
  assert.throws(() => normalizeMultimodalAttachment({
    bytes: Buffer.from("not-png"),
    fileName: "fake.png",
    mimeType: "image/png",
  }), /PNG/i);
});


test("P12 DOCX/PPTX/XLSX reuse the canonical document-intelligence pipeline", () => {
  const office = [
    ["contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["model.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const;
  for (const [fileName, mimeType] of office) {
    const attachment = normalizeMultimodalAttachment({
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]),
      fileName,
      mimeType,
    });
    assert.equal(attachment.kind, "document");
    assert.equal(multimodalPipelineRoute(attachment).pipeline, "document_intelligence");
  }
});
