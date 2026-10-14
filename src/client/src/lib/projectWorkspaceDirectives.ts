import type { SafeWorkspaceAction } from "@shared/projectContracts";
import type { ViewMode } from "./terminalTypes";

type WorkspaceLayoutPreset = Extract<SafeWorkspaceAction, { type: "propose-layout" }>["preset"];

export interface ParsedWorkspaceDirectives {
  visibleText: string;
  actions: SafeWorkspaceAction[];
}

const OPEN_RE = /<<WORKSPACE_OPEN:\s*([a-z0-9_-]+)(?:\s*,\s*([^>\n]+))?\s*>>/gi;
const NAVIGATE_RE = /<<NAVIGATE:\s*([^,>\n]+)(?:\s*,\s*([^>\n]+))?\s*>>/gi;
const LAYOUT_RE = /<<WORKSPACE_LAYOUT:\s*(conversation-artifact|research|modeling|quant|portfolio)\s*>>/gi;

function cleanSymbol(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[^\s\x00-\x1F]{1,32}$/.test(normalized) ? normalized : undefined;
}

export function parseProjectWorkspaceDirectives(text: string): ParsedWorkspaceDirectives {
  const actions: SafeWorkspaceAction[] = [];
  let visibleText = text;

  visibleText = visibleText.replace(OPEN_RE, (_match, rawView: string, rawSymbol?: string) => {
    const view = rawView.trim().toLowerCase();
    if (view) {
      actions.push({
        type: "open-panel",
        view,
        symbol: cleanSymbol(rawSymbol),
        placement: "secondary",
        reason: "Suggested by LiOS from the active conversation.",
      });
    }
    return "";
  });

  visibleText = visibleText.replace(NAVIGATE_RE, (_match, first: string, second?: string) => {
    if (second) {
      const view = second.trim().toLowerCase();
      if (view) {
        actions.push({
          type: "open-panel",
          view,
          symbol: cleanSymbol(first),
          placement: "secondary",
          reason: "Suggested by LiOS from the active conversation.",
        });
      }
    } else {
      const maybeView = first.trim().toLowerCase();
      if (maybeView) {
        actions.push({
          type: "open-panel",
          view: maybeView,
          placement: "secondary",
          reason: "Suggested by LiOS from the active conversation.",
        });
      }
    }
    return "";
  });

  visibleText = visibleText.replace(LAYOUT_RE, (_match, preset: WorkspaceLayoutPreset) => {
    actions.push({
      type: "propose-layout",
      preset,
      reason: "LiOS suggests a workspace layout for the current task.",
    });
    return "";
  });

  return {
    visibleText: visibleText.replace(/\n{3,}/g, "\n\n").trim(),
    actions,
  };
}

export function isProjectWorkspaceView(value: string): value is ViewMode {
  // Kept intentionally structural here. The caller must additionally verify
  // the view against the live LiOS feature registry/audience before opening it.
  return /^[a-z][a-z0-9_-]{0,119}$/.test(value);
}
