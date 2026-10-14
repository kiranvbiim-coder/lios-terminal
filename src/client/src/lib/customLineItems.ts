import { useCallback, useState } from "react";

// Generic "user-extensible line item" engine -- every financial statement
// panel in this app ships with a fixed schema (a hardcoded list of line
// items / ratios / multiples), but real filings aren't uniform: a bank has
// no "Inventory", a REIT reports FFO instead of standard EBITDA, a SaaS
// company's income statement has deferred-revenue lines an industrial never
// sees. This lets a user add their own particular -- either a manual value
// per period, or a formula built from other particulars (built-in or
// custom) chained with +, -, x, / -- instead of being stuck with whatever
// fixed template we shipped. Built once here so every panel (Financial
// Statements first, then Ratios/DCF/Comps/LBO) can reuse the same engine.

export type FormulaOp = "+" | "-" | "×" | "÷";

// A term is either a reference -- "builtin:<rawFieldKey>" (a field already
// in the panel's own data) or "custom:<id>" (another user-added particular,
// enabling formulas that chain off other formulas) -- OR a bare typed-in
// number (`literal`), for formulas like "Revenue x 2%" where "2%" isn't
// itself a particular. Exactly one of `ref` / `literal` is set.
export interface FormulaTerm {
  ref?: string;
  literal?: number;
  op?: FormulaOp; // omitted on the first term -- it's just the starting value
}

export interface ManualCustomItem {
  id: string;
  label: string;
  kind: "manual";
  values: Record<number, number>; // periodIndex -> raw value
}

export interface FormulaCustomItem {
  id: string;
  label: string;
  kind: "formula";
  terms: FormulaTerm[];
}

export type CustomItem = ManualCustomItem | FormulaCustomItem;

let nextId = 1;
export function newCustomItemId(): string {
  return `custom_${Date.now()}_${nextId++}`;
}

export function customRef(id: string): string {
  return `custom:${id}`;
}
export function builtinRef(key: string): string {
  return `builtin:${key}`;
}

/**
 * Resolves any ref to a number for a given period, recursing into other
 * custom items when the ref points at one. `visiting` guards against a
 * formula that (directly or transitively) references itself -- resolves to
 * null instead of recursing forever.
 */
export function resolveRef(
  ref: string,
  periodIdx: number,
  getBuiltinValue: (key: string, periodIdx: number) => number | null | undefined,
  customItems: CustomItem[],
  visiting: Set<string> = new Set(),
): number | null {
  if (ref.startsWith("builtin:")) {
    const v = getBuiltinValue(ref.slice(8), periodIdx);
    return v === undefined || v === null ? null : v;
  }
  if (visiting.has(ref)) return null;
  const item = customItems.find(c => customRef(c.id) === ref);
  if (!item) return null;
  if (item.kind === "manual") return item.values[periodIdx] ?? null;
  const nextVisiting = new Set(visiting);
  nextVisiting.add(ref);
  return evaluateFormula(item.terms, periodIdx, getBuiltinValue, customItems, nextVisiting);
}

function resolveTerm(
  term: FormulaTerm,
  periodIdx: number,
  getBuiltinValue: (key: string, periodIdx: number) => number | null | undefined,
  customItems: CustomItem[],
  visiting: Set<string>,
): number | null {
  if (term.literal !== undefined) return term.literal;
  if (!term.ref) return null;
  return resolveRef(term.ref, periodIdx, getBuiltinValue, customItems, visiting);
}

/** Sequential left-to-right evaluation -- a1 op a2 op a3 ... -- deliberately
 * not a full expression parser with operator precedence: users pick operand
 * + operator pairs from dropdowns, so there's no ambiguity to get wrong and
 * no formula-injection surface to sandbox against. Each operand is either a
 * reference to another particular or a bare typed-in number. */
export function evaluateFormula(
  terms: FormulaTerm[],
  periodIdx: number,
  getBuiltinValue: (key: string, periodIdx: number) => number | null | undefined,
  customItems: CustomItem[],
  visiting: Set<string> = new Set(),
): number | null {
  if (!terms.length) return null;
  let acc = resolveTerm(terms[0], periodIdx, getBuiltinValue, customItems, visiting);
  if (acc === null) return null;
  for (let i = 1; i < terms.length; i++) {
    const term = terms[i];
    if (!term.op) return null;
    const val = resolveTerm(term, periodIdx, getBuiltinValue, customItems, visiting);
    if (val === null) return null;
    if (term.op === "+") acc = acc + val;
    else if (term.op === "-") acc = acc - val;
    else if (term.op === "×") acc = acc * val;
    else acc = val !== 0 ? acc / val : NaN;
  }
  return acc;
}

export function evaluateCustomItem(
  item: CustomItem,
  periodIdx: number,
  getBuiltinValue: (key: string, periodIdx: number) => number | null | undefined,
  customItems: CustomItem[],
): number | null {
  if (item.kind === "manual") return item.values[periodIdx] ?? null;
  return evaluateFormula(item.terms, periodIdx, getBuiltinValue, customItems, new Set([customRef(item.id)]));
}

/** Per-panel custom-particular state -- in-session (React state) for now;
 * promoting this to backend-persisted storage later only requires swapping
 * this hook's internals, not the panels that call it. */
export function useCustomLineItems() {
  const [items, setItems] = useState<CustomItem[]>([]);

  const addManual = useCallback((label: string, values: Record<number, number>) => {
    setItems(prev => [...prev, { id: newCustomItemId(), label, kind: "manual", values }]);
  }, []);

  const addFormula = useCallback((label: string, terms: FormulaTerm[]) => {
    setItems(prev => [...prev, { id: newCustomItemId(), label, kind: "formula", terms }]);
  }, []);

  const updateValue = useCallback((id: string, periodIdx: number, value: number) => {
    setItems(prev => prev.map(it => (it.id === id && it.kind === "manual"
      ? { ...it, values: { ...it.values, [periodIdx]: value } }
      : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
  }, []);

  const removeAll = useCallback(() => setItems([]), []);

  return { items, addManual, addFormula, updateValue, remove, removeAll };
}
