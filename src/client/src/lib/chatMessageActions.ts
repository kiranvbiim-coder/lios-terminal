import { stripMachineDirectives } from "./chatMarkdown";

export type ChatMessageRole = "assistant" | "user";

/** A message action uses the same visible text boundary as the Chat renderer. */
export function visibleChatMessageText(content: string, role: ChatMessageRole): string {
  if (role === "user") return content;
  return stripMachineDirectives(content).replace(/\u0000/g, "");
}

/**
 * Quotes only a bounded excerpt of a visible answer, preserving the user's unsent draft.
 * This is a composer edit, never a send, replay, tool invocation or permission grant.
 */
export function quoteChatResponse(draft: string, response: string): string {
  const content = visibleChatMessageText(response, "assistant").trim();
  if (!content) return draft;
  const MAX_EXCERPT = 1200;
  const snippet = content.length > MAX_EXCERPT ? `${content.slice(0, MAX_EXCERPT).trimEnd()}…` : content;
  const quote = snippet.split("\n").map(line => `> ${line}`).join("\n");
  const addition = `Follow up on this LiOS response:\n${quote}\n\n`;
  if (draft.includes(addition.trimEnd())) return draft;
  const prefix = draft.trim() ? `${draft.trimEnd()}\n\n` : "";
  return `${prefix}${addition}`;
}

/** Fail closed on clipboard denial. Never report a copy as successful before the write resolves. */
export async function copyChatMessageText(
  writeText: ((text: string) => Promise<void>) | undefined,
  text: string,
): Promise<boolean> {
  if (!text || !writeText) return false;
  try {
    await writeText(text);
    return true;
  } catch {
    return false;
  }
}