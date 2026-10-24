import { conversationAttachmentRefSchema, type ConversationAttachmentRef } from "@shared/conversationRuntime";
import { progressPercent } from "./fileAttachmentStaging";

export type UploadStage = { state: "transferring"; percent: number | null } | { state: "verifying"; percent: null };

export function attachmentUploadError(status: number): string {
  if (status === 413) return "The file exceeds the allowed upload or storage limit. Remove it or choose a smaller file.";
  if (status === 400 || status === 415) return "The server rejected this file. Check its format and try another file.";
  if (status === 401) return "Your sign-in expired. Sign in again before retrying the staged file.";
  if (status === 403 || status === 404) return "This Chat or attachment is not accessible. Verify your current account and Chat.";
  if (status === 429) return "Too many upload attempts. Try again later.";
  if (status === 0 || status >= 500) return "Attachment storage or the network is unavailable. The local file remains staged; retry sending when it is available.";
  return "The file could not be saved. It remains staged; check the file and retry.";
}

/** Real multipart upload; only canonical server confirmation resolves a saved reference. */
export function uploadRealChatAttachment(
  projectId: number | null,
  chatId: number,
  file: File,
  onProgress: (stage: UploadStage) => void,
  createRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<ConversationAttachmentRef> {
  const { promise, resolve, reject } = Promise.withResolvers<ConversationAttachmentRef>();
  const xhr = createRequest();
  const endpoint = projectId === null
    ? `/api/quick-chats/${chatId}/attachments`
    : `/api/projects/${projectId}/chats/${chatId}/attachments`;
  xhr.open("POST", endpoint, true);
  xhr.withCredentials = true;
  xhr.timeout = 120_000;
  xhr.upload.onprogress = event => {
    onProgress({ state: "transferring", percent: progressPercent(event.loaded, event.total, event.lengthComputable) });
  };
  xhr.upload.onload = () => onProgress({ state: "verifying", percent: null });
  xhr.onerror = () => reject(new Error(attachmentUploadError(0)));
  xhr.onabort = () => reject(new Error("Upload stopped. The selected file remains staged."));
  xhr.ontimeout = () => reject(new Error("Upload timed out. The local file remains staged; retry when connected."));
  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      reject(new Error(attachmentUploadError(xhr.status)));
      return;
    }
    let value: unknown;
    try { value = JSON.parse(xhr.responseText); }
    catch { reject(new Error("The upload response was unreadable. Check the saved Chat before retrying.")); return; }
    const candidate = value && typeof value === "object" && "attachment" in value ? value.attachment : null;
    const parsed = conversationAttachmentRefSchema.safeParse(candidate);
    if (!parsed.success) {
      reject(new Error("The upload was not confirmed. Check the saved Chat before retrying."));
      return;
    }
    resolve(parsed.data);
  };
  const form = new FormData();
  form.append("file", file, file.name);
  try { xhr.send(form); }
  catch { reject(new Error(attachmentUploadError(0))); }
  return promise;
}
