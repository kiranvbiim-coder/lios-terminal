import { useCallback, useEffect, useId, useRef, useState } from "react";
import { registerAssumptionBinding, updateAssumptionBindingValue } from "@/lib/terminalAssumptionRegistry";
import type { ViewMode } from "@/lib/terminalTypes";

// Shared "live data, but every field is yours to override" input atom.
// V5 registers each labelled input as a scenario-bindable assumption while
// preserving explicit user control: scenarios only change inputs when the
// user invokes APPLY in Scenario Workbench.

interface EditableValueProps {
  value: number;
  onChange: (v: number) => void;
  isOverridden?: boolean;
  onReset?: () => void;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  variant?: "cell" | "field";
  label?: string;
  highlight?: boolean;
  className?: string;
  scenarioKey?: string;
}

export function EditableValue({
  value, onChange, isOverridden = false, onReset,
  decimals = 1, suffix = "", prefix = "", variant = "cell",
  label, highlight = false, className = "", scenarioKey,
}: EditableValueProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const elementRef = useRef<HTMLElement | null>(null);
  const reactId = useId();

  const commit = useCallback(() => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(n);
    setEditing(false);
  }, [raw, onChange]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !label) return;
    const pane = element.closest<HTMLElement>("[data-testid^='workspace-pane-']");
    const view = pane?.dataset.view as ViewMode | undefined;
    if (!view) return;
    const id = `assumption:${pane?.dataset.testid ?? pane?.getAttribute("data-testid") ?? "pane"}:${reactId}`;
    const unregister = registerAssumptionBinding({
      id,
      view,
      symbol: pane?.dataset.symbol,
      key: scenarioKey || label,
      label,
      value,
      unit: suffix || undefined,
      apply: onChange,
    });
    return unregister;
  }, [label, onChange, reactId, scenarioKey, suffix]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !label) return;
    const pane = element.closest<HTMLElement>("[data-testid^='workspace-pane-']");
    const id = `assumption:${pane?.dataset.testid ?? pane?.getAttribute("data-testid") ?? "pane"}:${reactId}`;
    updateAssumptionBindingValue(id, value);
  }, [label, reactId, value]);

  const displayValue = `${prefix}${value.toFixed(decimals)}${suffix}`;
  const intelligenceProps = {
    "data-analytical-role": "input",
    "data-intelligence-kind": "assumption",
    "data-intelligence-label": label || undefined,
    "data-intelligence-value": String(value),
    "data-scenario-key": scenarioKey || label || undefined,
  } as const;

  if (editing) {
    const input = (
      <input
        ref={(node) => { elementRef.current = node; }}
        autoFocus
        type="number"
        defaultValue={value}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        step="any"
        {...intelligenceProps}
        className={
          variant === "cell"
            ? "w-full bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/60%] px-1 py-0.5 font-terminal text-[10px] text-[hsl(38,95%,55%)] focus:outline-none text-center tabular-nums"
            : "w-24 bg-[hsl(38,95%,50%)/15%] border border-[hsl(38,95%,50%)/60%] px-2 py-0 font-terminal text-[10px] text-right text-foreground focus:outline-none"
        }
      />
    );
    if (variant === "field") {
      return (
        <div {...intelligenceProps} className={`flex items-center justify-between py-1.5 border-b border-border/30 ${className}`}>
          <span className="font-terminal text-[9px] text-muted-foreground">{label}</span>
          {input}
        </div>
      );
    }
    return input;
  }

  const valueButton = (
    <button
      ref={(node) => { elementRef.current = node; }}
      onClick={() => { setRaw(String(value)); setEditing(true); }}
      title="Click to edit · Alt-click to inspect"
      {...intelligenceProps}
      className={
        variant === "cell"
          ? `w-full py-0.5 font-terminal text-[10px] tabular-nums text-center transition-colors hover:bg-[hsl(38,95%,50%)/10%] hover:text-[hsl(38,95%,55%)] ${
              highlight || isOverridden ? "text-[hsl(38,95%,55%)] font-bold" : "text-foreground"
            }`
          : `font-terminal text-[10px] font-bold tabular-nums hover:underline ${
              highlight || isOverridden ? "text-[hsl(38,95%,55%)]" : "text-foreground"
            }`
      }
    >
      {displayValue}
    </button>
  );

  if (variant === "field") {
    return (
      <div {...intelligenceProps} className={`flex items-center justify-between py-1.5 border-b border-border/30 group ${className}`}>
        <span className="font-terminal text-[9px] text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1.5">
          {isOverridden && onReset && (
            <button onClick={onReset} title="Reset to live data" className="font-terminal text-[9px] text-muted-foreground hover:text-[hsl(38,95%,55%)] opacity-0 group-hover:opacity-100 transition-opacity">
              ↺
            </button>
          )}
          {isOverridden && <span className="w-1 h-1 rounded-full bg-[hsl(38,95%,55%)]" title="Overridden from live data" />}
          {valueButton}
        </span>
      </div>
    );
  }

  return valueButton;
}

export function OverrideStatusBadge({ count, onResetAll }: { count: number; onResetAll: () => void }) {
  if (count === 0) return null;
  return (
    <button
      onClick={onResetAll}
      data-analytical-role="input"
      className="font-terminal text-[7px] text-[hsl(38,95%,55%)] tracking-widest border border-[hsl(38,95%,50%)/40%] px-1.5 py-0.5 hover:bg-[hsl(38,95%,50%)/10%]"
      title="Reset all overridden fields back to live data"
    >
      {count} OVERRIDDEN · RESET ALL
    </button>
  );
}
