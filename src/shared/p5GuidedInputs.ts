import { z } from "zod";

/**
 * Guided professional model inputs.
 *
 * A professional model that cannot run because stated assumptions are missing or
 * unclear returns a structured data gap. When LiOS can describe the exact fields the
 * model needs it attaches a `guidedInputs` description to that gap so the existing
 * recovery action can open a labelled form. The form never calls a model itself: it
 * produces the same plain-language assumption text a user could have typed, and that
 * text is submitted through the normal chat request path, where the server parser
 * (`server/p5PlainLanguageInputs.ts`) turns it into the model parameters again.
 */

/** The existing recovery action label. Clicking it opens the guided form when the gap carries `guidedInputs`. */
export const P5_GUIDED_INPUTS_ACTION = "Tell LiOS the assumptions or model inputs you want to use";

/** Label for manual provenance created from values the user typed or confirmed. */
export const P5_MANUAL_ASSUMPTIONS_LABEL = "You provided these assumptions";

export const p5GuidedFieldSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  group: z.string().trim().min(1).max(80),
  kind: z.enum(["number", "number_list", "text"]),
  unit: z.enum(["percent", "amount", "shares", "none"]),
  unitLabel: z.string().trim().max(120),
  required: z.boolean(),
  help: z.string().trim().max(300).optional(),
}).strict();
export type P5GuidedField = z.infer<typeof p5GuidedFieldSchema>;

export const p5GuidedInputsSchema = z.object({
  modelPath: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  /** Resolved company/ticker when one was already named; null when the form must ask for it. */
  entity: z.string().trim().max(160).nullable(),
  fields: z.array(p5GuidedFieldSchema).min(1).max(40),
  /** Field keys that were not stated at all. */
  missing: z.array(z.string().max(80)).max(40),
  /** Field keys whose wording was ambiguous or invalid, with the reason. Nothing is guessed for these. */
  issues: z.array(z.object({ key: z.string().max(80), message: z.string().max(400) }).strict()).max(40),
  /** Values already understood, rendered as text, used to pre-fill the form. */
  provided: z.record(z.string().max(1500)),
}).strict();
export type P5GuidedInputs = z.infer<typeof p5GuidedInputsSchema>;

export const P5_DCF_SENSITIVITY_PATH = "valuation/dcf-sensitivity";

const CASE_GROUPS = [
  { prefix: "bearCase", group: "Bear case", label: "bear case" },
  { prefix: "bullCase", group: "Bull case", label: "bull case" },
] as const;

function dcfFields(): P5GuidedField[] {
  const amount = "currency units, the same for every amount";
  const fields: P5GuidedField[] = [
    { key: "freeCashFlows", label: "Free cash flows by year", group: "Base case", kind: "number_list", unit: "amount", unitLabel: amount + "; separate years with commas", required: true, help: "At least two years, for example 100, 110, 120." },
    { key: "waccPct", label: "WACC", group: "Base case", kind: "number", unit: "percent", unitLabel: "%", required: true },
    { key: "terminalGrowthPct", label: "Terminal growth", group: "Base case", kind: "number", unit: "percent", unitLabel: "%", required: true },
    { key: "netDebt", label: "Net debt", group: "Base case", kind: "number", unit: "amount", unitLabel: amount + "; negative for net cash", required: true },
    { key: "sharesOutstanding", label: "Shares outstanding", group: "Base case", kind: "number", unit: "shares", unitLabel: "shares, in the same unit as the amounts", required: true },
    { key: "waccGridPct", label: "WACC values to test", group: "Sensitivity grid", kind: "number_list", unit: "percent", unitLabel: "% values separated by commas", required: true, help: "For example 9, 10, 11." },
    { key: "terminalGrowthGridPct", label: "Terminal growth values to test", group: "Sensitivity grid", kind: "number_list", unit: "percent", unitLabel: "% values separated by commas", required: true, help: "For example 2, 3, 4." },
  ];
  for (const scenario of CASE_GROUPS) {
    fields.push(
      { key: scenario.prefix + ".freeCashFlows", label: "Free cash flows by year", group: scenario.group, kind: "number_list", unit: "amount", unitLabel: amount + "; separate years with commas", required: true },
      { key: scenario.prefix + ".waccPct", label: "WACC", group: scenario.group, kind: "number", unit: "percent", unitLabel: "%", required: true },
      { key: scenario.prefix + ".terminalGrowthPct", label: "Terminal growth", group: scenario.group, kind: "number", unit: "percent", unitLabel: "%", required: true },
    );
  }
  return fields;
}

const ENTITY_FIELD: P5GuidedField = {
  key: "entity", label: "Company or ticker", group: "Company", kind: "text", unit: "none", unitLabel: "", required: true,
};

export function p5GuidedFieldsFor(modelPath: string, includeEntity: boolean): P5GuidedField[] | null {
  if (modelPath !== P5_DCF_SENSITIVITY_PATH) return null;
  return includeEntity ? [ENTITY_FIELD, ...dcfFields()] : dcfFields();
}

/** Every key the DCF sensitivity needs, excluding the entity. */
export function p5RequiredInputKeys(modelPath: string): string[] {
  return (p5GuidedFieldsFor(modelPath, false) ?? []).filter((field) => field.required).map((field) => field.key);
}

export function p5GuidedFieldLabel(modelPath: string, key: string): string {
  const field = p5GuidedFieldsFor(modelPath, true)?.find((item) => item.key === key);
  return field ? (field.group === "Base case" || field.group === "Company" ? field.label : field.group + " " + field.label.toLowerCase()) : key;
}

export function formatP5GuidedNumber(value: number): string {
  return String(value);
}

export function buildP5GuidedInputs(input: {
  modelPath: string;
  entity: string | null;
  missing: string[];
  issues: Array<{ key: string; message: string }>;
  provided: Record<string, string>;
}): P5GuidedInputs | null {
  const entityMissing = !input.entity;
  const fields = p5GuidedFieldsFor(input.modelPath, entityMissing);
  if (!fields) return null;
  return p5GuidedInputsSchema.parse({
    modelPath: input.modelPath,
    title: "DCF sensitivity assumptions",
    entity: input.entity,
    fields,
    missing: input.missing,
    issues: input.issues.map((issue) => ({ key: issue.key, message: issue.message.slice(0, 400) })),
    provided: input.provided,
  });
}

/** Flatten model parameters into the guided form's text values (used to pre-fill and to show exactly what was understood). */
export function flattenP5ParametersForForm(modelPath: string, parameters: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!parameters || modelPath !== P5_DCF_SENSITIVITY_PATH) return result;
  const put = (key: string, value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) result[key] = formatP5GuidedNumber(value);
    else if (Array.isArray(value) && value.length && value.every((item) => typeof item === "number" && Number.isFinite(item))) {
      result[key] = (value as number[]).map(formatP5GuidedNumber).join(", ");
    }
  };
  for (const key of ["freeCashFlows", "waccPct", "terminalGrowthPct", "netDebt", "sharesOutstanding", "waccGridPct", "terminalGrowthGridPct"]) put(key, parameters[key]);
  for (const scenario of CASE_GROUPS) {
    const value = parameters[scenario.prefix];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of ["freeCashFlows", "waccPct", "terminalGrowthPct"]) put(scenario.prefix + "." + key, (value as Record<string, unknown>)[key]);
    }
  }
  return result;
}

const PLAIN_NUMBER = /^[-+]?\d+(?:\.\d+)?$/;

function parseGuidedNumber(raw: string, percent: boolean): number | null {
  const cleaned = (percent ? raw.replace(/\s*%$/, "") : raw).trim();
  if (!PLAIN_NUMBER.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && Math.abs(value) < 1e15 ? value : null;
}

function parseGuidedList(raw: string, percent: boolean): number[] | null {
  const parts = raw.split(/\s*[,;]\s*/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const values = parts.map((part) => parseGuidedNumber(part, percent));
  return values.every((value): value is number => value !== null) ? values : null;
}

export interface P5GuidedValidation {
  errors: Record<string, string>;
  /** Parsed values keyed like the form fields. Present only when `errors` is empty. */
  parsed: Record<string, number | number[] | string> | null;
  preview: Array<{ key: string; group: string; label: string; value: string }>;
}

/** Validate the form's text values for the guided model. Pure: no I/O, no defaults. */
export function validateP5GuidedValues(guided: P5GuidedInputs, values: Record<string, string>): P5GuidedValidation {
  const errors: Record<string, string> = {};
  const parsed: Record<string, number | number[] | string> = {};
  const preview: P5GuidedValidation["preview"] = [];
  for (const field of guided.fields) {
    const raw = (values[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) errors[field.key] = "Required";
      continue;
    }
    const percent = field.unit === "percent";
    if (field.kind === "text") {
      if (/[\r\n{}\[\]<>]/.test(raw) || raw.length > 120) errors[field.key] = "Enter a plain company name or ticker";
      else { parsed[field.key] = raw; preview.push({ key: field.key, group: field.group, label: field.label, value: raw }); }
    } else if (field.kind === "number") {
      const value = parseGuidedNumber(raw, percent);
      if (value === null) errors[field.key] = "Enter a plain number" + (percent ? " (for 10% type 10)" : "");
      else { parsed[field.key] = value; preview.push({ key: field.key, group: field.group, label: field.label, value: formatGuidedDisplay(value, field) }); }
    } else {
      const list = parseGuidedList(raw, percent);
      if (!list) errors[field.key] = "Enter numbers separated by commas";
      else if (list.length > (field.key.endsWith("freeCashFlows") ? 50 : 25)) errors[field.key] = `At most ${field.key.endsWith("freeCashFlows") ? 50 : 25} values`;
      else { parsed[field.key] = list; preview.push({ key: field.key, group: field.group, label: field.label, value: list.map((value) => formatGuidedDisplay(value, field)).join(", ") }); }
    }
  }
  if (guided.modelPath === P5_DCF_SENSITIVITY_PATH) validateDcfRelations(parsed, errors);
  return { errors, parsed: Object.keys(errors).length ? null : parsed, preview };
}

function formatGuidedDisplay(value: number, field: P5GuidedField): string {
  const text = formatP5GuidedNumber(value);
  return field.unit === "percent" ? text + "%" : text;
}

function validateDcfRelations(parsed: Record<string, number | number[] | string>, errors: Record<string, string>) {
  const num = (key: string) => (typeof parsed[key] === "number" ? parsed[key] as number : null);
  const list = (key: string) => (Array.isArray(parsed[key]) ? parsed[key] as number[] : null);
  const checkWacc = (key: string) => {
    const value = num(key);
    if (value !== null && !(value > 0 && value < 100)) errors[key] = "WACC must be above 0% and below 100%";
  };
  checkWacc("waccPct"); checkWacc("bearCase.waccPct"); checkWacc("bullCase.waccPct");
  const shares = num("sharesOutstanding");
  if (shares !== null && shares <= 0) errors.sharesOutstanding = "Shares outstanding must be above 0";
  const fcf = list("freeCashFlows");
  if (fcf && fcf.length < 2) errors.freeCashFlows = "Enter at least two years of free cash flow";
  for (const scenario of CASE_GROUPS) {
    const cases = list(scenario.prefix + ".freeCashFlows");
    if (cases && cases.length < 2) errors[scenario.prefix + ".freeCashFlows"] = "Enter at least two years of free cash flow";
  }
  const pairs: Array<[string, string]> = [["waccPct", "terminalGrowthPct"], ["bearCase.waccPct", "bearCase.terminalGrowthPct"], ["bullCase.waccPct", "bullCase.terminalGrowthPct"]];
  for (const [waccKey, growthKey] of pairs) {
    const wacc = num(waccKey); const growth = num(growthKey);
    if (wacc !== null && growth !== null && wacc <= growth && !errors[growthKey]) errors[growthKey] = "Terminal growth must be below WACC";
  }
  const waccGrid = list("waccGridPct"); const growthGrid = list("terminalGrowthGridPct");
  if (waccGrid && waccGrid.some((value) => !(value > 0 && value < 100))) errors.waccGridPct = "Each WACC must be above 0% and below 100%";
  if (waccGrid && growthGrid && !errors.waccGridPct && Math.min(...waccGrid) <= Math.max(...growthGrid)) {
    errors.terminalGrowthGridPct = "Every tested WACC must exceed every tested terminal growth";
  }
}

/**
 * The exact plain-language assumption text a guided form submits. The server parser accepts
 * this wording (and many natural variants), so the form and typed chat share one request path.
 */
export function formatP5GuidedAssumptionsMessage(modelPath: string, parsed: Record<string, number | number[] | string>): string | null {
  if (modelPath !== P5_DCF_SENSITIVITY_PATH) return null;
  const pct = (value: number) => formatP5GuidedNumber(value) + "%";
  const list = (key: string, percent = false) => {
    const value = parsed[key];
    if (!Array.isArray(value)) return null;
    return (value as number[]).map((item) => (percent ? pct(item) : formatP5GuidedNumber(item))).join(", ");
  };
  const num = (key: string) => (typeof parsed[key] === "number" ? parsed[key] as number : null);
  const entity = typeof parsed.entity === "string" ? parsed.entity.replace(/[\s.,;:!?]+$/g, "") : null;
  const lines: string[] = [];
  const base = {
    fcf: list("freeCashFlows"), wacc: num("waccPct"), growth: num("terminalGrowthPct"), net: num("netDebt"), shares: num("sharesOutstanding"),
    waccGrid: list("waccGridPct", true), growthGrid: list("terminalGrowthGridPct", true),
  };
  if (!base.fcf || base.wacc === null || base.growth === null || base.net === null || base.shares === null || !base.waccGrid || !base.growthGrid) return null;
  lines.push("Run a DCF sensitivity" + (entity ? " for " + entity : "") + ".");
  lines.push("Free cash flows: " + base.fcf + ".");
  lines.push("WACC: " + pct(base.wacc) + ". Terminal growth: " + pct(base.growth) + ". Net debt: " + formatP5GuidedNumber(base.net) + ". Shares outstanding: " + formatP5GuidedNumber(base.shares) + ".");
  lines.push("WACC grid: " + base.waccGrid + ". Terminal growth grid: " + base.growthGrid + ".");
  for (const scenario of CASE_GROUPS) {
    const fcf = list(scenario.prefix + ".freeCashFlows");
    const wacc = num(scenario.prefix + ".waccPct");
    const growth = num(scenario.prefix + ".terminalGrowthPct");
    if (!fcf || wacc === null || growth === null) return null;
    lines.push(scenario.group + ": free cash flows " + fcf + "; WACC " + pct(wacc) + "; terminal growth " + pct(growth) + ".");
  }
  return lines.join("\n");
}
