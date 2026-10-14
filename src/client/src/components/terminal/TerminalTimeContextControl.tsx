import { useEffect, useState } from "react";
import { Clock3, Layers3, RotateCcw } from "lucide-react";
import type { TerminalLinkedContext } from "@/lib/terminalLinkedContext";
import type { ViewMode } from "@/lib/terminalTypes";
import {
  broadcastActiveTabLinkedContext,
  broadcastActiveTabTimeContext,
  loadTerminalLinkedContextState,
  resolveActiveTabLinkedContext,
  resolveActiveTabTimeContext,
  resolveTabLinkedContext,
  resolveTabTimeContext,
  subscribeTerminalLinkedContext,
  subscribeTerminalTabActivation,
} from "@/lib/terminalLinkedContextStore";
import {
  describeTimeContext, resetToLatest, saveTerminalTimeContext, setAsKnownOn, supportsPointInTime,
  type TerminalTimeContext,
} from "@/lib/terminalTimeTravel";

interface Props {
  view: ViewMode;
  context: TerminalTimeContext;
  onChange: (context: TerminalTimeContext) => void;
}

function ContextTextInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  placeholder: string;
  onCommit: (value: string | null) => void;
}) {
  const commit = (raw: string) => onCommit(raw.trim() || null);
  return (
    <label className="font-terminal text-[7px] tracking-widest text-muted-foreground">
      {label}
      <input
        key={`${label}:${value ?? ""}`}
        defaultValue={value ?? ""}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        placeholder={placeholder}
        className="mt-1 w-full border border-border bg-black px-2 py-2 font-terminal text-[8px] normal-case tracking-normal text-foreground placeholder:text-muted-foreground/45"
      />
    </label>
  );
}

export default function TerminalTimeContextControl({ view, context, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [effectiveContext, setEffectiveContext] = useState<TerminalTimeContext>(() => resolveActiveTabTimeContext(context));
  const [linkedContext, setLinkedContext] = useState<TerminalLinkedContext>(() => resolveActiveTabLinkedContext());
  const pointInTime = supportsPointInTime(view);
  const hasAnalyticalScope = Boolean(linkedContext.scenarioId || linkedContext.portfolioId || linkedContext.benchmarkId);

  useEffect(() => {
    const next = resolveActiveTabTimeContext(context);
    setEffectiveContext(next);
  }, [context]);

  useEffect(() => {
    const applyTime = (next: TerminalTimeContext) => {
      setEffectiveContext(next);
      saveTerminalTimeContext(next);
      onChange(next);
    };

    const unsubscribeActivation = subscribeTerminalTabActivation((tabId) => {
      const state = loadTerminalLinkedContextState();
      setLinkedContext(resolveTabLinkedContext(state, tabId));
      applyTime(resolveTabTimeContext(state, tabId));
    });
    const unsubscribeLinked = subscribeTerminalLinkedContext(() => {
      setLinkedContext(resolveActiveTabLinkedContext());
      applyTime(resolveActiveTabTimeContext());
    });
    return () => {
      unsubscribeActivation();
      unsubscribeLinked();
    };
  }, [onChange]);

  const updateTime = (next: TerminalTimeContext) => {
    const resolved = broadcastActiveTabTimeContext(next);
    setEffectiveContext(resolved);
    saveTerminalTimeContext(resolved);
    onChange(resolved);
  };

  const updateAnalyticalScope = (patch: Pick<TerminalLinkedContext, "scenarioId"> | Pick<TerminalLinkedContext, "portfolioId"> | Pick<TerminalLinkedContext, "benchmarkId">) => {
    setLinkedContext(broadcastActiveTabLinkedContext(patch));
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((value) => !value)} className={`flex items-center gap-1.5 border px-2 py-1 font-terminal text-[7px] tracking-widest ${effectiveContext.enabled || hasAnalyticalScope ? "border-cyan-400/40 bg-cyan-400/[0.05] text-cyan-200" : "border-border text-muted-foreground hover:text-foreground"}`} title="LiOS analytical context">
        {pointInTime ? <Clock3 className="h-3 w-3" /> : <Layers3 className="h-3 w-3" />}
        {pointInTime ? (effectiveContext.enabled ? effectiveContext.asOfDate : "LATEST") : "CONTEXT"}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 border border-border bg-[#090909] p-3 shadow-2xl">
          <div className="font-terminal text-[8px] font-bold tracking-widest text-foreground">ANALYTICAL CONTEXT</div>
          <p className="mt-1 font-terminal text-[7px] leading-relaxed text-muted-foreground">Context follows the active tab. Tabs in the same LiOS link group share enabled dimensions through the common context engine.</p>

          {pointInTime && <>
            <div className="mt-3"><label className="font-terminal text-[7px] tracking-widest text-muted-foreground">AS KNOWN ON</label><input type="date" value={effectiveContext.asOfDate ?? ""} max={new Date().toISOString().slice(0, 10)} onChange={(event) => { if (event.target.value) updateTime(setAsKnownOn(event.target.value)); }} className="mt-1 w-full border border-border bg-black px-2 py-2 font-terminal text-[9px] text-foreground" /></div>
            <div className="mt-2 font-terminal text-[7px] text-cyan-300">{describeTimeContext(effectiveContext)}</div>
            <button onClick={() => updateTime(resetToLatest())} className="mt-2 flex items-center gap-1.5 border border-border px-2 py-1.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground"><RotateCcw className="h-3 w-3" /> RETURN TO LATEST</button>
          </>}

          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-border/70 pt-3">
            <ContextTextInput label="PORTFOLIO CONTEXT" value={linkedContext.portfolioId} placeholder="e.g. Growth Fund" onCommit={(portfolioId) => updateAnalyticalScope({ portfolioId })} />
            <ContextTextInput label="SCENARIO" value={linkedContext.scenarioId} placeholder="e.g. Bear Case" onCommit={(scenarioId) => updateAnalyticalScope({ scenarioId })} />
            <ContextTextInput label="BENCHMARK" value={linkedContext.benchmarkId} placeholder="e.g. SPX" onCommit={(benchmarkId) => updateAnalyticalScope({ benchmarkId })} />
          </div>
        </div>
      )}
    </div>
  );
}
