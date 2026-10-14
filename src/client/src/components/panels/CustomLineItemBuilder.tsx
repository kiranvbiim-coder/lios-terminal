import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { FormulaOp, FormulaTerm } from "@/lib/customLineItems";

export interface RefOption { ref: string; label: string }

interface Props {
  availableRefs: RefOption[];
  periodLabels: string[];
  onAddManual: (label: string, values: Record<number, number>) => void;
  onAddFormula: (label: string, terms: FormulaTerm[]) => void;
  /** Manual values are typed in millions for usability; set false to take raw units as-is. */
  manualInMillions?: boolean;
}

const OPS: FormulaOp[] = ["+", "-", "×", "÷"];
const NUMBER_SENTINEL = "__number__";

// A term is either a reference to another particular, or a bare typed-in
// number (for formulas like "Revenue x 2%" where "2%" isn't itself a
// particular) -- tracked here as a draft with both slots so switching modes
// in the dropdown doesn't lose what was typed.
interface TermDraft { mode: "ref" | "literal"; ref: string; literal: string; op: FormulaOp }

function newTerm(availableRefs: RefOption[], op: FormulaOp = "+"): TermDraft {
  return { mode: "ref", ref: availableRefs[0]?.ref ?? "", literal: "", op };
}

// "+ ADD PARTICULAR" -- lets a user extend a fixed-schema panel with their
// own line item, either a typed-in value per period or a formula chaining
// any other particular (built-in or previously-added custom one), or a bare
// number, with +, -, x, /. See client/src/lib/customLineItems.ts.
export function CustomLineItemBuilder({ availableRefs, periodLabels, onAddManual, onAddFormula, manualInMillions = true }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"manual" | "formula">("formula");
  const [terms, setTerms] = useState<TermDraft[]>([newTerm(availableRefs)]);
  const [manualValues, setManualValues] = useState<Record<number, string>>({});

  const reset = () => {
    setLabel("");
    setKind("formula");
    setTerms([newTerm(availableRefs)]);
    setManualValues({});
  };

  const updateTerm = (i: number, patch: Partial<TermDraft>) => {
    setTerms(prev => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const submit = () => {
    if (!label.trim()) return;
    if (kind === "manual") {
      const values: Record<number, number> = {};
      periodLabels.forEach((_, i) => {
        const n = parseFloat(manualValues[i]);
        if (!isNaN(n)) values[i] = manualInMillions ? n * 1e6 : n;
      });
      onAddManual(label.trim(), values);
    } else {
      const built: FormulaTerm[] = [];
      for (let i = 0; i < terms.length; i++) {
        const t = terms[i];
        if (t.mode === "literal") {
          const n = parseFloat(t.literal);
          if (isNaN(n)) return;
          built.push({ literal: n, op: i > 0 ? t.op : undefined });
        } else {
          if (!t.ref) return;
          built.push({ ref: t.ref, op: i > 0 ? t.op : undefined });
        }
      }
      onAddFormula(label.trim(), built);
    }
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] transition-colors"
      >
        <Plus className="w-3 h-3" /> ADD PARTICULAR
      </button>
    );
  }

  return (
    <div className="bg-[#080808] border border-[hsl(38,95%,50%)/40%] p-3 space-y-2 font-terminal text-[9px]">
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="PARTICULAR NAME (e.g. Adjusted EBITDA)"
          className="flex-1 bg-transparent border border-border px-2 py-1 text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
        />
        <div className="flex border border-border shrink-0">
          <button onClick={() => setKind("formula")} className={`px-2 py-1 ${kind === "formula" ? "bg-[hsl(38,95%,50%)] text-black font-bold" : "text-muted-foreground"}`}>FORMULA</button>
          <button onClick={() => setKind("manual")} className={`px-2 py-1 ${kind === "manual" ? "bg-[hsl(38,95%,50%)] text-black font-bold" : "text-muted-foreground"}`}>MANUAL</button>
        </div>
      </div>

      {kind === "manual" ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(periodLabels.length, 5)}, minmax(0,1fr))` }}>
          {periodLabels.map((pl, i) => (
            <div key={i}>
              <div className="text-muted-foreground mb-0.5">{pl}{manualInMillions ? " (M)" : ""}</div>
              <input
                value={manualValues[i] ?? ""}
                onChange={e => setManualValues(prev => ({ ...prev, [i]: e.target.value }))}
                placeholder="0"
                type="number"
                className="w-full bg-transparent border border-border px-1.5 py-1 text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)/50%]"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {terms.map((term, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <select
                  value={term.op}
                  onChange={e => updateTerm(i, { op: e.target.value as FormulaOp })}
                  className="bg-[#0c0c0c] border border-border px-1 py-1 text-[hsl(38,95%,55%)] font-bold focus:outline-none"
                >
                  {OPS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
              )}
              <select
                value={term.mode === "literal" ? NUMBER_SENTINEL : term.ref}
                onChange={e => {
                  const v = e.target.value;
                  if (v === NUMBER_SENTINEL) updateTerm(i, { mode: "literal" });
                  else updateTerm(i, { mode: "ref", ref: v });
                }}
                className="bg-[#0c0c0c] border border-border px-1.5 py-1 text-foreground focus:outline-none max-w-[170px]"
              >
                <option value="">SELECT...</option>
                <option value={NUMBER_SENTINEL}># TYPE A NUMBER</option>
                {availableRefs.map(r => <option key={r.ref} value={r.ref}>{r.label}</option>)}
              </select>
              {term.mode === "literal" && (
                <input
                  value={term.literal}
                  onChange={e => updateTerm(i, { literal: e.target.value })}
                  placeholder="0"
                  type="number"
                  className="w-16 bg-transparent border border-[hsl(38,95%,50%)/50%] px-1.5 py-1 text-[hsl(38,95%,55%)] focus:outline-none"
                />
              )}
              {terms.length > 1 && (
                <button onClick={() => setTerms(prev => prev.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-[hsl(0,80%,60%)]">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => setTerms(prev => [...prev, newTerm(availableRefs)])}
            className="text-[hsl(38,95%,55%)] hover:underline"
          >
            + TERM
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={submit} className="px-2 py-1 bg-[hsl(38,95%,50%)] text-black font-bold hover:bg-[hsl(38,95%,45%)]">ADD</button>
        <button onClick={() => { reset(); setOpen(false); }} className="px-2 py-1 border border-border text-muted-foreground hover:text-foreground">CANCEL</button>
      </div>
    </div>
  );
}
