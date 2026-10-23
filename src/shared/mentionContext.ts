import type { ConversationSourceScope } from "./sourceScope";

/** Same spelling for the Chat editor and the server's on-demand resource resolver. */
export function normalizedMentionToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_.-]/g, "");
}

export function userMentionTokens(message: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of message.matchAll(/(?:^|\\s)@([a-zA-Z0-9_.-]+)/g)) {
    const token = normalizedMentionToken(match[1]);
    if (token) tokens.add(token);
  }
  return tokens;
}

export interface NamedMentionResource {
  label: string;
  contextMode: "project" | "on_demand" | "excluded";
}

export function ambiguousMentionTokens(resources: readonly NamedMentionResource[], message: string): string[] {
  const mentioned = userMentionTokens(message);
  if (!mentioned.size) return [];
  const counts = new Map<string, number>();
  for (const resource of resources) {
    if (resource.contextMode === "excluded") continue;
    const token = normalizedMentionToken(resource.label);
    if (token && mentioned.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([token]) => token).sort();
}

export interface ProjectMentionResource extends NamedMentionResource {
  id: string;
  projectId: number;
  status: string;
  trashedAt: string | null;
}

export function latestMentionQuery(input: string): string | null {
  const match = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(input);
  return match ? match[1].toLowerCase() : null;
}

/** Suggestions are only visible within the selected Project and allowed source scope. */
export function eligibleProjectMentions<T extends ProjectMentionResource>(
  resources: readonly T[],
  input: string,
  projectId: number | null,
  chatMode: "project" | "quick" | "temporary",
  sourceScope: ConversationSourceScope,
  allowResourceReferences: boolean,
  limit = 6,
): T[] {
  if (chatMode !== "project" || projectId === null || !allowResourceReferences
    || (sourceScope !== "auto" && sourceScope !== "my_data")) return [];
  const query = latestMentionQuery(input);
  if (query === null) return [];
  const owned = resources.filter(resource => resource.projectId === projectId
    && resource.status === "active" && !resource.trashedAt && resource.contextMode !== "excluded"
    && Boolean(normalizedMentionToken(resource.label)));
  const counts = new Map<string, number>();
  for (const resource of owned) {
    const token = normalizedMentionToken(resource.label);
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return owned
    .filter(resource => {
      const token = normalizedMentionToken(resource.label);
      return counts.get(token) === 1 && (token.includes(query) || resource.label.toLowerCase().includes(query));
    })
    .slice(0, Math.max(0, limit));
}

export function stageResourceMention(current: string, label: string): string {
  const token = normalizedMentionToken(label);
  if (!token || latestMentionQuery(current) === null) return current;
  return current.replace(/(^|\s)@[a-zA-Z0-9_.-]*$/, (_, prefix: string) => `${prefix}@${token} `);
}
