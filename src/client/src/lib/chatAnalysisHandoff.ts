import { matchAnalysisWorkbenchView } from "@shared/askLiosRouter";
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { chatTerminalCapabilities, type ChatTerminalContext } from "./chatTerminalContext";
import type { WorkspaceAudience } from "./featureRegistry";
import { getExperienceViewLabel } from "./terminalExperience";
import type { ViewMode } from "./terminalTypes";

/** Below this window width the tool does not open beside Chat; the card offers it instead. */
export const CHAT_ANALYSIS_SIDECAR_MIN_WIDTH = 1100;

export type ChatAnalysisCardKind = "chart" | "table" | "news" | "portfolio" | "model";

/** Navigation-only suggestion; the opened tool computes its own governed numbers. */
export interface ChatAnalysisCard {
  view: ViewMode;
  symbol: string | null;
  title: string;
  kind: ChatAnalysisCardKind;
}

const KIND_BY_VIEW: Partial<Record<ViewMode, ChatAnalysisCardKind>> = {
  chart: "chart", quote: "chart", heatmap: "chart", yieldcurve: "chart", marketbreadth: "chart", sectorrotation: "chart",
  news: "news", filingintel: "news", earnings: "news", sentiment: "news",
  portfolio: "portfolio", optimizer: "portfolio", advancedrisk: "portfolio", portfoliostress: "portfolio", portfolioattribution: "portfolio",
  financialstatements: "table", companyfundamentals: "table", peercomp: "table", dividends: "table", screener: "table",
};

/** Build the turn's Workbench suggestion from its runtime plan and resolved symbols. */
export function buildChatAnalysisCard(input: {
  message: string;
  events: readonly ConversationRuntimeEvent[];
  audience: WorkspaceAudience;
}): ChatAnalysisCard | null {
  const plan = [...input.events].reverse().find((event) => event.type === "plan");
  const done = [...input.events].reverse().find((event) => event.type === "done");
  const capabilities = plan?.type === "plan" ? plan.plan.capabilities : [];
  const resolvedSymbols = [
    ...(done?.type === "done" ? done.workingContext?.entities.map((entity) => entity.symbol) ?? [] : []),
    ...capabilities.map((capability) => capability.symbol?.toUpperCase()).filter((symbol): symbol is string => Boolean(symbol)),
  ];
  const tools = chatTerminalCapabilities(input.audience);
  const match = matchAnalysisWorkbenchView({
    message: input.message,
    capabilities,
    resolvedSymbols,
    isAvailable: (view) => tools.some((tool) => tool.view === view),
  });
  if (!match) return null;
  const tool = tools.find((item) => item.view === match.view);
  if (!tool) return null;
  const symbol = tool.symbolAware ? match.symbol : null;
  return { view: tool.view, symbol, title: getExperienceViewLabel(tool.view), kind: KIND_BY_VIEW[tool.view] ?? "model" };
}

/**
 * Open beside Chat only on a wide window, with no unsaved Artifact edits, and when the turn
 * did not already produce its own Artifact or workspace change; otherwise show the card.
 */
export function decideChatAnalysisPresentation(input: {
  card: ChatAnalysisCard;
  viewportWidth: number;
  artifactDraftDirty: boolean;
  turnProducedArtifactOrDirective: boolean;
  showing: ChatTerminalContext | null;
}): "already-open" | "sidecar" | "card" {
  if (input.showing?.view === input.card.view && (input.showing.symbol ?? null) === input.card.symbol) return "already-open";
  if (input.viewportWidth < CHAT_ANALYSIS_SIDECAR_MIN_WIDTH || input.artifactDraftDirty || input.turnProducedArtifactOrDirective) return "card";
  return "sidecar";
}
