import { useEffect } from "react";
import { openTerminalInspector } from "@/lib/terminalInspector";
import type { ViewMode } from "@/lib/terminalTypes";

function compact(text: string | null | undefined, max = 100): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function rowLabel(element: HTMLElement): string | undefined {
  const row = element.closest("tr");
  if (!row) return undefined;
  const cells = Array.from(row.querySelectorAll<HTMLElement>("th,td"));
  const before = cells.slice(0, Math.max(0, cells.indexOf(element.closest("td,th") as HTMLElement)));
  return compact(before.map((cell) => cell.innerText).find(Boolean));
}

export default function UniversalInspectorBridge() {
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!event.altKey || event.button !== 0) return;
      const rawTarget = event.target;
      if (!(rawTarget instanceof HTMLElement)) return;
      const root = rawTarget.closest<HTMLElement>(".terminal-root");
      if (!root) return;
      const target = rawTarget.closest<HTMLElement>("[data-intelligence-label],[data-analytical-role],td,th,[data-terminal-object]");
      if (!target) return;
      const pane = target.closest<HTMLElement>("[data-testid^='workspace-pane-']");
      const view = pane?.dataset.view as ViewMode | undefined;
      if (!view) return;
      event.preventDefault();
      event.stopPropagation();
      const label = compact(target.dataset.intelligenceLabel) ?? rowLabel(target) ?? compact(target.getAttribute("aria-label")) ?? compact(target.getAttribute("title")) ?? "VISIBLE ANALYTICAL VALUE";
      const dataValue = target.dataset.intelligenceValue;
      const visibleValue = compact(dataValue ?? target.innerText, 120);
      const metricKey = compact(target.dataset.scenarioKey ?? target.dataset.metricKey, 80);
      openTerminalInspector({
        view,
        symbol: pane?.dataset.symbol,
        label,
        value: dataValue === undefined ? visibleValue : Number.isFinite(Number(dataValue)) ? Number(dataValue) : dataValue,
        metricKey,
        sourceHint: target.dataset.sourceHint ?? "Visible UI value; source/formula are shown only when explicitly published by this panel.",
      });
    };
    window.addEventListener("click", handler, { capture: true });
    return () => window.removeEventListener("click", handler, { capture: true });
  }, []);
  return null;
}
