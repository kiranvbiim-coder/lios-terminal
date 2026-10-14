import { blobStorage } from "./storageRuntime";
import { StorageIntegrityError, StorageNotFoundError, StorageUnavailableError, type StorageProvider } from "./storageProvider";

export const PROJECT_ATTACHMENT_RESOURCE_KIND = "chat_attachment";
export const PROJECT_ATTACHMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const PROJECT_ATTACHMENT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const PROJECT_ATTACHMENT_MAX_PER_MESSAGE = 5;
export const PROJECT_ATTACHMENT_MAX_PROJECT_BYTES = 100 * 1024 * 1024;
export const PROJECT_ATTACHMENT_MAX_TEXT_CHARS = 20_000;
export const PROJECT_ATTACHMENT_MAX_PDF_PAGES = 20;
export const PROJECT_ATTACHMENT_MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProjectAttachmentStorageUnavailableError extends Error {
  constructor() {
    super("Project attachment storage is unavailable. Check the persistent storage volume and available disk space.");
    this.name = "ProjectAttachmentStorageUnavailableError";
  }
}

function attachmentKey(userId: number, projectId: number, attachmentId: string): string {
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("Invalid attachment owner or Project id.");
  }
  if (!UUID_RE.test(attachmentId)) throw new Error("Invalid Project attachment id.");
  return `${userId}/${projectId}/${attachmentId}.blob`;
}

/** Attachments live in the user's StorageProvider (local disk by default, optionally encrypted or an S3-compatible bucket). */
async function attachmentStorage(): Promise<StorageProvider> {
  try {
    return await blobStorage("project-attachments");
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw new ProjectAttachmentStorageUnavailableError();
    throw error;
  }
}

export async function writeProjectAttachmentBlob(
  userId: number,
  projectId: number,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength <= 0 || bytes.byteLength > PROJECT_ATTACHMENT_MAX_FILE_BYTES) {
    throw new Error("Project attachment exceeds the supported file-size limit.");
  }
  const key = attachmentKey(userId, projectId, attachmentId);
  try {
    await (await attachmentStorage()).put(key, bytes);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw new ProjectAttachmentStorageUnavailableError();
    throw error;
  }
}

export async function readProjectAttachmentBlob(
  userId: number,
  projectId: number,
  attachmentId: string,
): Promise<Buffer> {
  const key = attachmentKey(userId, projectId, attachmentId);
  try {
    return await (await attachmentStorage()).get(key, { maxBytes: PROJECT_ATTACHMENT_MAX_FILE_BYTES });
  } catch (error) {
    if (error instanceof StorageUnavailableError || error instanceof StorageNotFoundError) throw new ProjectAttachmentStorageUnavailableError();
    if (error instanceof StorageIntegrityError) throw new Error("Stored Project attachment is unavailable or invalid.");
    throw error;
  }
}

export async function deleteProjectAttachmentBlob(
  userId: number,
  projectId: number,
  attachmentId: string,
): Promise<void> {
  await (await attachmentStorage()).delete(attachmentKey(userId, projectId, attachmentId));
}

export async function deleteProjectAttachmentResourceBlob(resource: {
  ownerUserId: number;
  projectId: number;
  kind: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (resource.kind !== PROJECT_ATTACHMENT_RESOURCE_KIND) return;
  const attachmentId = resource.metadata.attachmentId;
  if (typeof attachmentId !== "string" || !UUID_RE.test(attachmentId)) return;
  await deleteProjectAttachmentBlob(resource.ownerUserId, resource.projectId, attachmentId);
}
