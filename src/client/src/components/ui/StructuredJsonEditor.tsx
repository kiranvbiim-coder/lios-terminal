import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Schema contract
// ---------------------------------------------------------------------------

export type JsonFieldSchema =
  | { kind: "number"; key: string; label: string; min?: number; max?: number; step?: number; default?: number; optional?: boolean; help?: string }
  | { kind: "string"; key: string; label: string; default?: string; optional?: boolean; help?: string }
  | { kind: "select"; key: string; label: string; options: readonly string[]; default?: string; help?: string }
  | { kind: "boolean"; key: string; label: string; default?: boolean; help?: string }
  | { kind: "json"; key: string; label: string; default?: unknown; optional?: boolean; help?: string }
  | { kind: "numberArray"; key: string; label: string; itemLabel?: string; default?: number[]; help?: string }
  | { kind: "stringArray"; key: string; label: string; default?: string[]; help?: string }
  | { kind: "numberMatrix"; key: string; label: string; default?: number[][]; help?: string }
  | { kind: "objectArray"; key: string; label: string; itemFields: JsonFieldSchema[]; default?: Record<string, unknown>[]; help?: string }
  | {
      kind: "record";
      key: string;
      label: string;
      valueKind: "number" | "string" | "json" | "object" | "array";
      valueSchema?: readonly JsonFieldSchema[];
      itemSchema?: JsonFieldSchema;
      default?: Record<string, unknown>;
      help?: string;
    }
  | { kind: "object"; key: string; label: string; fields: JsonFieldSchema[]; default?: Record<string, unknown>; help?: string };

export interface StructuredJsonEditorProps {
  schema: readonly JsonFieldSchema[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Optional: renders an "ADVANCED: EDIT AS JSON" toggle that swaps the form for a raw textarea
   * pre-filled with JSON.stringify(value, null, 2); editing the raw textarea and it being valid JSON
   * calls onChange with the parsed object. Default true. */
  allowRawJsonToggle?: boolean;
  className?: string;
}
function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneJson(v)]));
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Applies schema defaults recursively while preserving unknown keys and
 * retaining existing collection references when no nested default is needed.
 */
export function applySchemaDefaults(schema: readonly JsonFieldSchema[], value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const field of schema) {
    const existing = result[field.key];
    if (field.kind === "object") {
      const base = isObject(existing) ? existing : (isObject(field.default) ? field.default : {});
      const nested = applySchemaDefaults(field.fields, base);
      result[field.key] = nested;
    } else if (field.kind === "objectArray") {
      const rows = Array.isArray(existing) ? existing : (Array.isArray(field.default) ? field.default : undefined);
      if (rows) {
        let changed = !Array.isArray(existing);
        const nextRows = rows.map((row) => {
          if (!isObject(row)) return row;
          const next = applySchemaDefaults(field.itemFields, row);
          if (!deepEqual(next, row)) changed = true;
          return deepEqual(next, row) ? row : next;
        });
        result[field.key] = changed ? nextRows : rows;
      } else if (field.default !== undefined) {
        result[field.key] = cloneJson(field.default);
      }
    } else if (field.kind === "record" && isObject(existing)) {
      if (field.valueKind === "object" && field.valueSchema) {
        let changed = false;
        const next = Object.fromEntries(Object.entries(existing).map(([k, v]) => {
          if (!isObject(v)) return [k, v];
          const normalized = applySchemaDefaults(field.valueSchema!, v);
          if (!deepEqual(normalized, v)) changed = true;
          return [k, changed ? normalized : v];
        }));
        result[field.key] = changed ? next : existing;
      } else if (field.valueKind === "array" && field.itemSchema) {
        let changed = false;
        const next = Object.fromEntries(Object.entries(existing).map(([k, v]) => {
          if (!Array.isArray(v)) return [k, v];
          const normalized = v.map((item) => {
            if (!isObject(item)) return item;
            const itemSchema = field.itemSchema!;
            const itemNext =
              itemSchema.kind === "object"
                ? applySchemaDefaults(itemSchema.fields, item)
                : applySchemaDefaults([itemSchema], { [itemSchema.key]: item })[itemSchema.key];
            if (!deepEqual(itemNext, item)) changed = true;
            return itemNext;
          });
          return [k, changed ? normalized : v];
        }));
        result[field.key] = changed ? next : existing;
      }
    } else if (existing === undefined && field.default !== undefined) {
      result[field.key] = cloneJson(field.default);
    }
  }
  return result;
}

export function updateObjectArrayRow(rows: readonly Record<string, unknown>[], index: number, row: Record<string, unknown>): Record<string, unknown>[] {
  if (index < 0 || index >= rows.length) return rows.slice();
  const next = rows.slice();
  next[index] = row;
  return next;
}

export function updateRecordValue(record: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  return { ...record, [key]: value };
}

export function removeRecordValue(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const next = { ...record };
  delete next[key];
  return next;
}

// ---------------------------------------------------------------------------
// Shared visual primitives (terminal aesthetic — see PortfolioOptimizerPanel.tsx)
// ---------------------------------------------------------------------------

const INPUT_CLS =
  "w-full border border-border bg-transparent px-1 py-0.5 font-terminal text-[7px] text-foreground focus:outline-none focus:border-amber-400/50";
const SELECT_CLS =
  "w-full border border-border bg-[#0a0a0a] px-1 py-0.5 font-terminal text-[7px] text-foreground focus:outline-none focus:border-amber-400/50";
const ADD_BTN_CLS = "border border-border px-2 py-0.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground";
const REMOVE_BTN_CLS = "border border-border px-1 font-terminal text-[7px] text-red-300 hover:text-red-200 hover:border-red-300/50";

function FieldWrap({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="font-terminal text-[7px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
      {help && <div className="font-terminal text-[7px] leading-snug text-muted-foreground/70">{help}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deep structural equality (internal use only, form-sized data)
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Primitive (scalar) input — number / string / select / boolean
// ---------------------------------------------------------------------------

type ContainerProps = { container: Record<string, unknown>; onContainerChange: (next: Record<string, unknown>) => void };

function PrimitiveInput({ field, container, onContainerChange }: { field: JsonFieldSchema } & ContainerProps) {
  switch (field.kind) {
    case "number": {
      const raw = container[field.key];
      const current = typeof raw === "number" ? raw : field.default;
      return (
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          value={current === undefined ? "" : current}
          onChange={(e) => {
            const text = e.target.value;
            if (text === "") {
              if (field.optional) {
                const next = { ...container };
                delete next[field.key];
                onContainerChange(next);
              } else {
                onContainerChange({ ...container, [field.key]: field.default ?? 0 });
              }
              return;
            }
            const parsed = Number(text);
            onContainerChange({ ...container, [field.key]: Number.isNaN(parsed) ? 0 : parsed });
          }}
          className={INPUT_CLS}
        />
      );
    }
    case "string": {
      const raw = container[field.key];
      const current = typeof raw === "string" ? raw : (field.default ?? "");
      return (
        <input
          type="text"
          value={current}
          onChange={(e) => {
            const text = e.target.value;
            if (text === "") {
              if (field.optional) {
                const next = { ...container };
                delete next[field.key];
                onContainerChange(next);
              } else {
                onContainerChange({ ...container, [field.key]: field.default ?? "" });
              }
              return;
            }
            onContainerChange({ ...container, [field.key]: text });
          }}
          className={INPUT_CLS}
        />
      );
    }
    case "select": {
      const raw = container[field.key];
      const current = typeof raw === "string" ? raw : (field.default ?? field.options[0] ?? "");
      return (
        <select value={current} onChange={(e) => onContainerChange({ ...container, [field.key]: e.target.value })} className={SELECT_CLS}>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    case "json": {
      const current = container[field.key];
      const text = JSON.stringify(current === undefined ? (field.default ?? null) : current);
      return (
        <textarea
          value={text}
          onChange={(e) => {
            try {
              onContainerChange({ ...container, [field.key]: JSON.parse(e.target.value) });
            } catch {
              // Keep invalid intermediate JSON local to the browser control.
            }
          }}
          className="min-h-8 w-full border border-border bg-transparent px-1 py-0.5 font-mono text-[7px] text-foreground focus:outline-none focus:border-amber-400/50"
        />
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// numberArray / stringArray
// ---------------------------------------------------------------------------

type NumberArraySchema = Extract<JsonFieldSchema, { kind: "numberArray" }>;
function NumberArrayField({ field, container, onContainerChange }: { field: NumberArraySchema } & ContainerProps) {
  const raw = container[field.key];
  const arr = Array.isArray(raw) ? (raw as number[]) : (field.default ?? []);
  const setArr = (next: number[]) => onContainerChange({ ...container, [field.key]: next });
  return (
    <FieldWrap label={field.label} help={field.help}>
      <div className="space-y-1">
        {arr.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-10 shrink-0 font-terminal text-[7px] text-muted-foreground">{field.itemLabel ? `${field.itemLabel} ${i}` : `[${i}]`}</span>
            <input
              type="number"
              value={item}
              onChange={(e) => {
                const next = arr.slice();
                const parsed = Number(e.target.value);
                next[i] = Number.isNaN(parsed) ? 0 : parsed;
                setArr(next);
              }}
              className={INPUT_CLS}
            />
            <button type="button" onClick={() => setArr(arr.filter((_, j) => j !== i))} className={REMOVE_BTN_CLS}>
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setArr([...arr, 0])} className={ADD_BTN_CLS}>
          + ADD
        </button>
      </div>
    </FieldWrap>
  );
}

type StringArraySchema = Extract<JsonFieldSchema, { kind: "stringArray" }>;
function StringArrayField({ field, container, onContainerChange }: { field: StringArraySchema } & ContainerProps) {
  const raw = container[field.key];
  const arr = Array.isArray(raw) ? (raw as string[]) : (field.default ?? []);
  const setArr = (next: string[]) => onContainerChange({ ...container, [field.key]: next });
  return (
    <FieldWrap label={field.label} help={field.help}>
      <div className="space-y-1">
        {arr.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-6 shrink-0 font-terminal text-[7px] text-muted-foreground">[{i}]</span>
            <input
              type="text"
              value={item}
              onChange={(e) => {
                const next = arr.slice();
                next[i] = e.target.value;
                setArr(next);
              }}
              className={INPUT_CLS}
            />
            <button type="button" onClick={() => setArr(arr.filter((_, j) => j !== i))} className={REMOVE_BTN_CLS}>
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setArr([...arr, ""])} className={ADD_BTN_CLS}>
          + ADD
        </button>
      </div>
    </FieldWrap>
  );
}

// ---------------------------------------------------------------------------
// numberMatrix
// ---------------------------------------------------------------------------

type NumberMatrixSchema = Extract<JsonFieldSchema, { kind: "numberMatrix" }>;
function NumberMatrixField({ field, container, onContainerChange }: { field: NumberMatrixSchema } & ContainerProps) {
  const raw = container[field.key];
  const matrix = Array.isArray(raw) ? (raw as number[][]) : (field.default ?? [[0]]);
  const setMatrix = (next: number[][]) => onContainerChange({ ...container, [field.key]: next });
  const cols = matrix[0]?.length ?? 0;
  return (
    <FieldWrap label={field.label} help={field.help}>
      <table className="border-collapse">
        <tbody>
          {matrix.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="p-0.5">
                  <input
                    type="number"
                    value={cell}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      const next = matrix.map((rr) => rr.slice());
                      next[r][c] = Number.isNaN(parsed) ? 0 : parsed;
                      setMatrix(next);
                    }}
                    className="w-12 border border-border bg-transparent px-1 py-0.5 font-terminal text-[7px] text-foreground focus:outline-none focus:border-amber-400/50"
                  />
                </td>
              ))}
              <td className="p-0.5">
                <button type="button" onClick={() => setMatrix(matrix.filter((_, rr) => rr !== r))} className={REMOVE_BTN_CLS}>
                  × row
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex gap-1">
        <button type="button" onClick={() => setMatrix([...matrix, Array(cols).fill(0)])} className={ADD_BTN_CLS}>
          + ROW
        </button>
        <button type="button" onClick={() => setMatrix(matrix.map((row) => [...row, 0]))} className={ADD_BTN_CLS}>
          + COL
        </button>
        {cols > 0 && (
          <button type="button" onClick={() => setMatrix(matrix.map((row) => row.slice(0, -1)))} className={REMOVE_BTN_CLS}>
            - COL
          </button>
        )}
      </div>
    </FieldWrap>
  );
}

// ---------------------------------------------------------------------------
// objectArray (table)
// ---------------------------------------------------------------------------

type ObjectArraySchema = Extract<JsonFieldSchema, { kind: "objectArray" }>;
function ObjectArrayField({ field, container, onContainerChange }: { field: ObjectArraySchema } & ContainerProps) {
  const raw = container[field.key];
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : (field.default ?? []);
  const setRows = (next: Record<string, unknown>[]) => onContainerChange({ ...container, [field.key]: next });
  return (
    <FieldWrap label={field.label} help={field.help}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {field.itemFields.map((f) => (
              <th key={f.key} className="border-b border-border px-1 py-0.5 text-left font-terminal text-[7px] text-muted-foreground">
                {f.label}
              </th>
            ))}
            <th className="border-b border-border" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {field.itemFields.map((f) => (
                <td key={f.key} className="px-1 py-0.5">
                  <FieldRow
                    field={f}
                    container={row}
                    onContainerChange={(nextRow) => setRows(updateObjectArrayRow(rows, i, nextRow))}
                  />
                </td>
              ))}
              <td className="px-1 py-0.5">
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className={REMOVE_BTN_CLS}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setRows([...rows, applySchemaDefaults(field.itemFields, {})])} className={ADD_BTN_CLS}>
        + ADD ROW
      </button>
    </FieldWrap>
  );
}

// ---------------------------------------------------------------------------
// record (open key-value map)
// ---------------------------------------------------------------------------

function JsonValueEditor({ value, onChange }: { value: unknown; onChange: (next: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  useEffect(() => setText(JSON.stringify(value ?? null, null, 2)), [value]);
  return (
    <textarea
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        try {
          onChange(JSON.parse(event.target.value));
        } catch {
          // Preserve a valid controlled value while the user types JSON.
        }
      }}
      className="min-h-8 min-w-24 flex-1 border border-border bg-transparent px-1 py-0.5 font-mono text-[7px] text-foreground focus:outline-none focus:border-amber-400/50"
    />
  );
}

type RecordSchema = Extract<JsonFieldSchema, { kind: "record" }>;
function RecordValueEditor({ field, value, onChange }: { field: RecordSchema; value: unknown; onChange: (next: unknown) => void }) {
  if (field.valueKind === "object" && field.valueSchema && isObject(value)) {
    return (
      <div className="min-w-32 flex-1 border-l border-border/60 pl-1">
        <FieldList schema={field.valueSchema} value={value} onChange={onChange as (next: Record<string, unknown>) => void} />
      </div>
    );
  }
  if (field.valueKind === "array" && field.itemSchema && Array.isArray(value)) {
    return (
      <div className="min-w-32 flex-1 space-y-1">
        {value.map((item, index) => (
          <div key={index} className="flex items-start gap-1">
            <span className="font-terminal text-[7px] text-muted-foreground">[{index}]</span>
            <FieldRow
              field={field.itemSchema!}
              container={{ [field.itemSchema!.key]: item }}
              onContainerChange={(next) => {
                const nextArray = value.slice();
                nextArray[index] = next[field.itemSchema!.key];
                onChange(nextArray);
              }}
            />
            <button type="button" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} className={REMOVE_BTN_CLS}>
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...value, field.itemSchema!.default ?? null])} className={ADD_BTN_CLS}>
          + ADD ITEM
        </button>
      </div>
    );
  }
  return <JsonValueEditor value={value} onChange={onChange} />;
}

function RecordField({ field, container, onContainerChange }: { field: RecordSchema } & ContainerProps) {
  const raw = container[field.key];
  const rec = isObject(raw) ? raw : (field.default ?? {});
  const entries = Object.entries(rec);
  const setRec = (next: Record<string, unknown>) => onContainerChange({ ...container, [field.key]: next });
  return (
    <FieldWrap label={field.label} help={field.help}>
      <div className="space-y-1">
        {entries.map(([key, item], index) => (
          <div key={index} className="flex items-start gap-1">
            <input
              type="text"
              value={key}
              placeholder="KEY"
              onChange={(event) => {
                const next: Record<string, unknown> = {};
                entries.forEach(([oldKey, oldValue], entryIndex) => {
                  next[entryIndex === index ? event.target.value : oldKey] = oldValue;
                });
                setRec(next);
              }}
              className={INPUT_CLS}
            />
            {field.valueKind === "number" ? (
              <input
                type="number"
                value={typeof item === "number" ? item : 0}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  setRec(updateRecordValue(rec, key, Number.isNaN(parsed) ? 0 : parsed));
                }}
                className={INPUT_CLS}
              />
            ) : field.valueKind === "string" ? (
              <input type="text" value={typeof item === "string" ? item : ""} onChange={(event) => setRec(updateRecordValue(rec, key, event.target.value))} className={INPUT_CLS} />
            ) : (
              <RecordValueEditor field={field} value={item} onChange={(next) => setRec(updateRecordValue(rec, key, next))} />
            )}
            <button type="button" onClick={() => setRec(removeRecordValue(rec, key))} className={REMOVE_BTN_CLS}>
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            let newKey = "key";
            let n = 1;
            while (newKey in rec) newKey = `key${n++}`;
            const initial = field.valueKind === "number" ? 0 : field.valueKind === "string" ? "" : field.valueKind === "array" ? [] : {};
            setRec(updateRecordValue(rec, newKey, initial));
          }}
          className={ADD_BTN_CLS}
        >
          + ADD FIELD
        </button>
      </div>
    </FieldWrap>
  );
}

// ---------------------------------------------------------------------------
// object (bordered nested sub-section, recursive)
// ---------------------------------------------------------------------------

type ObjectSchema = Extract<JsonFieldSchema, { kind: "object" }>;
function ObjectField({ field, container, onContainerChange }: { field: ObjectSchema } & ContainerProps) {
  const raw = container[field.key];
  const nested = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : (field.default ?? {});
  return (
    <FieldWrap label={field.label} help={field.help}>
      <div className="ml-1 space-y-2 border-l-2 border-border/60 pl-2">
        <FieldList schema={field.fields} value={nested} onChange={(next) => onContainerChange({ ...container, [field.key]: next })} />
      </div>
    </FieldWrap>
  );
}

// ---------------------------------------------------------------------------
// Field dispatch + list
// ---------------------------------------------------------------------------

function FieldRow({ field, container, onContainerChange }: { field: JsonFieldSchema } & ContainerProps) {
  switch (field.kind) {
    case "number":
    case "string":
    case "select":
    case "boolean":
    case "json":
      return (
        <FieldWrap label={field.label} help={field.help}>
          <PrimitiveInput field={field} container={container} onContainerChange={onContainerChange} />
        </FieldWrap>
      );
    case "numberArray":
      return <NumberArrayField field={field} container={container} onContainerChange={onContainerChange} />;
    case "stringArray":
      return <StringArrayField field={field} container={container} onContainerChange={onContainerChange} />;
    case "numberMatrix":
      return <NumberMatrixField field={field} container={container} onContainerChange={onContainerChange} />;
    case "objectArray":
      return <ObjectArrayField field={field} container={container} onContainerChange={onContainerChange} />;
    case "record":
      return <RecordField field={field} container={container} onContainerChange={onContainerChange} />;
    case "object":
      return <ObjectField field={field} container={container} onContainerChange={onContainerChange} />;
    default:
      return null;
  }
}

function FieldList({ schema, value, onChange }: { schema: readonly JsonFieldSchema[]; value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-2">
      {schema.map((field) => (
        <FieldRow key={field.key} field={field} container={value} onContainerChange={onChange} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function StructuredJsonEditor({ schema, value, onChange, allowRawJsonToggle = true, className }: StructuredJsonEditorProps): JSX.Element {
  const displayValue = useMemo(() => applySchemaDefaults(schema, value), [schema, value]);

  // Applies schema defaults on first render (and whenever the schema introduces new defaulted
  // fields) so the caller's `value` always reflects what the form is showing, without requiring
  // every consumer to pre-seed via applySchemaDefaults themselves.
  useEffect(() => {
    if (!deepEqual(displayValue, value)) {
      onChange(displayValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayValue]);

  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);

  const enterRawMode = () => {
    setRawText(JSON.stringify(displayValue, null, 2));
    setRawError(null);
    setRawMode(true);
  };

  const handleRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        setRawError(null);
        onChange(parsed as Record<string, unknown>);
      } else {
        setRawError("Top-level JSON must be an object");
      }
    } catch (e) {
      setRawError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div className={cn("space-y-2 font-terminal", className)}>
      {allowRawJsonToggle && (
        <button type="button" onClick={() => (rawMode ? setRawMode(false) : enterRawMode())} className={ADD_BTN_CLS}>
          {rawMode ? "BACK TO FORM" : "ADVANCED: EDIT AS JSON"}
        </button>
      )}
      {rawMode ? (
        <div className="space-y-1">
          <textarea
            value={rawText}
            onChange={(e) => handleRawChange(e.target.value)}
            className="h-40 w-full resize-y border border-border bg-transparent p-1 font-mono text-[7px] text-foreground focus:outline-none focus:border-amber-400/50"
          />
          {rawError && <div className="font-terminal text-[7px] text-red-300">{rawError}</div>}
        </div>
      ) : (
        <FieldList schema={schema} value={displayValue} onChange={onChange} />
      )}
    </div>
  );
}
