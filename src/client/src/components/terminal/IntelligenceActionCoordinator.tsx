import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAudience } from "@/lib/audience";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { getTerminalCapability, isCapabilityVisible } from "@/lib/terminalCatalog";
import { openTerminalInspector } from "@/lib/terminalInspector";
import {
  createIntelligenceObject,
  loadIntelligenceObjects,
  saveIntelligenceObjects,
  subscribeIntelligenceObjects,
  upsertIntelligenceObject,
  type IntelligenceObject,
} from "@/lib/terminalIntelligenceObjects";
import { subscribeIntelligenceObjectActions, type IntelligenceObjectAction } from "@/lib/terminalObjectActions";
import {
  addDecisionEvidence,
  createDecisionObject,
  loadDecisionObjects,
  saveDecisionObjects,
  upsertDecisionObject,
} from "@/lib/terminalDecisionObjects";
import {
  cloneScenarioBranch,
  createScenario,
  getActiveScenario,
  loadScenarios,
  saveScenarios,
  setActiveScenario,
  updateScenarioAssumption,
} from "@/lib/terminalScenarioUniverse";
import { loadResearchTray, pinResearchContext, saveResearchTray } from "@/lib/terminalResearchTray";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
}

function evidenceRole(object: IntelligenceObject): "support" | "contradiction" | "context" {
  if (object.tags.includes("contradiction") || object.tags.includes("bear") || object.status === "critical") return "contradiction";
  if (object.tags.includes("support") || object.tags.includes("bull")) return "support";
  return "context";
}

export default function IntelligenceActionCoordinator({ onOpen }: Props) {
  const isInternal = useAudience() === "internal";
  const [objects, setObjects] = useState<IntelligenceObject[]>(() => loadIntelligenceObjects());
  const objectsRef = useRef(objects);
  const [message, setMessage] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => subscribeIntelligenceObjects((next) => {
    objectsRef.current = next;
    setObjects(next);
  }), []);

  useEffect(() => {
    const flash = (text: string) => {
      setMessage(text);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setMessage(""), 1800);
    };

    const safeOpen = (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => {
      const capability = getTerminalCapability(view);
      if (!isCapabilityVisible(capability, isInternal)) {
        flash(`${capability.label.toUpperCase()} IS NOT AVAILABLE IN THIS BUILD`);
        return false;
      }
      onOpen(view, mode, symbol);
      return true;
    };

    const execute = (action: IntelligenceObjectAction) => {
      const object = objectsRef.current.find((item) => item.id === action.objectId);
      if (!object) { flash("OBJECT NO LONGER AVAILABLE"); return; }

      if (action.kind === "inspect") {
        const inspectorView = object.view && isCapabilityVisible(getTerminalCapability(object.view), isInternal) ? object.view : "entity";
        openTerminalInspector({
          view: inspectorView,
          symbol: object.symbol,
          label: object.label,
          value: object.value?.raw,
          metricKey: typeof object.metadata.metricKey === "string" ? object.metadata.metricKey : undefined,
          sourceHint: object.source?.label,
        });
        return;
      }
      if (action.kind === "open" || action.kind === "send-to") {
        const target = action.view ?? object.view;
        if (target) safeOpen(target, action.kind === "send-to" ? "tab" : "current", object.symbol);
        return;
      }
      if (action.kind === "compare") { openTerminalUxSurface("innovation-studio"); flash("OPENED COMPARE STUDIO"); return; }
      if (action.kind === "graph") { openTerminalUxSurface("graph-explorer"); flash("OPENED CROSS-DOMAIN GRAPH"); return; }
      if (action.kind === "pin") {
        if (!object.view || !isCapabilityVisible(getTerminalCapability(object.view), isInternal)) { flash("PIN REQUIRES A VISIBLE ANALYTICAL VIEW"); return; }
        const next = pinResearchContext(loadResearchTray(), {
          view: object.view,
          symbol: object.symbol,
          kind: object.kind === "evidence" ? "evidence" : object.kind === "metric" || object.kind === "model" ? "output" : "context",
          title: object.label,
          description: object.description,
          tags: object.tags,
        });
        saveResearchTray(next);
        flash("PINNED TO RESEARCH CONTINUITY");
        return;
      }
      if (action.kind === "scenario") {
        const active = getActiveScenario();
        let branch = active
          ? cloneScenarioBranch(active, { name: `${active.name} · ${object.label}`.slice(0, 72), kind: "custom" })
          : createScenario({ name: object.label.slice(0, 72), kind: "custom", scope: object.symbol ? "entity" : "global", symbol: object.symbol, probability: 0, assumptions: [] });
        branch = updateScenarioAssumption(branch, {
          key: `object:${object.id}`,
          label: object.label,
          value: object.value?.raw ?? object.label,
          unit: object.value?.unit,
          source: object.source?.label,
        });
        const next = [branch, ...loadScenarios()];
        saveScenarios(next);
        setActiveScenario(branch.id);
        openTerminalUxSurface("scenario-workbench");
        flash("BRANCHED SCENARIO FROM OBJECT");
        return;
      }
      if (action.kind === "decision") {
        const decisions = loadDecisionObjects();
        const existing = decisions.find((decision) => decision.status !== "closed" && (!object.symbol || decision.symbol === object.symbol));
        const base = existing ?? createDecisionObject({
          title: `${object.symbol ? `${object.symbol} · ` : ""}Decision`,
          symbol: object.symbol,
          direction: "monitor",
          status: "draft",
          thesis: `Decision thesis anchored to ${object.label}`,
          confidence: 50,
          scenarioId: getActiveScenario()?.id,
        });
        const updated = addDecisionEvidence(base, { objectId: object.id, role: evidenceRole(object), weight: 1 });
        saveDecisionObjects(upsertDecisionObject(decisions, updated));
        openTerminalUxSurface("decision-center");
        flash("ATTACHED OBJECT TO DECISION; REVIEW ITS EVIDENCE ROLE EXPLICITLY");
        return;
      }
      if (action.kind === "monitor") {
        const monitor = createIntelligenceObject({
          kind: "monitor",
          label: `Monitor · ${object.label}`,
          description: `Review when ${object.label} changes materially.`,
          symbol: object.symbol,
          view: object.view,
          status: "live",
          tags: [...object.tags, "monitor"],
          metadata: { sourceObjectId: object.id, createdFrom: "object-action" },
          relations: [{ targetId: object.id, kind: "monitors" }],
        });
        const next = upsertIntelligenceObject(objectsRef.current, monitor, (item) => `${item.kind}|${String(item.metadata.sourceObjectId ?? item.label)}`);
        objectsRef.current = next;
        setObjects(next);
        saveIntelligenceObjects(next);
        flash("MONITOR OBJECT CREATED");
      }
    };

    return subscribeIntelligenceObjectActions(execute);
  }, [onOpen]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  if (!message) return null;
  return <div className="fixed bottom-24 left-1/2 z-[98] flex -translate-x-1/2 items-center gap-2 border border-[hsl(38,100%,50%)/28%] bg-[#0a0a0a]/96 px-3 py-2 text-[8px] font-bold tracking-wider text-[hsl(38,100%,60%)] shadow-2xl"><CheckCircle2 className="h-3 w-3" />{message}</div>;
}
