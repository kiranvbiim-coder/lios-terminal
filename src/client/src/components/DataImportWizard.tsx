import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { inspectImportFile, type FileImportPreview } from "@/lib/fileImportPipeline";
import { CheckCircle2, FileInput, Upload, XCircle } from "lucide-react";

interface Props { onClose: () => void; onImported: () => void | Promise<void>; }
type MappingConfidence = "exact" | "normalized" | "alias" | "unmapped";
interface ColumnMapping { sourceColumn: string; metricId: string | null; confidence: MappingConfidence; }
interface ImportResult {
  observations: Array<Record<string, unknown>>;
  rejected: Array<{ row: number; reason: string }>;
  persisted: number;
  columnMappings: ColumnMapping[];
  canonicalMetrics: Array<{ id: string; label: string }>;
}

const inputClass = "w-full bg-[#0d0d0d] border border-border px-3 py-2 font-terminal text-[10px] text-foreground outline-none focus:border-[hsl(38,95%,50%)]/60";

export default function DataImportWizard({ onClose, onImported }: Props) {
  const [symbol, setSymbol] = useState("AAPL");
  const [source, setSource] = useState("User BYOD upload");
  const [currency, setCurrency] = useState("USD");
  const [period, setPeriod] = useState("CURRENT");
  const [preview, setPreview] = useState<FileImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string | null>>({});
  const [reviewing, setReviewing] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setReviewing(false);
    setMappingOverrides({});
    setPreview(null);
    try {
      const inspected = await inspectImportFile(file);
      setPreview(inspected);
      if (inspected.truncated) {
        setError(`LiOS detected ${inspected.totalRows} rows and previewed the first ${inspected.previewRows.length}. Filter or split the file to 500 rows or fewer before persistence so rows are never silently dropped.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect this file.");
    }
  }

  async function normalizeRows(persist: boolean) {
    if (!preview?.previewRows.length || preview.truncated || !symbol.trim() || !source.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiRequest("POST", "/api/finance/normalize", {
        symbol: symbol.trim().toUpperCase(),
        records: preview.previewRows,
        source: source.trim(),
        provider: "user_upload",
        defaultPeriod: period.trim() || "CURRENT",
        defaultCurrency: currency.trim() || undefined,
        columnMapping: persist ? mappingOverrides : undefined,
        persist,
      });
      const normalized = await response.json() as ImportResult;
      setResult(normalized);
      if (persist) {
        setReviewing(false);
        await onImported();
      } else {
        setMappingOverrides(Object.fromEntries(normalized.columnMappings.map(mapping => [mapping.sourceColumn, mapping.metricId])));
        setReviewing(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not normalize this import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <section className="w-full max-w-3xl max-h-[88vh] overflow-y-auto border border-border bg-[#080808] p-5" onClick={event => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <div className="flex items-center gap-2 font-terminal text-[11px] tracking-widest text-foreground"><FileInput className="w-4 h-4 text-[hsl(38,95%,55%)]" /> BYOD FILE IMPORT</div>
            <div className="mt-1 font-terminal text-[8px] text-muted-foreground">Detect format → infer schema → preview → review mappings → validate → persist.</div>
          </div>
          <button onClick={onClose} aria-label="Close import wizard"><XCircle className="w-4 h-4 text-muted-foreground" /></button>
        </header>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label><span className="font-terminal text-[8px] text-muted-foreground">ENTITY / TICKER</span><input value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} className={inputClass} /></label>
          <label><span className="font-terminal text-[8px] text-muted-foreground">SOURCE LABEL</span><input value={source} onChange={event => setSource(event.target.value)} className={inputClass} /></label>
          <label><span className="font-terminal text-[8px] text-muted-foreground">DEFAULT PERIOD</span><input value={period} onChange={event => setPeriod(event.target.value)} className={inputClass} placeholder="FY2025 / CURRENT" /></label>
          <label><span className="font-terminal text-[8px] text-muted-foreground">DEFAULT CURRENCY</span><input value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} className={inputClass} /></label>
        </div>

        <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/[0.03] px-4 text-center hover:bg-[hsl(38,95%,50%)]/[0.07] focus-within:outline focus-within:outline-2 focus-within:outline-primary">
          <Upload className="h-5 w-5 text-[hsl(38,95%,55%)]" />
          <span className="mt-2 font-terminal text-[9px] text-foreground">{preview?.fileName || "CHOOSE CSV, TSV, XLSX, XLS, ODS, JSON, OR PARQUET"}</span>
          <span className="mt-1 font-terminal text-[7px] text-muted-foreground">Parquet is accepted for capability detection but is not falsely decoded in-browser before the secure local-file bridge exists.</span>
          <input type="file" className="sr-only" aria-label="Choose data file" accept=".csv,.tsv,.xlsx,.xls,.ods,.json,.parquet" onChange={event => void handleFile(event.target.files?.[0])} />
        </label>

        {preview && (
          <div className="mt-4 border border-border bg-[#050505] p-3">
            <div className="flex flex-wrap items-center gap-3 font-terminal text-[8px] tracking-widest text-muted-foreground">
              <span>FORMAT · {preview.format.toUpperCase()}</span>
              <span>ROWS · {preview.totalRows}</span>
              <span>FIELDS · {preview.fields.length}</span>
              {preview.sheetNames.length > 0 && <span>SHEETS · {preview.sheetNames.length}</span>}
              {preview.truncated && <span className="text-amber-300">PREVIEW TRUNCATED</span>}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {preview.fields.slice(0, 20).map(field => (
                <div key={field.name} className="flex items-center justify-between gap-3 border border-border/60 px-2 py-1 font-terminal text-[7px]">
                  <span className="truncate text-foreground" title={field.name}>{field.name}</span>
                  <span className="uppercase text-muted-foreground">{field.type}{field.nullable ? " · nullable" : ""}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 max-h-36 overflow-auto font-mono text-[8px] text-muted-foreground">
              {preview.previewRows.slice(0, 5).map((row, index) => <div key={index} className="border-b border-border/40 py-1">{JSON.stringify(row)}</div>)}
            </div>
          </div>
        )}

        {reviewing && result && <div className="mt-4 border border-[hsl(38,95%,50%)]/50 bg-[hsl(38,95%,50%)]/[0.04] p-3">
          <div className="font-terminal text-[8px] tracking-widest text-[hsl(38,95%,58%)]">REVIEW / FIX COLUMN MAPPING</div>
          <div className="mt-1 font-terminal text-[7px] text-muted-foreground">Unmapped columns stay excluded until you assign a canonical metric or ignore them.</div>
          <div className="mt-3 space-y-2">
            {result.columnMappings.map(mapping => <label key={mapping.sourceColumn} className="grid grid-cols-[1fr_auto_1.2fr] items-center gap-2 font-terminal text-[8px]">
              <span className="truncate text-foreground" title={mapping.sourceColumn}>{mapping.sourceColumn}</span>
              <span className="text-muted-foreground">{mapping.confidence.toUpperCase()}</span>
              <select aria-label={`Map ${mapping.sourceColumn}`} value={mappingOverrides[mapping.sourceColumn] ?? ""} onChange={event => setMappingOverrides(current => ({ ...current, [mapping.sourceColumn]: event.target.value || null }))} className={inputClass}>
                <option value="">IGNORE COLUMN</option>
                {result.canonicalMetrics.map(metric => <option key={metric.id} value={metric.id}>{metric.label} ({metric.id})</option>)}
              </select>
            </label>)}
          </div>
        </div>}

        {error && <div className="mt-3 border border-rose-500/40 bg-rose-500/[0.04] p-3 font-terminal text-[8px] text-rose-300">{error}</div>}
        {result && <div className="mt-3 border border-emerald-500/40 bg-emerald-500/[0.04] p-3 font-terminal text-[8px] text-emerald-300"><div className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5" /> {reviewing ? `${result.observations.length} observations ready for approval.` : `${result.persisted} observations persisted to the tenant store.`}</div><div className="mt-1 text-muted-foreground">{result.rejected.length} rows rejected with explicit reasons.</div></div>}
        <footer className="mt-4 flex items-center justify-between gap-4"><span className="font-terminal text-[7px] text-muted-foreground">No values are invented and no rows beyond the safe import bound are silently dropped.</span><button onClick={() => void normalizeRows(reviewing)} disabled={!preview?.previewRows.length || preview.truncated || busy} className="border border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10 px-4 py-2 font-terminal text-[8px] text-[hsl(38,95%,58%)] disabled:opacity-40">{busy ? "NORMALIZING..." : reviewing ? "PERSIST APPROVED MAPPING" : "REVIEW MAPPING"}</button></footer>
      </section>
    </div>
  );
}
