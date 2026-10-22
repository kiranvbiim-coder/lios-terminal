import { and, eq, isNull } from "drizzle-orm";
import { conversationAttachmentRefSchema, type ConversationAttachmentRef } from "@shared/conversationRuntime";
import { projectChats, projectResources, projects, type ProjectResource } from "@shared/schema";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import { getProject } from "./projectStore";
import { getProjectChat, ProjectChatAccessDeniedError } from "./projectChatStore";
import { createProjectResource, createProjectResourceInTransaction, listProjectResources } from "./projectResourceStore";
import { normalizeMultimodalAttachment } from "./p12Multimodal";
import {
  deleteProjectAttachmentBlob,
  deleteQuickChatAttachmentBlob,
  readQuickChatAttachmentBlob,
  writeQuickChatAttachmentBlob,
  PROJECT_ATTACHMENT_MAX_FILE_BYTES,
  PROJECT_ATTACHMENT_MAX_IMAGE_BYTES,
  PROJECT_ATTACHMENT_MAX_PER_MESSAGE,
  PROJECT_ATTACHMENT_MAX_PROJECT_BYTES,
  PROJECT_ATTACHMENT_MAX_TOTAL_IMAGE_BYTES,
  PROJECT_ATTACHMENT_RESOURCE_KIND,
  readProjectAttachmentBlob,
  writeProjectAttachmentBlob,
} from "./projectAttachmentStore";
import {
  attachmentUsesIsolatedDocumentParser,
  resolveConversationAttachmentContent,
  resolveConversationAttachmentContentIsolated,
  type ResolvedConversationAttachment,
} from "./projectAttachmentContent";
import {
  resolveSandboxRuntimeProfile,
  sandboxIsolationMode,
} from "./exec/sandbox-runtime-profile";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const KIND_BY_EXTENSION: Record<string, ConversationAttachmentRef["kind"]> = {
  pdf: "document",
  docx: "document",
  pptx: "document",
  xlsx: "document",
  txt: "document",
  md: "document",
  csv: "document",
  tsv: "document",
  json: "document",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
};

export class ProjectAttachmentNotFoundError extends Error {
  constructor() {
    super("Project attachment not found or not owned by the requesting user.");
    this.name = "ProjectAttachmentNotFoundError";
  }
}

export class ProjectAttachmentContextExcludedError extends Error {
  constructor() {
    super("This Project attachment is excluded from conversation context. Change its context setting before attaching it.");
    this.name = "ProjectAttachmentContextExcludedError";
  }
}

export class ProjectAttachmentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAttachmentLimitError";
  }
}

function tenantFilter(ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(projectResources.ownerUserId, ctx.userId), isNull(projectResources.organizationId))
    : and(eq(projectResources.ownerUserId, ctx.userId), eq(projectResources.organizationId, ctx.organizationId));
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function attachmentIdFromResource(resource: ProjectResource): string | null {
  if (resource.kind !== PROJECT_ATTACHMENT_RESOURCE_KIND) return null;
  const metadata = resource.metadata as Record<string, unknown>;
  const id = metadata.attachmentId;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  return id;
}

function referenceFromResource(resource: ProjectResource): ConversationAttachmentRef | null {
  const id = attachmentIdFromResource(resource);
  if (!id) return null;
  const metadata = resource.metadata as Record<string, unknown>;
  const parsed = conversationAttachmentRefSchema.safeParse({
    id,
    kind: metadata.kind,
    sourceRef: resource.resourceRef,
    fileName: resource.label,
    mimeType: metadata.mimeType,
    sha256: metadata.sha256,
    byteLength: metadata.byteLength,
    textPreview: null,
  });
  return parsed.success ? parsed.data : null;
}

function assertMatchingReference(
  supplied: ConversationAttachmentRef,
  stored: ConversationAttachmentRef,
): void {
  if (
    supplied.sourceRef !== stored.sourceRef
    || supplied.sha256 !== stored.sha256
    || supplied.byteLength !== stored.byteLength
    || supplied.fileName !== stored.fileName
    || supplied.mimeType !== stored.mimeType
    || supplied.kind !== stored.kind
  ) {
    throw new ProjectAttachmentNotFoundError();
  }
}

async function assertProjectChatAccess(ctx: TenantContext, projectId: number, chatId: number): Promise<void> {
  await getProject(ctx, projectId);
  let chat;
  try {
    chat = await getProjectChat(ctx, chatId);
  } catch (error) {
    if (error instanceof ProjectChatAccessDeniedError) throw new ProjectAttachmentNotFoundError();
    throw error;
  }
  if (chat.scope !== "project" || chat.projectId !== projectId) throw new ProjectAttachmentNotFoundError();
}

async function assertProjectQuota(
  ctx: TenantContext,
  projectId: number,
  incomingBytes: number,
  executor: any = getDb(),
): Promise<void> {
  const rows: Array<{ metadata: unknown }> = await executor.select({ metadata: projectResources.metadata }).from(projectResources)
    .where(and(tenantFilter(ctx), eq(projectResources.projectId, projectId), eq(projectResources.kind, PROJECT_ATTACHMENT_RESOURCE_KIND)));
  const storedBytes = rows.reduce<number>((total, row) => {
    const value = (row.metadata as Record<string, unknown>).byteLength;
    return total + (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0);
  }, 0);
  if (storedBytes + incomingBytes > PROJECT_ATTACHMENT_MAX_PROJECT_BYTES) {
    throw new ProjectAttachmentLimitError("This file would exceed the 100 MiB Project attachment storage limit. Remove an older file or choose a smaller one.");
  }
}

/** One canonical parser and file-type gate shared by Project and Quick Chat uploads. */
function buildAttachmentReference(input: { bytes: Buffer; originalName: string }, prefix: "project-attachment" | "quick-attachment"): ConversationAttachmentRef {
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > PROJECT_ATTACHMENT_MAX_FILE_BYTES) {
    throw new ProjectAttachmentLimitError("Each attachment must be between 1 byte and 20 MiB.");
  }

  const base = input.originalName.replace(/\\/g, "/").split("/").pop() ?? "attachment";
  const fileName = Array.from(base).map((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? "_" : character;
  }).join("").trim().slice(0, 180) || "attachment";
  const extension = extensionOf(fileName);
  const mimeType = MIME_BY_EXTENSION[extension];
  const kind = KIND_BY_EXTENSION[extension];
  if (!mimeType || !kind) {
    throw new Error("Unsupported file type. Use PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, TSV, JSON, PNG, JPEG or WebP.");
  }
  if (kind === "image" && input.bytes.byteLength > PROJECT_ATTACHMENT_MAX_IMAGE_BYTES) {
    throw new ProjectAttachmentLimitError("Images must be 6 MiB or smaller so vision requests remain bounded.");
  }
  const normalized = normalizeMultimodalAttachment({
    bytes: input.bytes,
    fileName,
    mimeType,
    kind,
    textPreview: null,
    sourceRef: "pending",
  });
  const reference = conversationAttachmentRefSchema.parse({
    id: normalized.id,
    kind: normalized.kind,
    sourceRef: `${prefix}:${normalized.id}`,
    fileName: normalized.fileName,
    mimeType: normalized.mimeType,
    sha256: normalized.sha256,
    byteLength: normalized.byteLength,
    textPreview: null,
  });
  return reference;
}

export async function uploadProjectChatAttachment(
  ctx: TenantContext,
  projectId: number,
  chatId: number,
  input: { bytes: Buffer; originalName: string },
): Promise<ConversationAttachmentRef> {
  await assertProjectChatAccess(ctx, projectId, chatId);
  const reference = buildAttachmentReference(input, "project-attachment");

  await writeProjectAttachmentBlob(ctx.userId, projectId, reference.id, input.bytes);
  try {
    await getDb().transaction(async (tx) => {
      const projectOwnership = ctx.organizationId === null
        ? and(eq(projects.id, projectId), eq(projects.ownerUserId, ctx.userId), isNull(projects.organizationId))
        : and(eq(projects.id, projectId), eq(projects.ownerUserId, ctx.userId), eq(projects.organizationId, ctx.organizationId));
      const [project] = await tx.select({ id: projects.id, trashedAt: projects.trashedAt })
        .from(projects).where(projectOwnership).limit(1).for("update");
      if (!project || project.trashedAt) throw new ProjectAttachmentNotFoundError();

      const chatOwnership = ctx.organizationId === null
        ? and(eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId), isNull(projectChats.organizationId))
        : and(eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId), eq(projectChats.organizationId, ctx.organizationId));
      const [chat] = await tx.select({ scope: projectChats.scope, projectId: projectChats.projectId, trashedAt: projectChats.trashedAt })
        .from(projectChats).where(chatOwnership).limit(1).for("update");
      if (!chat || chat.scope !== "project" || chat.projectId !== projectId || chat.trashedAt) {
        throw new ProjectAttachmentNotFoundError();
      }

      // Locking this Project row before reading the total serializes parallel
      // uploads across processes, so they cannot both spend the same quota.
      await assertProjectQuota(ctx, projectId, input.bytes.byteLength, tx);
      await createProjectResourceInTransaction(tx, ctx, {
        projectId,
        kind: PROJECT_ATTACHMENT_RESOURCE_KIND,
        label: reference.fileName,
        resourceRef: reference.sourceRef,
        contextMode: "on_demand",
        metadata: {
          attachmentId: reference.id,
          chatId,
          kind: reference.kind,
          mimeType: reference.mimeType,
          sha256: reference.sha256,
          byteLength: reference.byteLength,
          storageVersion: 1,
        },
      });
    });
  } catch (error) {
    await deleteProjectAttachmentBlob(ctx.userId, projectId, reference.id).catch(() => undefined);
    throw error;
  }
  return reference;
}


/** Quick attachments belong to the exact regular Chat. No Project or second resource catalogue is created. */
export async function uploadQuickChatAttachment(
  ctx: TenantContext,
  chatId: number,
  input: { bytes: Buffer; originalName: string },
): Promise<ConversationAttachmentRef> {
  const chat = await getProjectChat(ctx, chatId).catch((error) => {
    if (error instanceof ProjectChatAccessDeniedError) throw new ProjectAttachmentNotFoundError();
    throw error;
  });
  if (chat.scope !== "quick" || chat.projectId !== null || chat.status !== "active") throw new ProjectAttachmentNotFoundError();
  const reference = buildAttachmentReference(input, "quick-attachment");
  await writeQuickChatAttachmentBlob(ctx.userId, chatId, reference.id, input.bytes);
  try {
    await getDb().transaction(async (tx) => {
      const chatOwner = ctx.organizationId === null
        ? and(eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId), isNull(projectChats.organizationId))
        : and(eq(projectChats.id, chatId), eq(projectChats.ownerUserId, ctx.userId), eq(projectChats.organizationId, ctx.organizationId));
      const [locked] = await tx.select({
        scope: projectChats.scope, projectId: projectChats.projectId, status: projectChats.status,
        trashedAt: projectChats.trashedAt, attachmentManifest: projectChats.attachmentManifest,
      }).from(projectChats).where(chatOwner).limit(1).for("update");
      if (!locked || locked.scope !== "quick" || locked.projectId !== null || locked.status !== "active" || locked.trashedAt) throw new ProjectAttachmentNotFoundError();
      const manifest = conversationAttachmentRefSchema.array().safeParse(locked.attachmentManifest);
      if (!manifest.success) throw new ProjectAttachmentNotFoundError();
      if (manifest.data.length >= 250) throw new ProjectAttachmentLimitError("A Quick Chat can retain at most 250 attachments.");
      const usedBytes = manifest.data.reduce((sum, entry) => sum + entry.byteLength, 0);
      if (usedBytes + reference.byteLength > PROJECT_ATTACHMENT_MAX_PROJECT_BYTES) {
        throw new ProjectAttachmentLimitError("This Quick Chat has reached its 100 MiB file limit. Remove an older file or choose a smaller one.");
      }
      await tx.update(projectChats).set({ attachmentManifest: [...manifest.data, reference] }).where(chatOwner);
    });
  } catch (error) {
    await deleteQuickChatAttachmentBlob(ctx.userId, chatId, reference.id).catch(() => undefined);
    throw error;
  }
  return reference;
}

export async function loadQuickChatAttachment(
  ctx: TenantContext, chatId: number, attachmentId: string,
): Promise<{ reference: ConversationAttachmentRef; bytes: Buffer }> {
  const chat = await getProjectChat(ctx, chatId).catch((error) => {
    if (error instanceof ProjectChatAccessDeniedError) throw new ProjectAttachmentNotFoundError();
    throw error;
  });
  // The original chat's attachment ownership survives an explicit move into a Project.
  const manifest = conversationAttachmentRefSchema.array().safeParse(chat.attachmentManifest);
  if (!manifest.success) throw new ProjectAttachmentNotFoundError();
  const reference = manifest.data.find((item) => item.id === attachmentId && item.sourceRef === "quick-attachment:" + item.id);
  if (!reference) throw new ProjectAttachmentNotFoundError();
  return { reference, bytes: await readQuickChatAttachmentBlob(ctx.userId, chatId, reference.id) };
}

export async function resolveQuickChatConversationAttachments(
  ctx: TenantContext, chatId: number, requested: readonly ConversationAttachmentRef[], includeContents: boolean,
): Promise<ResolvedConversationAttachment[]> {
  if (requested.length > PROJECT_ATTACHMENT_MAX_PER_MESSAGE) throw new ProjectAttachmentLimitError("A message can include at most five attachments.");
  const chat = await getProjectChat(ctx, chatId).catch((error) => {
    if (error instanceof ProjectChatAccessDeniedError) throw new ProjectAttachmentNotFoundError();
    throw error;
  });
  const manifest = conversationAttachmentRefSchema.array().safeParse(chat.attachmentManifest);
  if (!manifest.success) throw new ProjectAttachmentNotFoundError();
  const output: ResolvedConversationAttachment[] = [];
  const used = new Set<string>();
  let imageBytes = 0;
  for (const supplied of requested) {
    if (used.has(supplied.id)) throw new ProjectAttachmentNotFoundError();
    used.add(supplied.id);
    const stored = manifest.data.find((item) => item.id === supplied.id && item.sourceRef === "quick-attachment:" + item.id);
    if (!stored) throw new ProjectAttachmentNotFoundError();
    assertMatchingReference(supplied, stored);
    let result: ResolvedConversationAttachment = { reference: stored };
    if (includeContents) {
      const bytes = await readQuickChatAttachmentBlob(ctx.userId, chatId, stored.id);
      const isolated = sandboxIsolationMode() === "strict" && attachmentUsesIsolatedDocumentParser(stored.fileName);
      const resolved = isolated
        ? await (async () => {
            const sandbox = resolveSandboxRuntimeProfile();
            return resolveConversationAttachmentContentIsolated(stored, bytes, {
              backend: sandbox.backend!, sandboxPythonPath: sandbox.tools.python!,
            });
          })()
        : await resolveConversationAttachmentContent(stored, bytes);
      result = resolved; // shared parser returns the same validated canonical reference
      if (resolved.imageBase64) imageBytes += bytes.byteLength;
    }
    output.push(result);
  }
  if (imageBytes > PROJECT_ATTACHMENT_MAX_TOTAL_IMAGE_BYTES) throw new ProjectAttachmentLimitError("Images in one AI request must total 12 MiB or less.");
  return output;
}

/** After a permanently deleted Chat is inaccessible, remove the retained private blobs. */
export async function cleanupQuickChatAttachmentBlobs(ctx: TenantContext, chatId: number, manifest: unknown): Promise<void> {
  const parsed = conversationAttachmentRefSchema.array().safeParse(manifest);
  if (!parsed.success) return;
  for (const item of parsed.data) {
    if (item.sourceRef !== "quick-attachment:" + item.id) continue;
    await deleteQuickChatAttachmentBlob(ctx.userId, chatId, item.id);
  }
}

export async function findProjectAttachmentResource(
  ctx: TenantContext,
  projectId: number,
  attachmentId: string,
  resources?: readonly ProjectResource[],
): Promise<{ resource: ProjectResource; reference: ConversationAttachmentRef }> {
  const projectResourcesList = resources ?? await listProjectResources(ctx, projectId);
  const resource = projectResourcesList.find((candidate) => attachmentIdFromResource(candidate) === attachmentId);
  const reference = resource ? referenceFromResource(resource) : null;
  if (!resource || !reference || resource.projectId !== projectId) throw new ProjectAttachmentNotFoundError();
  return { resource, reference };
}

export async function loadProjectAttachment(
  ctx: TenantContext,
  projectId: number,
  attachmentId: string,
): Promise<{ resource: ProjectResource; reference: ConversationAttachmentRef; bytes: Buffer }> {
  const { resource, reference } = await findProjectAttachmentResource(ctx, projectId, attachmentId);
  const bytes = await readProjectAttachmentBlob(ctx.userId, projectId, reference.id);
  return { resource, reference, bytes };
}

export async function resolveProjectConversationAttachments(
  ctx: TenantContext,
  projectId: number,
  resources: readonly ProjectResource[],
  requested: readonly ConversationAttachmentRef[],
  includeContents: boolean,
): Promise<ResolvedConversationAttachment[]> {
  if (requested.length > PROJECT_ATTACHMENT_MAX_PER_MESSAGE) {
    throw new ProjectAttachmentLimitError(`A message can include up to ${PROJECT_ATTACHMENT_MAX_PER_MESSAGE} attachments.`);
  }
  const seen = new Set<string>();
  const output: ResolvedConversationAttachment[] = [];
  let totalImageBytes = 0;
  for (const supplied of requested) {
    if (seen.has(supplied.id)) throw new Error("A Project attachment may only be added once per message.");
    seen.add(supplied.id);
    const { reference } = await findProjectAttachmentResource(ctx, projectId, supplied.id, resources);
    assertMatchingReference(supplied, reference);
    const resource = resources.find((candidate) => attachmentIdFromResource(candidate) === supplied.id);
    if (resource?.contextMode === "excluded") throw new ProjectAttachmentContextExcludedError();
    let imageBase64: string | undefined;
    let textContent: string | undefined;
    let textTruncation: ResolvedConversationAttachment["textTruncation"];
    let documentStructure: ResolvedConversationAttachment["documentStructure"];
    if (includeContents) {
      const bytes = await readProjectAttachmentBlob(ctx.userId, projectId, reference.id);
      const strictDoclingDocument = sandboxIsolationMode() === "strict"
        && attachmentUsesIsolatedDocumentParser(reference.fileName);
      const resolved = strictDoclingDocument
        ? await (async () => {
            const sandbox = resolveSandboxRuntimeProfile();
            return resolveConversationAttachmentContentIsolated(reference, bytes, {
              backend: sandbox.backend!,
              sandboxPythonPath: sandbox.tools.python!,
            });
          })()
        : await resolveConversationAttachmentContent(reference, bytes);
      imageBase64 = resolved.imageBase64;
      textContent = resolved.textContent;
      textTruncation = resolved.textTruncation;
      documentStructure = resolved.documentStructure;
      if (imageBase64) totalImageBytes += bytes.byteLength;
    }
    output.push({
      reference,
      ...(textContent ? { textContent } : {}),
      ...(textTruncation ? { textTruncation } : {}),
      ...(documentStructure ? { documentStructure } : {}),
      ...(imageBase64 ? { imageBase64 } : {}),
    });
  }
  if (totalImageBytes > PROJECT_ATTACHMENT_MAX_TOTAL_IMAGE_BYTES) {
    throw new ProjectAttachmentLimitError("Images in one AI request must total 12 MiB or less. Remove an image and try again.");
  }
  return output;
}

export function publicAttachmentRefsFromResources(resources: readonly ProjectResource[]): ConversationAttachmentRef[] {
  return resources
    .filter((resource) => resource.kind === PROJECT_ATTACHMENT_RESOURCE_KIND)
    .map(referenceFromResource)
    .filter((reference): reference is ConversationAttachmentRef => reference !== null);
}

export const PROJECT_ATTACHMENT_SUPPORTED_EXTENSIONS = Object.freeze(Object.keys(MIME_BY_EXTENSION));
