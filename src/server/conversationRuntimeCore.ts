import crypto from "node:crypto";
import type { ConversationSourceScope } from "@shared/conversationRuntime";

export function nowIso(): string {
  return new Date().toISOString();
}

export function eventBase(requestId: string): { requestId: string; at: string } {
  return { requestId, at: nowIso() };
}

export function hashPayload(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function abortError(): Error {
  const error = new Error("Conversation execution was cancelled.");
  error.name = "AbortError";
  return error;
}

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export { normalizedMentionToken, userMentionTokens } from "@shared/mentionContext";

export function sourceScopeAllowsProjectData(scope: ConversationSourceScope): boolean {
  return scope === "auto" || scope === "my_data";
}

export function sourceScopeAllowsFiles(scope: ConversationSourceScope): boolean {
  return scope === "auto" || scope === "my_data" || scope === "files";
}

export function sourceScopeAllowsExternalData(scope: ConversationSourceScope): boolean {
  return scope === "auto" || scope === "web";
}
