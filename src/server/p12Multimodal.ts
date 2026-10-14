import crypto from "node:crypto";
import {
  multimodalAttachmentSchema,
  type MultimodalAttachment,
  type MultimodalAttachmentKind,
} from "@shared/multimodalContracts";
import {
  conversationRequestSchema,
  type ConversationRequest,
} from "@shared/conversationRuntime";
import {
  extensionOf,
  safeUploadFileName,
  validateUploadFileSignature,
} from "./uploadPolicy";

const DOCUMENT_EXTENSIONS = new Set(["pdf", "txt", "md", "csv", "tsv", "json", "docx", "pptx", "xlsx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function inferKind(fileName: string, requested?: MultimodalAttachmentKind): MultimodalAttachmentKind {
  if (requested) return requested;
  const ext = extensionOf(fileName);
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  throw new Error("Unsupported multimodal attachment type.");
}

export function normalizeMultimodalAttachment(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  kind?: MultimodalAttachmentKind;
  textPreview?: string | null;
  width?: number | null;
  height?: number | null;
  sourceRef?: string | null;
}): MultimodalAttachment {
  if (input.bytes.byteLength <= 0) throw new Error("Attachment is empty.");
  const fileName = safeUploadFileName(input.fileName);
  const ext = extensionOf(fileName);
  const signatureError = validateUploadFileSignature(Buffer.from(input.bytes), ext);
  if (signatureError) throw new Error(signatureError);
  const kind = inferKind(fileName, input.kind);
  if ((kind === "image" || kind === "screenshot") && !IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Image/screenshot attachment requires PNG, JPEG or WebP.");
  }
  if (kind === "document" && !DOCUMENT_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported document attachment.");
  }
  const sha256 = crypto.createHash("sha256").update(input.bytes).digest("hex");
  return multimodalAttachmentSchema.parse({
    id: crypto.randomUUID(),
    kind,
    fileName,
    mimeType: input.mimeType,
    byteLength: input.bytes.byteLength,
    sha256,
    sourceRef: input.sourceRef ?? `attachment-sha256:${sha256}`,
    localPath: null,
    textPreview: input.textPreview ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
  });
}

export function attachMultimodalInputs(
  requestInput: ConversationRequest,
  attachments: readonly MultimodalAttachment[],
): ConversationRequest {
  const request = conversationRequestSchema.parse(requestInput);
  const normalized = attachments.map((attachment) => multimodalAttachmentSchema.parse(attachment));
  return conversationRequestSchema.parse({
    ...request,
    attachments: normalized.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      sourceRef: attachment.sourceRef,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sha256: attachment.sha256,
      byteLength: attachment.byteLength,
      textPreview: attachment.textPreview,
    })),
  });
}

export function multimodalPipelineRoute(attachment: MultimodalAttachment): {
  pipeline: "document_intelligence" | "conversation_attachment";
  componentId: string;
} {
  if (attachment.kind === "document") {
    return { pipeline: "document_intelligence", componentId: "lios.project.document-intelligence" };
  }
  return { pipeline: "conversation_attachment", componentId: "lios.conversation-runtime" };
}
