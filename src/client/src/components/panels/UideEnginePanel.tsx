import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles, UploadCloud, Loader2, FileWarning, Database, Clock, Compass,
  BrainCircuit, Calculator, FileSpreadsheet, LayoutGrid, GitBranch, AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ColumnProfile {
  name: string;
  inferredType: string;
  totalCount: number;
  nullCount: number;
  uniqueCount: number;
  isLikelyKey: boolean;
  sampleValues: string[];
  min: number | string | null;
  max: number | string | null;
}

interface TabularSheetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  duplicateOrBlankHeaderWarning: boolean;
}

interface FormulaRef {
  cell: string;
  formula: string;
  referencedSheets: string[];
}

interface LayoutSheetProfile {
  rowCount: number;
  columnCount: number;
  labels: string[];
  formulaCount: number;
  hardcodedValueCount: number;
  detectedModelType: string | null;
  formulas: FormulaRef[];
}

type SheetShape = "tabular" | "layout" | "empty";

interface SheetProfile {
  sheetName: string;
  shape: SheetShape;
  tabular: TabularSheetProfile | null;
  layout: LayoutSheetProfile | null;
}

interface CrossSheetReference {
  fromSheet: string;
  toSheet: string;
  count: number;
}

interface WorkbookProfile {
  fileName: string;
  fileExt: string;
  sheetNames: string[];
  sheets: SheetProfile[];
  crossSheetReferences: CrossSheetReference[];
  parsedAt: string;
}

interface DomainCandidate {
  slug: string;
  name: string;
  confidence: number;
  matchedSignals: string[];
}

interface ClassificationResult {
  candidates: DomainCandidate[];
  reasoningSource: "heuristic" | "llm";
  classifiedAt: string;
}

interface FixtureMeta {
  id: string;
  fileName: string;
  fileExt: string;
  sheetCount: number;
  totalRows: number;
  uploadedByUserId: number;
  uploadedAt: string;
  topDomain?: string;
  topDomainConfidence?: number;
}

interface FixtureRecord extends FixtureMeta {
  profile: WorkbookProfile;
  classification?: ClassificationResult;
}

const TYPE_COLOR: Record<string, string> = {
  numeric: "text-cyan-400 border-cyan-400/30",
  currency: "text-emerald-400 border-emerald-400/30",
  percentage: "text-emerald-400 border-emerald-400/30",
  date: "text-amber-400 border-amber-400/30",
  boolean: "text-fuchsia-400 border-fuchsia-400/30",
  categorical: "text-violet-400 border-violet-400/30",
  text: "text-muted-foreground border-border",
  empty: "text-rose-400 border-rose-400/30",
};

const MODEL_TYPE_LABEL: Record<string, string> = {
  dcf: "DCF Valuation",
  lbo: "LBO Model",
  three_statement: "Three-Statement Model",
  comps: "Trading Comparables",
};

export default function UideEnginePanel() {
  const [fixtureId, setFixtureId] = useState<string | null>(null);
  const [profile, setProfile] = useState<WorkbookProfile | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [fixtures, setFixtures] = useState<FixtureMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFixtures = useCallback(async () => {
    try {
      const res = await fetch("/api/uide/fixtures");
      if (res.ok) setFixtures(await res.json());
    } catch {
      // fixture history is a convenience list -- a failed refresh here
      // shouldn't block the upload flow itself
    }
  }, []);

  useEffect(() => {
    loadFixtures();
  }, [loadFixtures]);

  const classifyFixture = useCallback(async (id: string) => {
    setIsClassifying(true);
    try {
      const res = await fetch(`/api/uide/fixtures/${id}/classify`, { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        setClassification(json.classification);
        loadFixtures();
      }
    } catch {
      // classification is a best-effort enhancement on top of the already-
      // useful deterministic profile -- a failure here shouldn't read as
      // "upload failed"
    } finally {
      setIsClassifying(false);
    }
  }, [loadFixtures]);

  const uploadFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    setClassification(null);
    setActiveSheet(0);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uide/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Upload failed.");
        return;
      }
      setProfile(json.profile);
      setFixtureId(json.fixtureId);
      loadFixtures();
      classifyFixture(json.fixtureId);
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setIsUploading(false);
    }
  }, [loadFixtures, classifyFixture]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const openFixture = useCallback(async (id: string) => {
    setError(null);
    setActiveSheet(0);
    try {
      const res = await fetch(`/api/uide/fixtures/${id}`);
      const json: FixtureRecord = await res.json();
      if (res.ok) {
        setProfile(json.profile);
        setFixtureId(json.id);
        setClassification(json.classification ?? null);
        if (!json.classification) classifyFixture(json.id);
      }
    } catch {
      setError("Could not load that fixture.");
    }
  }, [classifyFixture]);

  const currentSheet = profile?.sheets[activeSheet] ?? null;

  return (
    <div className="h-full flex flex-col bg-[#050505] text-foreground overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="panel-label font-bold text-xs tracking-wider">UNIVERSAL INTELLIGENT DATA ENGINE</span>
        <span className="ml-auto font-terminal text-[8px] text-muted-foreground tracking-widest">INGEST, PROFILE (MULTI-SHEET) &amp; CLASSIFY</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
            isDragOver ? "border-cyan-400 bg-cyan-400/5" : "border-border bg-[#070707] hover:border-muted-foreground"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.xlsx,.xls,.ods,.json,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          ) : (
            <UploadCloud className="w-6 h-6 text-muted-foreground" />
          )}
          <span className="font-terminal text-[10px] text-muted-foreground uppercase tracking-wider">
            {isUploading ? "Parsing every sheet & profiling..." : "Drop a file here or click to upload"}
          </span>
          <span className="font-terminal text-[8px] text-muted-foreground/60">CSV · TSV · XLSX · XLS · ODS · JSON · Fixed-width TXT — every tab is read, no domain hint needed</span>
        </div>

        {error && (
          <div className="flex items-center gap-2 border border-rose-500/40 bg-rose-500/5 px-3 py-2 font-terminal text-[9px] text-rose-400">
            <FileWarning className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Domain classification */}
        {fixtureId && (isClassifying || classification) && (
          <Card className="bg-[#070707] border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-terminal text-[10px] font-bold uppercase tracking-wider">
                  <Compass className="w-3.5 h-3.5 text-amber-400" />
                  Domain Classification
                </div>
                {classification && (
                  <Badge variant="outline" className={`text-[7.5px] px-1.5 py-0 uppercase flex items-center gap-1 ${
                    classification.reasoningSource === "llm" ? "text-violet-400 border-violet-400/30" : "text-cyan-400 border-cyan-400/30"
                  }`}>
                    {classification.reasoningSource === "llm" ? <BrainCircuit className="w-2.5 h-2.5" /> : <Calculator className="w-2.5 h-2.5" />}
                    {classification.reasoningSource === "llm" ? "AI-refined" : "Heuristic"}
                  </Badge>
                )}
              </div>

              {isClassifying ? (
                <div className="flex items-center gap-2 font-terminal text-[9px] text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Scoring against the domain taxonomy across every sheet...
                </div>
              ) : classification ? (
                <div className="space-y-2">
                  {classification.candidates.map((c, i) => (
                    <div key={c.slug} className="space-y-1">
                      <div className="flex items-center justify-between font-terminal text-[9px]">
                        <span className={i === 0 ? "font-bold text-foreground" : "text-muted-foreground"}>
                          {i === 0 ? "→ " : "  "}{c.name}
                        </span>
                        <span className="text-muted-foreground">{Math.round(c.confidence * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-[#111] border border-border/40 overflow-hidden">
                        <div
                          className={i === 0 ? "h-full bg-amber-400" : "h-full bg-muted-foreground/40"}
                          style={{ width: `${Math.max(c.confidence * 100, 2)}%` }}
                        />
                      </div>
                      {c.matchedSignals.length > 0 && (
                        <div className="font-terminal text-[7.5px] text-muted-foreground/60 truncate">
                          {c.matchedSignals.slice(0, 6).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="font-terminal text-[7.5px] text-muted-foreground/70 italic border-t border-border/40 pt-2">
                    One domain per workbook, not per tab — every sheet's columns/labels feed the same classification. Below-confidence or ambiguous cases get refined by a model constrained to this same taxonomy, never inventing a new domain.
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* Cross-sheet references */}
        {profile && profile.crossSheetReferences.length > 0 && (
          <div className="border border-border bg-[#070707] p-3">
            <div className="flex items-center gap-1.5 mb-2 font-terminal text-[9px] font-bold text-muted-foreground uppercase">
              <GitBranch className="w-3.5 h-3.5 text-violet-400" />
              Cross-Sheet References — this workbook is one connected model
            </div>
            <div className="flex flex-wrap gap-1.5">
              {profile.crossSheetReferences.map((ref) => (
                <Badge key={`${ref.fromSheet}-${ref.toSheet}`} variant="outline" className="text-[7.5px] text-violet-400 border-violet-400/30 px-1.5 py-0.5">
                  {ref.fromSheet} → {ref.toSheet} ({ref.count})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Workbook / sheet profile */}
        {profile && (
          <Card className="bg-[#070707] border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-terminal text-[10px] font-bold uppercase tracking-wider">{profile.fileName}</div>
                <div className="font-terminal text-[8.5px] text-muted-foreground">
                  {profile.sheetNames.length} sheet{profile.sheetNames.length === 1 ? "" : "s"}
                </div>
              </div>

              {/* Sheet tabs */}
              {profile.sheetNames.length > 1 && (
                <div className="flex flex-wrap gap-1 border-b border-border/40 pb-2">
                  {profile.sheets.map((sheet, i) => (
                    <button
                      key={sheet.sheetName}
                      onClick={() => setActiveSheet(i)}
                      className={`flex items-center gap-1 px-2 py-1 font-terminal text-[8px] uppercase tracking-wider border transition-colors ${
                        i === activeSheet
                          ? "border-amber-400/40 text-amber-400 bg-amber-400/5"
                          : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {sheet.shape === "layout" ? <LayoutGrid className="w-2.5 h-2.5" /> : <FileSpreadsheet className="w-2.5 h-2.5" />}
                      {sheet.sheetName}
                    </button>
                  ))}
                </div>
              )}

              {currentSheet?.shape === "empty" && (
                <div className="font-terminal text-[9px] text-muted-foreground py-4 text-center">
                  Sheet "{currentSheet.sheetName}" appears empty.
                </div>
              )}

              {currentSheet?.shape === "tabular" && currentSheet.tabular && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="font-terminal text-[8.5px] text-muted-foreground">
                      {currentSheet.tabular.rowCount.toLocaleString()} rows · {currentSheet.tabular.columnCount} columns
                    </div>
                    {currentSheet.tabular.duplicateOrBlankHeaderWarning && (
                      <Badge variant="outline" className="text-[7px] text-rose-400 border-rose-400/30 px-1.5 py-0 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> DUPLICATE/BLANK HEADERS — LIKELY MULTI-ROW HEADER
                      </Badge>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="font-terminal text-[8px] uppercase">Column</TableHead>
                          <TableHead className="font-terminal text-[8px] uppercase">Type</TableHead>
                          <TableHead className="font-terminal text-[8px] uppercase">Nulls</TableHead>
                          <TableHead className="font-terminal text-[8px] uppercase">Unique</TableHead>
                          <TableHead className="font-terminal text-[8px] uppercase">Range / Samples</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentSheet.tabular.columns.map((col) => (
                          <TableRow key={col.name} className="border-border/50 hover:bg-white/5">
                            <TableCell className="font-terminal text-[9px] font-semibold">
                              {col.name}
                              {col.isLikelyKey && (
                                <Badge variant="outline" className="ml-2 text-[7px] text-amber-400 border-amber-400/30 px-1 py-0">KEY?</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[7.5px] px-1.5 py-0 uppercase ${TYPE_COLOR[col.inferredType] || ""}`}>
                                {col.inferredType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-terminal text-[8.5px] text-muted-foreground">
                              {col.nullCount}/{col.totalCount}
                            </TableCell>
                            <TableCell className="font-terminal text-[8.5px] text-muted-foreground">{col.uniqueCount}</TableCell>
                            <TableCell className="font-terminal text-[8.5px] text-muted-foreground">
                              {col.min !== null && col.max !== null
                                ? `${col.min} → ${col.max}`
                                : col.sampleValues.slice(0, 3).join(", ") || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {currentSheet?.shape === "layout" && currentSheet.layout && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[7.5px] text-violet-400 border-violet-400/30 px-1.5 py-0.5">
                      LAYOUT / MODEL SHEET
                    </Badge>
                    {currentSheet.layout.detectedModelType && (
                      <Badge variant="outline" className="text-[7.5px] text-amber-400 border-amber-400/30 px-1.5 py-0.5">
                        {MODEL_TYPE_LABEL[currentSheet.layout.detectedModelType] || currentSheet.layout.detectedModelType}
                      </Badge>
                    )}
                    <span className="font-terminal text-[8px] text-muted-foreground">
                      {currentSheet.layout.formulaCount} formula cells
                    </span>
                    {currentSheet.layout.hardcodedValueCount > 0 && (
                      <Badge variant="outline" className="text-[7px] text-rose-400 border-rose-400/30 px-1.5 py-0 flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> {currentSheet.layout.hardcodedValueCount} POSSIBLE HARDCODE{currentSheet.layout.hardcodedValueCount === 1 ? "" : "S"} IN FORMULA ROWS
                      </Badge>
                    )}
                  </div>

                  <div>
                    <div className="font-terminal text-[8px] uppercase text-muted-foreground mb-1">Row Labels ({currentSheet.layout.labels.length})</div>
                    <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto scrollbar-thin">
                      {currentSheet.layout.labels.map((label, i) => (
                        <span key={`${label}-${i}`} className="font-terminal text-[8px] text-muted-foreground border border-border/40 px-1.5 py-0.5">
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {currentSheet.layout.formulas.length > 0 && (
                    <div>
                      <div className="font-terminal text-[8px] uppercase text-muted-foreground mb-1">
                        Sample Formulas (showing {Math.min(currentSheet.layout.formulas.length, 8)} of {currentSheet.layout.formulaCount})
                      </div>
                      <div className="space-y-1 max-h-[140px] overflow-y-auto scrollbar-thin">
                        {currentSheet.layout.formulas.slice(0, 8).map((f) => (
                          <div key={f.cell} className="font-terminal text-[8px] text-muted-foreground/80 flex gap-2">
                            <span className="text-cyan-400 shrink-0">{f.cell}</span>
                            <span className="truncate">={f.formula}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="font-terminal text-[7.5px] text-muted-foreground/70 italic border-t border-border/40 pt-2">
                Deterministic profile — quality checks and AI completion arrive in later phases. Every value above is derived directly from the file, nothing inferred by a model.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fixture history */}
        <div className="border border-border bg-[#070707] p-4">
          <div className="flex items-center gap-1.5 mb-2 font-terminal text-[9px] font-bold text-muted-foreground uppercase border-b border-border/40 pb-1.5">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>SCENARIO FIXTURE BANK ({fixtures.length})</span>
          </div>
          {fixtures.length === 0 ? (
            <div className="font-terminal text-[8.5px] text-muted-foreground py-2">No files processed yet.</div>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-thin">
              {fixtures.map((f) => (
                <button
                  key={f.id}
                  onClick={() => openFixture(f.id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 border border-border/40 bg-[#0a0a0a] hover:bg-white/5 text-left transition-colors"
                >
                  <span className="flex items-center gap-2 font-terminal text-[8.5px] truncate">
                    {f.fileName}
                    {f.topDomain && (
                      <Badge variant="outline" className="text-[7px] text-amber-400 border-amber-400/30 px-1 py-0 shrink-0">
                        {f.topDomain}{f.topDomainConfidence != null ? ` ${Math.round(f.topDomainConfidence * 100)}%` : ""}
                      </Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-2 font-terminal text-[7.5px] text-muted-foreground shrink-0 ml-2">
                    {f.sheetCount} sheet{f.sheetCount === 1 ? "" : "s"} · {f.totalRows.toLocaleString()} rows
                    <Clock className="w-3 h-3" />
                    {new Date(f.uploadedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
