import type { ViewMode } from "./terminalTypes";
import { getJourneyForView } from "./terminalToolGraph";
import { loadResearchThread } from "./terminalResearchThread";

export interface StorylineStage {
  label: string;
  views: readonly ViewMode[];
  state: "complete" | "active" | "available" | "unseen";
  visitedViews: ViewMode[];
}

export interface AnalyticalStoryline {
  journeyId: string;
  journeyLabel: string;
  stages: StorylineStage[];
  progress: number;
}

export function buildAnalyticalStoryline(view: ViewMode, symbol?: string): AnalyticalStoryline | null {
  const located = getJourneyForView(view);
  if (!located) return null;
  const symbolKey = (symbol ?? "").trim().toUpperCase();
  const thread = loadResearchThread().filter((item) => !symbolKey || !item.symbol || item.symbol === symbolKey);
  const visited = new Set<ViewMode>(thread.map((item) => item.view));
  const stages = located.journey.stages.map((stage, index) => {
    const visitedViews = stage.views.filter((candidate) => visited.has(candidate));
    const state: StorylineStage["state"] = index === located.stageIndex
      ? "active"
      : visitedViews.length > 0 || index < located.stageIndex
        ? "complete"
        : index === located.stageIndex + 1
          ? "available"
          : "unseen";
    return { label: stage.label, views: stage.views, state, visitedViews: [...visitedViews] };
  });
  const completeWeight = stages.filter((stage) => stage.state === "complete").length + 0.5;
  return {
    journeyId: located.journey.id,
    journeyLabel: located.journey.label,
    stages,
    progress: Math.min(1, completeWeight / Math.max(1, stages.length)),
  };
}
