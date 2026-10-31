import { p9EventFiltersSchema } from "@shared/p9AutomationContracts";

export type P9EventFilterRow = {
  id: number;
  key: string;
  type: "string" | "number" | "boolean";
  value: string;
};

export type P9EventFilterResult =
  | { success: true; data: Record<string, string | number | boolean> }
  | { success: false; error: string };

/** Show exact saved filter keys/values in a form, not an exposed JSON editor. */
export function rowsFromEventFilters(filters: Record<string, string | number | boolean>): P9EventFilterRow[] {
  return Object.entries(filters).map(([key, value], id) => ({
    id,
    key,
    type: typeof value as P9EventFilterRow["type"],
    value: String(value),
  }));
}

/** Keep saved values' primitive types, reject collisions and never relax server validation. */
export function parseEventFilterRows(rows: readonly P9EventFilterRow[]): P9EventFilterResult {
  if (rows.length > 50) return { success: false, error: "Use at most 50 conditions." };
  const filters: Record<string, string | number | boolean> = Object.create(null);
  for (const row of rows) {
    if (!row.key.trim()) return { success: false, error: "Enter a field name for every condition." };
    if (Object.prototype.hasOwnProperty.call(filters, row.key)) {
      return { success: false, error: "Each field can appear only once." };
    }
    if (row.type === "string") filters[row.key] = row.value;
    else if (row.type === "boolean") {
      if (row.value !== "true" && row.value !== "false") return { success: false, error: "Choose true or false." };
      filters[row.key] = row.value === "true";
    } else if (row.type === "number") {
      if (!row.value.trim()) return { success: false, error: "Enter a number for every numeric condition." };
      const number = Number(row.value);
      if (!Number.isFinite(number)) return { success: false, error: "Enter a finite number." };
      filters[row.key] = number;
    } else return { success: false, error: "Choose a supported value type." };
  }
  const result = p9EventFiltersSchema.safeParse(filters);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error.issues[0]?.message ?? "Review the matching conditions." };
}
