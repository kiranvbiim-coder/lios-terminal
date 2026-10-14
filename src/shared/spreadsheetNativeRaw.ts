/** Only native Excel's precision-safe ordinary decimal spellings may become numbers. */
export function exactExcelNumber(raw: string): number | null {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;
  const significantDigits = raw.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  if (significantDigits.length > 15) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Object.is(value, -0)) return null;
  if (value === 0 && significantDigits !== "") return null;
  if (value !== 0 && Math.abs(value) < 2.2250738585072014e-308) return null;
  return value;
}
export function nativeSpreadsheetRaw(raw: string, format: string | null): string {
  if (format === "@" || raw.startsWith("=")) return raw;
  if (/^(?:TRUE|FALSE)$/i.test(raw.trim())) return raw.trim().toUpperCase();
  const number = exactExcelNumber(raw);
  return number === null ? raw : String(number);
}
