/**
 * LiOS address contract (GM-08c): the one URL grammar for pointing at a Project or a conversation, used in the
 * app's location hash today and by paired devices and deep links later. Adapted in intent from OpenClaw
 * `packages/session-url-contract` (MIT, commit c074824a27c96d3983043f9eeb33823cd1772d8c): a strict, round-trippable
 * grammar with one parser, instead of each screen inventing its own. OpenClaw's session-key and slug rules do not
 * apply; LiOS addresses are numeric ids owned by the Project and Conversation stores.
 *
 *   #/p/12          Project 12
 *   #/p/12/c/34     chat 34 inside Project 12
 *   #/c/34          chat 34 that is not in a Project (Quick chat)
 */

export type LiosAddress =
  | { kind: "project"; projectId: number }
  | { kind: "chat"; projectId: number | null; chatId: number };

const ID = "([1-9][0-9]{0,14})";
const PROJECT = new RegExp(`^/p/${ID}/?$`);
const PROJECT_CHAT = new RegExp(`^/p/${ID}/c/${ID}/?$`);
const QUICK_CHAT = new RegExp(`^/c/${ID}/?$`);

/** Accepts a location hash (`#/p/1`) or a bare path (`/p/1`). Anything else, including partial matches, is null. */
export function parseLiosAddress(input: string): LiosAddress | null {
  const path = input.startsWith("#") ? input.slice(1) : input;
  const projectChat = PROJECT_CHAT.exec(path);
  if (projectChat) return { kind: "chat", projectId: Number(projectChat[1]), chatId: Number(projectChat[2]) };
  const project = PROJECT.exec(path);
  if (project) return { kind: "project", projectId: Number(project[1]) };
  const quick = QUICK_CHAT.exec(path);
  if (quick) return { kind: "chat", projectId: null, chatId: Number(quick[1]) };
  return null;
}

export function formatLiosAddress(address: LiosAddress): string {
  if (address.kind === "project") return `#/p/${address.projectId}`;
  return address.projectId === null ? `#/c/${address.chatId}` : `#/p/${address.projectId}/c/${address.chatId}`;
}

/** The address of the current selection, or null when nothing is selected. */
export function addressForSelection(selection: { projectId: number | null; chatId: number | null }): LiosAddress | null {
  if (selection.chatId) return { kind: "chat", projectId: selection.projectId, chatId: selection.chatId };
  return selection.projectId ? { kind: "project", projectId: selection.projectId } : null;
}
