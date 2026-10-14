import { useMemo, useState } from "react";
import type { P6StrategyDefinition } from "@shared/p6FinanceContracts";
import { strategyStudioState } from "@/lib/backtestCockpit";

function validateStrategy(source: string, language: P6StrategyDefinition["sourceLanguage"]): string[] {
  const errors: string[] = [];
  if (!source.trim()) errors.push("Strategy source is empty.");
  if (source.length > 500_000) errors.push("Strategy source exceeds the LiOS limit.");
  if (/\b(fetch|XMLHttpRequest|WebSocket|child_process|process\.env|fs\.)\b/i.test(source)) {
    errors.push("Network, process, credential or filesystem access is not permitted in the Strategy Studio sandbox.");
  }
  if (language === "json") {
    try { JSON.parse(source); } catch { errors.push("JSON strategy source is not valid JSON."); }
  }
  return errors;
}

export function P6StrategyStudioPanel(props: {
  value: P6StrategyDefinition;
  onChange: (value: P6StrategyDefinition) => void;
  monacoAvailable?: boolean;
  onRunBacktest?: () => void;
}) {
  const [preferMonaco, setPreferMonaco] = useState(true);
  const errors = useMemo(() => validateStrategy(props.value.source, props.value.sourceLanguage), [props.value.source, props.value.sourceLanguage]);
  const studio = strategyStudioState({
    preferMonaco,
    monacoAvailable: props.monacoAvailable ?? false,
    language: props.value.sourceLanguage,
    validation: errors.length ? "invalid" : "valid",
  });

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-4" aria-label="Strategy Studio">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Strategy Studio</p>
          <h2 className="text-lg font-semibold">{props.value.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Sandboxed · no broker, secret, filesystem or network access</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button className="rounded border px-2 py-1" onClick={() => setPreferMonaco((value) => !value)}>
            Editor: {studio.editor === "monaco_optional" ? "Monaco" : "Built-in"}
          </button>
          <button
            className="rounded border px-3 py-1 font-medium disabled:opacity-50"
            disabled={errors.length > 0 || !props.onRunBacktest}
            onClick={props.onRunBacktest}
          >
            Run historical simulation
          </button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <label className="text-xs text-muted-foreground">
          Language
          <select
            className="mt-1 w-full rounded border bg-background px-2 py-2 text-foreground"
            value={props.value.sourceLanguage}
            onChange={(event) => props.onChange({ ...props.value, sourceLanguage: event.target.value as P6StrategyDefinition["sourceLanguage"] })}
          >
            <option value="rules">LiOS rules</option>
            <option value="json">JSON</option>
            <option value="brue">Brue (optional runtime)</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Strategy name
          <input
            className="mt-1 w-full rounded border bg-background px-2 py-2 text-foreground"
            value={props.value.name}
            onChange={(event) => props.onChange({ ...props.value, name: event.target.value })}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 rounded-lg border bg-card/40 p-2">
        <textarea
          className="h-full min-h-80 w-full resize-none bg-transparent p-2 font-mono text-xs outline-none"
          spellCheck={false}
          value={props.value.source}
          readOnly={props.value.sourceLanguage === "rules"}
          onChange={(event) => {
            if (props.value.sourceLanguage === "rules") return;
            props.onChange({ ...props.value, source: event.target.value });
          }}
          aria-label="Strategy source"
        />
      </div>

      <footer className="grid gap-2 text-xs md:grid-cols-2">
        <div className="rounded border p-3">
          <div className="font-medium">Validation</div>
          {errors.length ? <ul className="mt-1 space-y-1 text-destructive">{errors.map((error) => <li key={error}>• {error}</li>)}</ul> : <p className="mt-1 text-muted-foreground">{props.value.sourceLanguage === "rules" ? "LiOS rules are generated from the executable structured parameters shown beside the editor." : "Valid draft source. Execution still requires an active governed runtime adapter."}</p>}
        </div>
        <div className="rounded border p-3 text-muted-foreground">
          <div className="font-medium text-foreground">Runtime boundary</div>
          <p className="mt-1">The editor never grants execution rights. Brue/Monaco are optional adapters; LiOS strategy, permission and backtest contracts remain authoritative.</p>
        </div>
      </footer>
    </section>
  );
}
