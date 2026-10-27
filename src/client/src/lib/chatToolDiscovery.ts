import { chatTerminalCapabilities } from "./chatTerminalContext";
import { PRIMARY_WORKSPACES, type WorkspaceAudience, type WorkspaceKey } from "./featureRegistry";

/** Read-only grouping over the existing, audience-filtered terminal registry. */
export type ChatToolEntry = ReturnType<typeof chatTerminalCapabilities>[number];

export interface ChatToolGroup {
  key: WorkspaceKey;
  label: string;
  tools: ChatToolEntry[];
}

function matchesToolSearch(tool: ChatToolEntry, words: readonly string[]): boolean {
  const searchable = [
    tool.label, tool.view, tool.description, tool.domain, tool.workspace,
    ...tool.keywords,
  ].join(" ").toLocaleLowerCase();
  return words.every(word => searchable.includes(word));
}

/**
 * Discover registered analysis views inside Chat. This never launches a tool,
 * grants permissions, changes source scopes, or claims a provider is connected.
 * Existing audience checks and terminal navigation remain authoritative.
 */
export function discoverChatTools(audience: WorkspaceAudience, query = ""): ChatToolGroup[] {
  const words = query.trim().slice(0, 120).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const permitted = chatTerminalCapabilities(audience).filter(item => matchesToolSearch(item, words));
  return PRIMARY_WORKSPACES.flatMap(workspace => {
    const tools = permitted.filter(item => item.workspace === workspace.key);
    return tools.length ? [{ key: workspace.key, label: workspace.label, tools }] : [];
  });
}

export function countDiscoveredChatTools(groups: readonly ChatToolGroup[]): number {
  return groups.reduce((total, group) => total + group.tools.length, 0);
}
