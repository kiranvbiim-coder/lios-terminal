import { useTerminalArtifactContext, useTerminalArtifactState } from "@/lib/terminalArtifactState";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Save, FolderOpen, Upload, Download, FilePlus2, X, LayoutTemplate, ArrowDown, ArrowRight, Tag, Search, Undo2, Redo2, Percent, DollarSign, Hash, RefreshCw, Layers, Sliders, Plus, Blocks, History, FileDown, BarChart3, LayoutDashboard, Trash2, Library } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart as RLineChart, Line, PieChart as RPieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { SpreadsheetGrid, colIndexToLetters, colLettersToIndex, parseCellRef, cellRefToString, translateFormula, formatNumberPattern } from "@/lib/spreadsheetEngine";
import { exportGridToXlsx, importXlsxToGrid } from "@/lib/spreadsheetXlsx";
import { exportPdfReport } from "@/lib/exportPdf";
import { gridToExportSheet } from "@/lib/gridExport";
import { useActiveWorkspaceId } from "@/lib/useWorkspaces";
import { useAssumptions, setAssumption as saveSharedAssumption, deleteAssumption as removeSharedAssumption, useInvalidateAssumptions } from "@/lib/useAssumptions";
import { useScenarios, saveScenario as saveScenarioApi, deleteScenario as deleteScenarioApi, useInvalidateScenarios, type Scenario } from "@/lib/useScenarios";
import { runOneWaySensitivity, runTwoWaySensitivity, runTornadoSensitivity, buildInputRange, type OneWaySensitivityResult, type TwoWaySensitivityResult, type TornadoResult } from "@/lib/sensitivityEngine";
import { computeModelHealthScore } from "@/lib/modelHealthScore";
import { buildDependencyGraph } from "@/lib/dependencyGraph";
import { BLOCK_REGISTRY, getBlock } from "@/lib/blockRegistry";
import { INDUSTRY_PACKS, getIndustryPack, getPackOverride } from "@/lib/industryPacks";
import { analyzeCalculationPerformance, type PerformanceReport } from "@/lib/calculationPerformance";
import { extractFragment, insertFragment } from "@/lib/componentFragment";
import { useComponentLibrary, publishComponent as publishComponentApi, deleteComponent as deleteComponentApi, useInvalidateComponentLibrary } from "@/lib/useComponentLibrary";
import { extractChartData, toRechartsRows, type ChartConfig, type ChartType } from "@/lib/chartData";
import { useModelVersions, restoreModelVersion, useInvalidateModelVersions } from "@/lib/useModelVersions";
import { TEMPLATE_REGISTRY, getTemplate } from "@/lib/templateRegistry";
import type { HistoricalStatements } from "@/lib/modelTemplates";
import type { LseFinancialReport } from "@/lib/useLse";

interface Props {
  symbol?: string;
}

interface ModelSummary { id: string; name: string; symbol: string | null; updatedAt: string }

const DEFAULT_ROWS = 60;
const DEFAULT_COLS = 15; // A..O -- plenty for line items x several year columns; see module note on render strategy below.

// Whole-grid re-render on every mutation, not fine-grained dirty-cell
// tracking: at this default size (900 cells, plain divs/inputs) a full
// re-render on each keystroke is well under a frame, so the simpler
// approach is the correct one -- fine-grained tracking would be real added
// complexity for a performance problem that doesn't exist at this scale.
// Revisit if a model's row/column count grows an order of magnitude.

function formatCellValue(value: number | string | null, error: string | null, format?: string | null): string {
  if (error) return error;
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "#ERROR!";
    if (format) return formatNumberPattern(value, format);
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return value;
}

// Quick-apply presets for the format toolbar -- the common cases in a
// financial model (assumption %s, currency line items, share counts) rather
// than a full custom-format editor.
const FORMAT_PRESETS: { label: string; pattern: string | null; icon: typeof Percent }[] = [
  { label: "PERCENT", pattern: "0.0%", icon: Percent },
  { label: "CURRENCY", pattern: "$#,##0.00", icon: DollarSign },
  { label: "NUMBER", pattern: "#,##0", icon: Hash },
];

// Standard IB/FP&A cell-color convention (Rosenbaum & Pearl and every bank's
// modeling style guide agree on this): blue = a hardcoded input someone
// typed by hand -- safe to edit; black/default = a formula calculated from
// other cells -- don't overtype it, trace it instead. Text labels (row/
// column headers) get a third, muted treatment since they're neither. Once
// multi-sheet workbooks exist (roadmap item #21) a formula referencing
// another sheet gets green, per the same convention -- not applicable yet
// since this grid is single-sheet.
function getCellColorClass(raw: string, value: number | string | null, error: string | null): string {
  if (error) return "text-red-400";
  if (raw.startsWith("=")) return "text-foreground/90"; // formula -- "black"
  if (typeof value === "number") return "text-[hsl(207,80%,68%)]"; // hardcoded input -- "blue"
  return "text-muted-foreground"; // text label
}

// ─── Undo/redo ───────────────────────────────────────────────────────────
// Whole-grid snapshot rather than a fine-grained command log: a real
// command log would need a distinct entry shape for every mutation type
// (single-cell edit, fill, rename, clear-range, paste...) and this grid is
// small enough (see the render-strategy note above) that copying its full
// cell+name map on every action is cheap. Simpler and provably correct
// beats fine-grained for a problem this size.
interface GridSnapshot { cells: Record<string, string>; names: Record<string, string>; formats: Record<string, string> }

function snapshotGrid(grid: SpreadsheetGrid): GridSnapshot {
  const cells: Record<string, string> = {};
  grid.getAllCells().forEach((cell, ref) => { if (cell.raw !== "") cells[ref] = cell.raw; });
  const names: Record<string, string> = {};
  grid.getNames().forEach((target, name) => { names[name] = target; });
  const formats: Record<string, string> = {};
  grid.getAllFormats().forEach((format, ref) => { formats[ref] = format; });
  return { cells, names, formats };
}

function restoreSnapshot(snap: GridSnapshot): SpreadsheetGrid {
  const g = new SpreadsheetGrid();
  // Names first: any formula referencing a name needs the name already
  // defined so it resolves correctly the moment the cell is set.
  for (const [name, target] of Object.entries(snap.names)) g.defineName(name, target);
  for (const [ref, raw] of Object.entries(snap.cells)) g.setCell(ref, raw);
  for (const [ref, format] of Object.entries(snap.formats)) g.setFormat(ref, format);
  return g;
}

const MAX_UNDO_HISTORY = 100;

// ─── Chart & Dashboard Builder ───────────────────────────────────────────
const CHART_COLORS = ["hsl(38,95%,55%)", "hsl(142,71%,45%)", "hsl(0,80%,55%)", "hsl(200,80%,55%)", "hsl(280,70%,60%)"];
const CHART_TOOLTIP_STYLE = { background: "#0c0c0c", border: "1px solid #222", fontSize: 9, fontFamily: "'JetBrains Mono', monospace" };
const CHART_LEGEND_STYLE = { fontSize: 9, fontFamily: "'JetBrains Mono', monospace" };

// Renders a saved ChartConfig by re-reading its range off the LIVE grid
// every call -- shared by the builder's preview and every card in the
// dashboard, so both always show the sheet's current values, never a
// snapshot taken at chart-creation time.
function renderChartBody(config: ChartConfig, grid: SpreadsheetGrid): React.ReactNode {
  let data;
  try {
    data = extractChartData(grid, config.rangeRef);
  } catch (err: any) {
    return <div className="flex items-center justify-center h-full font-terminal text-[8px] text-red-400 p-2 text-center">{err?.message || "Failed to render chart."}</div>;
  }

  if (config.type === "pie") {
    const firstSeries = data.series[0];
    const pieRows = data.categories.map((cat, i) => ({ name: cat, value: firstSeries?.values[i] ?? 0 }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RPieChart>
          <Pie data={pieRows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}>
            {pieRows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={CHART_LEGEND_STYLE} />
        </RPieChart>
      </ResponsiveContainer>
    );
  }

  const rows = toRechartsRows(data);
  if (config.type === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RLineChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#111" />
          <XAxis dataKey="name" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
          <YAxis stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={CHART_LEGEND_STYLE} />
          {data.series.map((s, i) => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#111" />
        <XAxis dataKey="name" stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
        <YAxis stroke="#555" tick={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
        {data.series.map((s, i) => (
          <Bar key={s.name} dataKey={s.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Clipboard ───────────────────────────────────────────────────────────
// Internal clipboard preserves formulas (translated on paste, same
// mechanism as fill-down); plainText is what we also write to the real OS
// clipboard, so pasting into Excel/Sheets gets correct values, and so a
// later paste can detect the OS clipboard changed underneath us (user
// copied from somewhere else) by comparing against what's actually on it.
interface InternalClipboard {
  cells: Record<string, string>; // absolute source ref -> raw
  formats: Record<string, string>; // absolute source ref -> format, for the cells that have one
  anchorCol: number;
  anchorRow: number;
  plainText: string;
  isCut: boolean;
}

export default function SpreadsheetStudioPanel({ symbol }: Props) {
  const [activeWorkspaceId] = useActiveWorkspaceId();
  const terminal = useTerminalArtifactContext();
  const readOnlyRef = useRef(terminal?.readOnly ?? false);
  readOnlyRef.current = terminal?.readOnly ?? false;
  const [retainedGrid, setRetainedGrid] = useTerminalArtifactState<GridSnapshot>("SpreadsheetStudioPanel.grid", { cells: {}, names: {}, formats: {} });
  const gridRef = useRef<SpreadsheetGrid | null>(null) as React.MutableRefObject<SpreadsheetGrid>;
  if (gridRef.current === null) gridRef.current = terminal ? restoreSnapshot(retainedGrid) : new SpreadsheetGrid();
  const [version, setVersion] = useState(0);
  const bump = () => { if (terminal) setRetainedGrid(snapshotGrid(gridRef.current)); setVersion((v) => v + 1); };
  const restoredGrid = useRef(retainedGrid);
  useEffect(() => {
    if (terminal && restoredGrid.current !== retainedGrid) {
      restoredGrid.current = retainedGrid; gridRef.current = restoreSnapshot(retainedGrid); setVersion(value => value + 1);
    }
  }, [retainedGrid]);

  const [selected, setSelected] = useTerminalArtifactState("SpreadsheetStudioPanel.selected", "A1");
  // Shift+click extends a rectangular range from `selected` (the anchor, and
  // fill source) to `rangeEnd` -- enough for fill-down/fill-right without
  // building a full drag-select interaction model the panel doesn't
  // otherwise need yet.
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    terminal?.setEditing("SpreadsheetStudioPanel.cell", isEditing);
    return () => terminal?.setEditing("SpreadsheetStudioPanel.cell", false);
  }, [isEditing, terminal?.setEditing]);
  const formulaBarRef = useRef<HTMLInputElement>(null);

  const [modelId, setModelId] = useTerminalArtifactState<string | null>("SpreadsheetStudioPanel.modelId", null);
  const [modelName, setModelName] = useTerminalArtifactState("SpreadsheetStudioPanel.modelName", "Untitled Model");
  const [showOpen, setShowOpen] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNames, setShowNames] = useState(false);
  const [newNameInput, setNewNameInput] = useTerminalArtifactState("SpreadsheetStudioPanel.newNameInput", "");
  const [newNameTarget, setNewNameTarget] = useTerminalArtifactState("SpreadsheetStudioPanel.newNameTarget", "");
  const [nameError, setNameError] = useState<string | null>(null);

  const [showAudit, setShowAudit] = useState(false);

  const [showAssumptions, setShowAssumptions] = useState(false);
  const [newAssumptionName, setNewAssumptionName] = useTerminalArtifactState("SpreadsheetStudioPanel.newAssumptionName", "");
  const [newAssumptionValue, setNewAssumptionValue] = useTerminalArtifactState("SpreadsheetStudioPanel.newAssumptionValue", "");
  const [assumptionError, setAssumptionError] = useState<string | null>(null);
  const { data: sharedAssumptions } = useAssumptions(activeWorkspaceId);
  const invalidateAssumptions = useInvalidateAssumptions();

  const [newScenarioName, setNewScenarioName] = useTerminalArtifactState("SpreadsheetStudioPanel.newScenarioName", "");
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const { data: scenarios } = useScenarios(activeWorkspaceId);
  const invalidateScenarios = useInvalidateScenarios();

  const [showSensitivity, setShowSensitivity] = useState(false);
  const [sensMode, setSensMode] = useTerminalArtifactState<"one" | "two" | "tornado">("SpreadsheetStudioPanel.sensMode", "one");
  const [sensOutputRef, setSensOutputRef] = useState("");
  const [sensInputRef, setSensInputRef] = useTerminalArtifactState("SpreadsheetStudioPanel.sensInputRef", "");
  const [sensMin, setSensMin] = useTerminalArtifactState("SpreadsheetStudioPanel.sensMin", "");
  const [sensMax, setSensMax] = useTerminalArtifactState("SpreadsheetStudioPanel.sensMax", "");
  const [sensSteps, setSensSteps] = useTerminalArtifactState("SpreadsheetStudioPanel.sensSteps", "5");
  const [sensInputRef2, setSensInputRef2] = useTerminalArtifactState("SpreadsheetStudioPanel.sensInputRef2", "");
  const [sensMin2, setSensMin2] = useTerminalArtifactState("SpreadsheetStudioPanel.sensMin2", "");
  const [sensMax2, setSensMax2] = useTerminalArtifactState("SpreadsheetStudioPanel.sensMax2", "");
  const [sensSteps2, setSensSteps2] = useTerminalArtifactState("SpreadsheetStudioPanel.sensSteps2", "5");
  const [oneWayResult, setOneWayResult] = useState<OneWaySensitivityResult | null>(null);
  const [twoWayResult, setTwoWayResult] = useState<TwoWaySensitivityResult | null>(null);
  const [tornadoRows, setTornadoRows] = useTerminalArtifactState<{ ref: string; label: string; low: string; high: string }[]>("SpreadsheetStudioPanel.tornadoRows", [
    { ref: "", label: "", low: "", high: "" },
    { ref: "", label: "", low: "", high: "" },
  ]);
  const [tornadoResult, setTornadoResult] = useState<TornadoResult[] | null>(null);
  const [sensError, setSensError] = useState<string | null>(null);

  const [perfReport, setPerfReport] = useState<PerformanceReport | null>(null);

  const [showBlocks, setShowBlocks] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useTerminalArtifactState("SpreadsheetStudioPanel.selectedBlockId", BLOCK_REGISTRY[0]?.id ?? "");
  const [blockFieldValues, setBlockFieldValues] = useTerminalArtifactState<Record<string, string>>("SpreadsheetStudioPanel.blockFieldValues", {});
  const [blockError, setBlockError] = useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const { data: modelVersions } = useModelVersions(modelId);
  const invalidateModelVersions = useInvalidateModelVersions();

  const [charts, setCharts] = useTerminalArtifactState<ChartConfig[]>("SpreadsheetStudioPanel.charts", []);
  // Template Versioning -- which template (and version of it) built the
  // CURRENT sheet, if any; stamped onto the model at creation time and
  // cleared by NEW/OPEN/applying a different template, since it describes
  // this specific sheet's origin, not a standing preference.
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [appliedTemplateVersion, setAppliedTemplateVersion] = useState<number | null>(null);
  const [selectedIndustryPackId, setSelectedIndustryPackId] = useTerminalArtifactState<string>("SpreadsheetStudioPanel.selectedIndustryPackId", "");

  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTab, setLibraryTab] = useTerminalArtifactState<"browse" | "publish">("SpreadsheetStudioPanel.libraryTab", "browse");
  const { data: libraryComponents } = useComponentLibrary();
  const invalidateLibrary = useInvalidateComponentLibrary();
  const [publishName, setPublishName] = useTerminalArtifactState("SpreadsheetStudioPanel.publishName", "");
  const [publishDescription, setPublishDescription] = useTerminalArtifactState("SpreadsheetStudioPanel.publishDescription", "");
  const [publishCategory, setPublishCategory] = useTerminalArtifactState("SpreadsheetStudioPanel.publishCategory", "");
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [showChartBuilder, setShowChartBuilder] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [chartRangeInput, setChartRangeInput] = useTerminalArtifactState("SpreadsheetStudioPanel.chartRangeInput", "");
  const [chartTitleInput, setChartTitleInput] = useTerminalArtifactState("SpreadsheetStudioPanel.chartTitleInput", "");
  const [chartTypeInput, setChartTypeInput] = useTerminalArtifactState<ChartType>("SpreadsheetStudioPanel.chartTypeInput", "bar");
  const [chartError, setChartError] = useState<string | null>(null);

  const undoStackRef = useRef<GridSnapshot[]>([]);
  const redoStackRef = useRef<GridSnapshot[]>([]);
  const clipboardRef = useRef<InternalClipboard | null>(null);

  // Call before any grid mutation. Snapshots the grid AS IT IS RIGHT NOW
  // (the pre-mutation state) onto the undo stack, and invalidates redo --
  // same as every real editor: a fresh edit branches away from whatever
  // "future" a prior undo had exposed.
  function pushUndo() {
    undoStackRef.current.push(snapshotGrid(gridRef.current));
    if (undoStackRef.current.length > MAX_UNDO_HISTORY) undoStackRef.current.shift();
    redoStackRef.current = [];
  }

  function resetHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }

  function undo() {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(snapshotGrid(gridRef.current));
    gridRef.current = restoreSnapshot(prev);
    bump();
  }

  function redo() {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(snapshotGrid(gridRef.current));
    gridRef.current = restoreSnapshot(next);
    bump();
  }

  useEffect(() => {
    const cell = gridRef.current.getCell(selected);
    setEditValue(cell.raw);
  }, [selected, version]);

  function commitEdit(nextSelection?: string) {
    if (editValue !== gridRef.current.getCell(selected).raw) {
      pushUndo();
      gridRef.current.setCell(selected, editValue);
      bump();
    }
    if (nextSelection) { setSelected(nextSelection); setRangeEnd(null); }
    setIsEditing(false);
  }

  // Rectangular selection between the anchor (`selected`) and `rangeEnd`,
  // in reading order (top-left first) -- `selected` stays the fill source
  // regardless of which corner the user shift-clicked.
  function getSelectedRange(): string[] {
    if (!rangeEnd) return [selected];
    const a = parseCellRef(selected), b = parseCellRef(rangeEnd);
    if (!a || !b) return [selected];
    const refs: string[] = [];
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
      for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
        refs.push(cellRefToString(c, r));
      }
    }
    return refs;
  }

  const selectedRange = getSelectedRange();
  const isMultiCellRange = selectedRange.length > 1;

  // Bounding box of the current selection (single cell if no range is
  // active) -- shared by fill, clipboard, and delete/clear, all of which
  // need the same "top-left to bottom-right" rectangle.
  function getSelectionBounds(): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
    const a = parseCellRef(selected);
    if (!a) return null;
    if (!rangeEnd) return { minCol: a.col, maxCol: a.col, minRow: a.row, maxRow: a.row };
    const b = parseCellRef(rangeEnd);
    if (!b) return { minCol: a.col, maxCol: a.col, minRow: a.row, maxRow: a.row };
    return { minCol: Math.min(a.col, b.col), maxCol: Math.max(a.col, b.col), minRow: Math.min(a.row, b.row), maxRow: Math.max(a.row, b.row) };
  }

  // Chart & Dashboard Builder -- prefills the range input from whatever's
  // currently selected, so charting a table you've just highlighted is
  // "select it, click CHART" rather than retyping the range by hand.
  function selectionRangeString(): string {
    const bounds = getSelectionBounds();
    if (!bounds) return "";
    const from = cellRefToString(bounds.minCol, bounds.minRow);
    const to = cellRefToString(bounds.maxCol, bounds.maxRow);
    return from === to ? from : `${from}:${to}`;
  }

  function fillDirection(direction: "down" | "right") {
    const bounds = getSelectionBounds();
    if (!bounds || !rangeEnd) return;
    const { minCol, maxCol, minRow, maxRow } = bounds;
    // Fill source is always the range's top-left cell -- the natural
    // "anchor" for a fill regardless of which corner was shift-clicked.
    const sourceRef = cellRefToString(minCol, minRow);
    const targets: string[] = [];
    if (direction === "down") {
      for (let r = minRow + 1; r <= maxRow; r++) targets.push(cellRefToString(minCol, r));
    } else {
      for (let c = minCol + 1; c <= maxCol; c++) targets.push(cellRefToString(c, minRow));
    }
    if (targets.length === 0) return;
    pushUndo();
    gridRef.current.fillFormula(sourceRef, targets);
    bump();
  }

  function clearSelection() {
    const bounds = getSelectionBounds();
    if (!bounds) return;
    const { minCol, maxCol, minRow, maxRow } = bounds;
    const nonEmpty: string[] = [];
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const ref = cellRefToString(c, r);
        if (gridRef.current.getCell(ref).raw !== "") nonEmpty.push(ref);
      }
    }
    if (nonEmpty.length === 0) return;
    pushUndo();
    for (const ref of nonEmpty) gridRef.current.setCell(ref, "");
    bump();
  }

  function formatCellForClipboard(ref: string): string {
    const cell = gridRef.current.getCell(ref);
    return formatCellValue(cell.value, cell.error, gridRef.current.getFormat(ref));
  }

  function copySelection(cut: boolean): { plainText: string } | null {
    const bounds = getSelectionBounds();
    if (!bounds) return null;
    const { minCol, maxCol, minRow, maxRow } = bounds;
    const cells: Record<string, string> = {};
    const formats: Record<string, string> = {};
    const rowsOut: string[] = [];
    for (let r = minRow; r <= maxRow; r++) {
      const rowOut: string[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        const ref = cellRefToString(c, r);
        const raw = gridRef.current.getCell(ref).raw;
        if (raw !== "") cells[ref] = raw;
        const fmt = gridRef.current.getFormat(ref);
        if (fmt) formats[ref] = fmt;
        rowOut.push(formatCellForClipboard(ref));
      }
      rowsOut.push(rowOut.join("\t"));
    }
    const plainText = rowsOut.join("\n");
    clipboardRef.current = { cells, formats, anchorCol: minCol, anchorRow: minRow, plainText, isCut: cut };
    return { plainText };
  }

  function pasteInternal(clip: InternalClipboard, targetCol: number, targetRow: number) {
    const dCol = targetCol - clip.anchorCol;
    const dRow = targetRow - clip.anchorRow;
    pushUndo();
    const destRefFor = (srcRef: string) => {
      const src = parseCellRef(srcRef)!;
      return cellRefToString(src.col + dCol, src.row + dRow);
    };
    for (const [srcRef, raw] of Object.entries(clip.cells)) {
      const src = parseCellRef(srcRef);
      if (!src) continue;
      const destRef = destRefFor(srcRef);
      try {
        gridRef.current.setCell(destRef, translateFormula(raw, dCol, dRow));
      } catch {
        // A translated reference fell off the grid (#REF!) -- skip that one
        // cell rather than aborting the whole paste.
      }
    }
    for (const [srcRef, fmt] of Object.entries(clip.formats)) {
      gridRef.current.setFormat(destRefFor(srcRef), fmt);
    }
    if (clip.isCut) {
      // Cut removes formatting from the source too, unlike Delete/Backspace
      // (clearSelection) which only clears content -- matches Excel.
      for (const srcRef of Object.keys(clip.cells)) { gridRef.current.setCell(srcRef, ""); gridRef.current.setFormat(srcRef, null); }
      clipboardRef.current = null;
    }
    bump();
  }

  function pasteExternalText(text: string, targetCol: number, targetRow: number) {
    const rowsIn = text.replace(/\r/g, "").split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
    if (rowsIn.length === 0) return;
    pushUndo();
    rowsIn.forEach((line, r) => {
      line.split("\t").forEach((value, c) => {
        gridRef.current.setCell(cellRefToString(targetCol + c, targetRow + r), value);
      });
    });
    bump();
  }

  function moveDown() {
    const m = /^([A-Za-z]+)(\d+)$/.exec(selected)!;
    const row = parseInt(m[2], 10);
    commitEdit(`${m[1]}${Math.min(row + 1, DEFAULT_ROWS)}`);
  }

  // Shift+Enter's counterpart to moveDown -- Excel's convention for
  // stepping backward through a column you just Enter-filled downward.
  function moveUp() {
    const m = /^([A-Za-z]+)(\d+)$/.exec(selected)!;
    const row = parseInt(m[2], 10);
    commitEdit(`${m[1]}${Math.max(row - 1, 1)}`);
  }

  // Ctrl/Cmd+Z / Shift+Z / Y for undo/redo, and arrow-key/Tab/Enter grid
  // navigation, Delete/Backspace to clear the selection, and "just start
  // typing" to begin editing the selected cell -- the baseline keyboard
  // behavior any spreadsheet has that this grid was entirely missing
  // (mouse-only navigation, no undo, no way to clear a cell without
  // selecting all its text and deleting). Scoped to a window-level listener
  // rather than a per-cell handler since cells (plain <td>s) aren't
  // focusable -- gated on "not currently editing a text field" so it never
  // fights with native input editing (including the formula bar's own
  // onKeyDown, which handles Enter/Escape while actually typing a formula).
  useEffect(() => {
    function isEditableTarget(el: Element | null): boolean {
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable === true;
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (readOnlyRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !isEditableTarget(document.activeElement)) {
        if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      }

      if (isEditing || isEditableTarget(document.activeElement)) return;

      const m = /^([A-Za-z]+)(\d+)$/.exec(selected);
      if (!m) return;
      const col = colLettersToIndex(m[1]);
      const row = parseInt(m[2], 10) - 1;

      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearSelection(); return; }

      // F2 -- Excel's "edit this cell" convention: enters edit mode with the
      // cell's EXISTING content intact and the cursor at the end, unlike a
      // bare printable keystroke (which replaces the content, same as Excel
      // typing over a selected cell).
      if (e.key === "F2") {
        e.preventDefault();
        const raw = gridRef.current.getCell(selected).raw;
        setEditValue(raw);
        setIsEditing(true);
        requestAnimationFrame(() => {
          const el = formulaBarRef.current;
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        });
        return;
      }

      // Escape while not editing collapses a multi-cell range selection
      // back to just the anchor -- mirrors Excel/Sheets, and gives a
      // keyboard-only way out of a shift+arrow selection.
      if (e.key === "Escape" && rangeEnd) { e.preventDefault(); setRangeEnd(null); return; }

      // Ctrl/Cmd+Home and +End -- jump to A1 and to the bottom-right of the
      // sheet's used range, the two "jump to the edges of my data" anchors
      // every spreadsheet has and this grid was missing entirely (only
      // one-cell-at-a-time arrow/Tab navigation existed before).
      if (mod && (e.key === "Home" || e.key === "End")) {
        e.preventDefault();
        if (e.key === "Home") {
          setSelected("A1");
        } else {
          let maxCol = 0, maxRow = 0;
          gridRef.current.getAllCells().forEach((cell, ref) => {
            if (cell.raw === "") return;
            const parsed = parseCellRef(ref);
            if (!parsed) return;
            maxCol = Math.max(maxCol, parsed.col);
            maxRow = Math.max(maxRow, parsed.row);
          });
          setSelected(cellRefToString(maxCol, maxRow));
        }
        setRangeEnd(null);
        return;
      }

      // Ctrl/Cmd+A -- select the sheet's whole used range in one press
      // (Excel's own first-press behavior for "select my data"), rather
      // than falling through to the browser's page-level select-all.
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        let maxCol = 0, maxRow = 0;
        gridRef.current.getAllCells().forEach((cell, ref) => {
          if (cell.raw === "") return;
          const parsed = parseCellRef(ref);
          if (!parsed) return;
          maxCol = Math.max(maxCol, parsed.col);
          maxRow = Math.max(maxRow, parsed.row);
        });
        setSelected("A1");
        setRangeEnd(cellRefToString(maxCol, maxRow));
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        let nextCol = col, nextRow = row;
        if (e.key === "ArrowUp") nextRow = Math.max(0, row - 1);
        else if (e.key === "ArrowDown") nextRow = Math.min(DEFAULT_ROWS - 1, row + 1);
        else if (e.key === "ArrowLeft") nextCol = Math.max(0, col - 1);
        else if (e.key === "ArrowRight") nextCol = Math.min(DEFAULT_COLS - 1, col + 1);
        else if (e.key === "Tab") nextCol = e.shiftKey ? Math.max(0, col - 1) : Math.min(DEFAULT_COLS - 1, col + 1);
        // Enter moves down by default, up with Shift -- matches Excel's
        // convention for stepping backward through a column you just
        // Enter-filled downward.
        else if (e.key === "Enter") nextRow = e.shiftKey ? Math.max(0, row - 1) : Math.min(DEFAULT_ROWS - 1, row + 1);
        const nextRef = cellRefToString(nextCol, nextRow);
        const isArrow = e.key.startsWith("Arrow");
        if (e.shiftKey && isArrow) {
          setRangeEnd(nextRef); // shift+arrow extends the selection, same as shift+click
        } else {
          setSelected(nextRef);
          setRangeEnd(null);
        }
        return;
      }

      // A bare printable character (not a shortcut) starts editing the
      // selected cell, replacing its content -- "/" excluded since it's the
      // terminal's own global command-palette shortcut, not meaningful as
      // the first character of a formula or label.
      if (e.key.length === 1 && !mod && !e.altKey && e.key !== "/") {
        e.preventDefault();
        setEditValue(e.key);
        setIsEditing(true);
        requestAnimationFrame(() => formulaBarRef.current?.focus());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, isEditing]);

  // Copy/Cut/Paste -- native browser events rather than the async Clipboard
  // API, so this fires synchronously on the user's actual Ctrl/Cmd+C/X/V
  // gesture with no permission prompt. Preserves formulas (translated by
  // offset, same mechanism as fill-down) for paste within this grid;
  // detects a stale internal clipboard (user copied from outside since our
  // last copy) by comparing against the OS clipboard's current plain text,
  // falling back to a literal-value paste of whatever's actually there.
  useEffect(() => {
    function isEditableTarget(el: Element | null): boolean {
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    }

    function handleCopy(e: ClipboardEvent) {
      if (isEditableTarget(document.activeElement)) return;
      const result = copySelection(false);
      if (!result) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", result.plainText);
    }

    function handleCut(e: ClipboardEvent) {
      if (readOnlyRef.current) return;
      if (isEditableTarget(document.activeElement)) return;
      const result = copySelection(true);
      if (!result) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", result.plainText);
    }

    function handlePaste(e: ClipboardEvent) {
      if (readOnlyRef.current) return;
      if (isEditableTarget(document.activeElement)) return;
      const a = parseCellRef(selected);
      if (!a) return;
      e.preventDefault();
      const osText = e.clipboardData?.getData("text/plain") ?? "";
      const clip = clipboardRef.current;
      if (clip && clip.plainText === osText) {
        pasteInternal(clip, a.col, a.row);
      } else if (osText) {
        pasteExternalText(osText, a.col, a.row);
      }
    }

    document.addEventListener("copy", handleCopy);
    document.addEventListener("cut", handleCut);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("cut", handleCut);
      document.removeEventListener("paste", handlePaste);
    };
  }, [selected, rangeEnd]);

  async function handleSave() {
    setStatus("Saving...");
    const cells: Record<string, string> = {};
    gridRef.current.getAllCells().forEach((cell, ref) => {
      if (cell.raw !== "") cells[ref] = cell.raw;
    });
    const names: Record<string, string> = {};
    gridRef.current.getNames().forEach((target, name) => { names[name] = target; });
    const formats: Record<string, string> = {};
    gridRef.current.getAllFormats().forEach((format, ref) => { formats[ref] = format; });
    try {
      const res = await fetch(modelId ? `/api/models/${modelId}` : "/api/models", {
        method: modelId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: modelName, symbol: symbol || null, workspaceId: activeWorkspaceId || null, cells, names, formats, charts,
          templateId: appliedTemplateId, templateVersion: appliedTemplateVersion,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Save failed");
      const saved = await res.json();
      setModelId(saved.id);
      // A PATCH save also records a Time Machine version server-side (see
      // modelRoutes.ts) -- invalidate so the HISTORY modal doesn't show a
      // stale, pre-save list if it's opened right after.
      invalidateModelVersions(saved.id);
      setStatus("Saved.");
    } catch (e: any) {
      setStatus(e?.message || "Save failed.");
    }
  }

  async function handleOpenList() {
    setShowOpen(true);
    try {
      const res = await fetch("/api/models");
      if (res.ok) setModels(await res.json());
    } catch {
      // Leave the list empty -- the modal itself shows "no models" honestly.
    }
  }

  async function handleLoadModel(id: string) {
    const res = await fetch(`/api/models/${id}`);
    if (!res.ok) { setStatus("Failed to load model."); return; }
    const data = await res.json();
    const g = new SpreadsheetGrid();
    // Names before cells (a formula referencing a name needs it already
    // defined to resolve correctly), formats after (pure display metadata,
    // order doesn't matter for them).
    for (const [name, target] of Object.entries((data.names as Record<string, string>) ?? {})) g.defineName(name, target);
    for (const [ref, raw] of Object.entries(data.cells as Record<string, string>)) g.setCell(ref, raw);
    for (const [ref, format] of Object.entries((data.formats as Record<string, string>) ?? {})) g.setFormat(ref, format);
    gridRef.current = g;
    setModelId(data.id);
    setModelName(data.name);
    setCharts((data.charts as ChartConfig[]) ?? []);
    setAppliedTemplateId(data.templateId ?? null);
    setAppliedTemplateVersion(data.templateVersion ?? null);
    setShowOpen(false);
    resetHistory();
    bump();
  }

  function handleNew() {
    gridRef.current = new SpreadsheetGrid();
    setModelId(null);
    setModelName("Untitled Model");
    setSelected("A1");
    setCharts([]);
    setAppliedTemplateId(null);
    setAppliedTemplateVersion(null);
    resetHistory();
    bump();
  }

  // Generic across every registered template (see templateRegistry.ts) --
  // fetches live financials only when the chosen template actually needs
  // them, so adding a new assumption-driven template (like LBO Debt
  // Paydown, which needs no live data at all) never has to touch this
  // function.
  async function handleApplyTemplate(templateId: string) {
    const template = getTemplate(templateId);
    if (!template) return;
    if (template.requiresSymbol && !symbol) {
      setStatus(`Select a ticker first (the active symbol) to seed ${template.label} from its live financials.`);
      return;
    }
    setStatus(template.requiresSymbol ? `Fetching ${symbol} financials...` : `Building ${template.label}...`);
    try {
      let hist: HistoricalStatements | undefined;
      if (template.requiresSymbol) {
        const [income, balance, cashflow] = await Promise.all(
          (["income", "balance", "cashflow"] as const).map(async (reportType) => {
            const res = await fetch(`/api/lse/financials/${symbol}?reportType=${reportType}&period=FY`);
            if (!res.ok) throw new Error(`Failed to fetch ${reportType} statements for ${symbol}`);
            return (await res.json()) as LseFinancialReport[];
          }),
        );
        if (income.length === 0 && balance.length === 0 && cashflow.length === 0) {
          setStatus(`No financial data available for ${symbol} -- nothing to seed the template with.`);
          return;
        }
        hist = { income, balance, cashflow };
      }
      const inputOverrides = getPackOverride(getIndustryPack(selectedIndustryPackId), template.id);
      const cells = template.build({ symbol, hist, inputOverrides });
      const g = new SpreadsheetGrid();
      for (const [ref, raw] of Object.entries(cells)) g.setCell(ref, raw);
      if (template.requiresIterativeCalc) g.setIterativeMode(true);
      gridRef.current = g;
      setModelId(null);
      const packLabel = inputOverrides ? getIndustryPack(selectedIndustryPackId)?.label : undefined;
      setModelName(template.defaultModelName({ symbol, hist }) + (packLabel ? ` (${packLabel})` : ""));
      setSelected("A1");
      setCharts([]);
      setAppliedTemplateId(template.id);
      setAppliedTemplateVersion(template.version);
      resetHistory();
      setShowTemplates(false);
      bump();
      setStatus(template.requiresSymbol
        ? `Seeded from ${symbol}'s live financials -- edit the assumption cells to drive projections.`
        : `${template.label} built -- edit the assumption cells to drive the model.`);
    } catch (e: any) {
      setStatus(e?.message || "Failed to build the template.");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      gridRef.current = await importXlsxToGrid(file);
      setModelId(null);
      setModelName(file.name.replace(/\.xlsx$/i, ""));
      resetHistory();
      bump();
      setStatus(`Imported ${file.name}.`);
    } catch {
      setStatus("Failed to import that file -- is it a valid .xlsx?");
    }
  }

  function handleExport() {
    exportGridToXlsx(gridRef.current, `${modelName.replace(/[^\w-]+/g, "_")}.xlsx`);
  }

  // Output Studio -- a presentation-ready PDF alongside the raw .xlsx,
  // reusing the same PDF exporter every other panel already shares (see
  // gridExport.ts's design note on why this renders as a spreadsheet
  // rather than guessing at semantic sections).
  function handleExportPdf() {
    const filename = `${modelName.replace(/[^\w-]+/g, "_")}.pdf`;
    exportPdfReport(filename, modelName, [gridToExportSheet(gridRef.current, modelName)]);
  }

  // Insert/delete operate relative to the selected cell's row/column --
  // every reference sheet-wide is rewritten to follow whatever moved (see
  // SpreadsheetGrid.insertRows/deleteRows in the engine), same mechanism a
  // real spreadsheet uses for "Insert Row Above" / "Delete Row".
  function insertRowAtSelection() {
    const a = parseCellRef(selected);
    if (!a) return;
    pushUndo();
    gridRef.current.insertRows(a.row, 1);
    bump();
  }
  function deleteRowAtSelection() {
    const a = parseCellRef(selected);
    if (!a) return;
    pushUndo();
    gridRef.current.deleteRows(a.row, 1);
    bump();
  }
  function insertColAtSelection() {
    const a = parseCellRef(selected);
    if (!a) return;
    pushUndo();
    gridRef.current.insertCols(a.col, 1);
    bump();
  }
  function deleteColAtSelection() {
    const a = parseCellRef(selected);
    if (!a) return;
    pushUndo();
    gridRef.current.deleteCols(a.col, 1);
    bump();
  }

  // Applies (or, if every cell in the selection already has this exact
  // format, clears -- toggling) a display format across the whole
  // selection, not just the anchor cell.
  function applyFormat(pattern: string) {
    const range = getSelectedRange();
    const alreadyApplied = range.every((ref) => gridRef.current.getFormat(ref) === pattern);
    pushUndo();
    for (const ref of range) gridRef.current.setFormat(ref, alreadyApplied ? null : pattern);
    bump();
  }

  function defaultNameTarget(): string {
    const range = getSelectedRange();
    if (range.length <= 1) return selected;
    // getSelectedRange() is built in reading order, so the first and last
    // entries are the range's top-left and bottom-right corners.
    return `${range[0]}:${range[range.length - 1]}`;
  }

  function handleDefineName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    const name = newNameInput.trim();
    const target = newNameTarget.trim() || defaultNameTarget();
    try {
      pushUndo();
      gridRef.current.defineName(name, target);
      setNewNameInput("");
      setNewNameTarget("");
      bump();
    } catch (err: any) {
      undoStackRef.current.pop(); // defineName threw -- nothing actually changed, don't leave a no-op undo entry
      setNameError(err?.message || "Invalid name.");
    }
  }

  function handleDeleteName(name: string) {
    pushUndo();
    gridRef.current.deleteName(name);
    bump();
  }

  // Assumption Center -- workspace-scoped shared assumptions, one level up
  // from a model's own local named ranges (see useAssumptions.ts / the
  // server-side design note in assumptionStore.ts). "Import" binds a shared
  // assumption into THIS model as a local name, the same defineName() every
  // local name already goes through -- from that point on it behaves
  // exactly like any other named range, just seeded from the shared value.
  async function handleDefineSharedAssumption(e: React.FormEvent) {
    e.preventDefault();
    setAssumptionError(null);
    if (!activeWorkspaceId) { setAssumptionError("Select an active workspace first -- shared assumptions are scoped to a workspace."); return; }
    const value = Number(newAssumptionValue);
    if (!Number.isFinite(value)) { setAssumptionError("Value must be a number."); return; }
    try {
      await saveSharedAssumption(activeWorkspaceId, newAssumptionName, value);
      invalidateAssumptions(activeWorkspaceId);
      setNewAssumptionName("");
      setNewAssumptionValue("");
    } catch (err: any) {
      setAssumptionError(err?.message || "Failed to save assumption.");
    }
  }

  async function handleDeleteSharedAssumption(name: string) {
    if (!activeWorkspaceId) return;
    await removeSharedAssumption(activeWorkspaceId, name);
    invalidateAssumptions(activeWorkspaceId);
  }

  function handleImportAssumption(name: string, value: number) {
    try {
      pushUndo();
      gridRef.current.defineName(name, String(value));
      bump();
      setStatus(`Imported ${name} = ${value} as a local named range.`);
    } catch (err: any) {
      undoStackRef.current.pop();
      setStatus(err?.message || `Failed to import ${name}.`);
    }
  }

  // Scenario Manager -- a Scenario is a named snapshot of the CURRENT set of
  // shared assumption values for this workspace (see scenarioStore.ts's
  // design note). Saving one doesn't touch the model; applying one imports
  // every assumption in the snapshot into this model as a local named
  // range, the exact same defineName() path a single-assumption Import
  // already uses -- just batched, and as one undo step.
  async function handleSaveScenario(e: React.FormEvent) {
    e.preventDefault();
    setScenarioError(null);
    if (!activeWorkspaceId) { setScenarioError("Select an active workspace first."); return; }
    if (!sharedAssumptions || sharedAssumptions.length === 0) { setScenarioError("No shared assumptions to snapshot yet -- define at least one above first."); return; }
    const values: Record<string, number> = {};
    for (const a of sharedAssumptions) values[a.name] = a.value;
    try {
      await saveScenarioApi(activeWorkspaceId, newScenarioName, values);
      invalidateScenarios(activeWorkspaceId);
      setNewScenarioName("");
    } catch (err: any) {
      setScenarioError(err?.message || "Failed to save scenario.");
    }
  }

  async function handleDeleteScenario(name: string) {
    if (!activeWorkspaceId) return;
    await deleteScenarioApi(activeWorkspaceId, name);
    invalidateScenarios(activeWorkspaceId);
  }

  function handleApplyScenario(scenario: Scenario) {
    try {
      pushUndo();
      for (const [name, value] of Object.entries(scenario.values)) gridRef.current.defineName(name, String(value));
      bump();
      setStatus(`Applied scenario "${scenario.name}" (${Object.keys(scenario.values).length} assumption${Object.keys(scenario.values).length === 1 ? "" : "s"}).`);
    } catch (err: any) {
      undoStackRef.current.pop();
      setStatus(err?.message || `Failed to apply scenario "${scenario.name}".`);
    }
  }

  // Sensitivity / Data Table -- runs entirely through sensitivityEngine.ts
  // against the live grid (it restores the swept input cell(s) itself when
  // done), so this is just parsing the modal's inputs and rendering
  // whatever comes back.
  function handleRunOneWaySensitivity() {
    setSensError(null);
    const input = sensInputRef.trim().toUpperCase();
    const output = sensOutputRef.trim().toUpperCase();
    if (!parseCellRef(input) || !parseCellRef(output)) { setSensError("Input and output must be valid cell references (e.g. C8)."); return; }
    const min = Number(sensMin), max = Number(sensMax), steps = Math.trunc(Number(sensSteps));
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(steps) || steps < 1) { setSensError("Min, max, and steps must be numbers (steps >= 1)."); return; }
    const result = runOneWaySensitivity(gridRef.current, input, buildInputRange(min, max, steps), output);
    setOneWayResult(result);
    bump();
  }

  function handleRunTwoWaySensitivity() {
    setSensError(null);
    const rowInput = sensInputRef.trim().toUpperCase();
    const colInput = sensInputRef2.trim().toUpperCase();
    const output = sensOutputRef.trim().toUpperCase();
    if (!parseCellRef(rowInput) || !parseCellRef(colInput) || !parseCellRef(output)) { setSensError("Both inputs and the output must be valid cell references (e.g. C8)."); return; }
    const rMin = Number(sensMin), rMax = Number(sensMax), rSteps = Math.trunc(Number(sensSteps));
    const cMin = Number(sensMin2), cMax = Number(sensMax2), cSteps = Math.trunc(Number(sensSteps2));
    if ([rMin, rMax, rSteps, cMin, cMax, cSteps].some((n) => !Number.isFinite(n)) || rSteps < 1 || cSteps < 1) {
      setSensError("Min, max, and steps must be numbers (steps >= 1) for both inputs.");
      return;
    }
    const result = runTwoWaySensitivity(gridRef.current, rowInput, buildInputRange(rMin, rMax, rSteps), colInput, buildInputRange(cMin, cMax, cSteps), output);
    setTwoWayResult(result);
    bump();
  }

  function handleRunTornadoSensitivity() {
    setSensError(null);
    const output = sensOutputRef.trim().toUpperCase();
    if (!parseCellRef(output)) { setSensError("Output must be a valid cell reference (e.g. C8)."); return; }
    const inputs: { ref: string; label: string; lowValue: number; highValue: number }[] = [];
    for (const row of tornadoRows) {
      if (!row.ref.trim()) continue;
      const ref = row.ref.trim().toUpperCase();
      const low = Number(row.low), high = Number(row.high);
      if (!parseCellRef(ref) || !Number.isFinite(low) || !Number.isFinite(high)) { setSensError(`Row "${row.ref}" needs a valid cell reference and numeric low/high values.`); return; }
      inputs.push({ ref, label: row.label.trim() || ref, lowValue: low, highValue: high });
    }
    if (inputs.length === 0) { setSensError("Add at least one input row (cell reference + low/high values)."); return; }
    const result = runTornadoSensitivity(gridRef.current, inputs, output);
    setTornadoResult(result);
    bump();
  }

  // Reusable Model Blocks -- inserts a schedule generator's output at the
  // currently selected cell's row/column, the same merge-cells-then-bump
  // pattern every other mutation in this panel already uses. Iterative
  // calc is auto-enabled for blocks that need it (the debt schedule),
  // mirroring how a template with requiresIterativeCalc behaves.
  function defaultBlockFieldValues(block: { fields: { key: string; default?: string }[] }): Record<string, string> {
    const values: Record<string, string> = {};
    for (const f of block.fields) values[f.key] = f.default ?? "";
    return values;
  }

  function handleOpenBlocks() {
    setBlockError(null);
    const block = getBlock(selectedBlockId) ?? BLOCK_REGISTRY[0];
    if (block) { setSelectedBlockId(block.id); setBlockFieldValues(defaultBlockFieldValues(block)); }
    setShowBlocks(true);
  }

  function handleSelectBlock(id: string) {
    setSelectedBlockId(id);
    setBlockError(null);
    const block = getBlock(id);
    if (block) setBlockFieldValues(defaultBlockFieldValues(block));
  }

  function handleInsertBlock() {
    setBlockError(null);
    const block = getBlock(selectedBlockId);
    if (!block) { setBlockError("Pick a block to insert."); return; }
    const anchor = parseCellRef(selected);
    if (!anchor) { setBlockError("Select a valid cell first."); return; }
    pushUndo();
    try {
      const result = block.build(blockFieldValues, { startRow: anchor.row + 1, firstDataCol: anchor.col });
      for (const [ref, raw] of Object.entries(result.cells)) gridRef.current.setCell(ref, raw);
      if (block.requiresIterativeCalc && !gridRef.current.getIterativeMode()) gridRef.current.setIterativeMode(true);
      bump();
      setStatus(`Inserted ${block.label} at ${selected}. ${result.summary}`);
      setShowBlocks(false);
    } catch (err: any) {
      undoStackRef.current.pop();
      setBlockError(err?.message || "Failed to insert block -- check the cell references and row numbers above.");
    }
  }

  // Time Machine -- restoring a version replaces the live grid's content
  // the same way handleLoadModel does (fresh grid, names before cells,
  // formats after), since a version IS a full cells/names/formats snapshot,
  // just one that isn't the model's CURRENT saved state.
  async function handleRestoreVersion(versionId: string) {
    if (!modelId) return;
    try {
      const restored = await restoreModelVersion(modelId, versionId);
      const g = new SpreadsheetGrid();
      for (const [name, target] of Object.entries(restored.names ?? {})) g.defineName(name, target);
      for (const [ref, raw] of Object.entries(restored.cells ?? {})) g.setCell(ref, raw);
      for (const [ref, format] of Object.entries(restored.formats ?? {})) g.setFormat(ref, format);
      gridRef.current = g;
      resetHistory();
      bump();
      invalidateModelVersions(modelId);
      setStatus("Restored a prior version. The state right before this restore was itself saved as a new version.");
      setShowHistory(false);
    } catch (err: any) {
      setStatus(err?.message || "Failed to restore version.");
    }
  }

  function handleOpenChartBuilder() {
    setChartError(null);
    setChartRangeInput(selectionRangeString());
    setChartTitleInput("");
    setShowChartBuilder(true);
  }

  function handleAddChart() {
    setChartError(null);
    try {
      extractChartData(gridRef.current, chartRangeInput); // validates the range before saving a broken chart
      const config: ChartConfig = {
        id: crypto.randomUUID(),
        title: chartTitleInput.trim() || chartRangeInput,
        type: chartTypeInput,
        rangeRef: chartRangeInput.trim().toUpperCase(),
      };
      setCharts((prev) => [...prev, config]);
      setShowChartBuilder(false);
    } catch (err: any) {
      setChartError(err?.message || "Failed to read that range.");
    }
  }

  function handleRemoveChart(id: string) {
    setCharts((prev) => prev.filter((c) => c.id !== id));
  }

  // Component Marketplace -- publish extracts the current selection as an
  // A1-relative fragment (see componentFragment.ts); insert re-shifts a
  // published fragment out to wherever the cursor currently is. Same
  // pushUndo+setCell+bump pattern every other grid mutation in this panel
  // already uses.
  async function handlePublishComponent() {
    setLibraryError(null);
    if (!publishName.trim()) { setLibraryError("Give this component a name."); return; }
    const bounds = getSelectionBounds();
    if (!bounds) { setLibraryError("Select a range on the sheet first."); return; }
    const fragment = extractFragment(gridRef.current, bounds.minCol, bounds.minRow, bounds.maxCol, bounds.maxRow);
    if (Object.keys(fragment).length === 0) { setLibraryError("The selected range is empty -- nothing to publish."); return; }
    setLibraryBusy(true);
    try {
      await publishComponentApi({ name: publishName.trim(), description: publishDescription.trim(), category: publishCategory.trim(), cells: fragment });
      invalidateLibrary();
      setPublishName("");
      setPublishDescription("");
      setPublishCategory("");
      setLibraryTab("browse");
    } catch (err: any) {
      setLibraryError(err?.message || "Failed to publish component.");
    } finally {
      setLibraryBusy(false);
    }
  }

  function handleInsertComponent(component: { name: string; cells: Record<string, string> }) {
    const anchor = parseCellRef(selected);
    if (!anchor) return;
    pushUndo();
    try {
      const cells = insertFragment(component.cells, anchor.col, anchor.row);
      for (const [ref, raw] of Object.entries(cells)) gridRef.current.setCell(ref, raw);
      bump();
      setStatus(`Inserted "${component.name}" at ${selected}.`);
      setShowLibrary(false);
    } catch (err: any) {
      undoStackRef.current.pop();
      setStatus(err?.message || `Failed to insert "${component.name}".`);
    }
  }

  async function handleDeleteComponent(id: string) {
    try {
      await deleteComponentApi(id);
      invalidateLibrary();
    } catch (err: any) {
      setLibraryError(err?.message || "Failed to delete component.");
    }
  }

  const cols = Array.from({ length: DEFAULT_COLS }, (_, i) => colIndexToLetters(i));
  const rows = Array.from({ length: DEFAULT_ROWS }, (_, i) => i + 1);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, ref: string) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(); if (e.shiftKey) moveUp(); else moveDown(); }
    else if (e.key === "Escape") { setIsEditing(false); setEditValue(gridRef.current.getCell(ref).raw); }
  }, [editValue, selected]);

  return (
    <div className="h-full flex flex-col bg-[#050505] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-[#070707] shrink-0 flex-wrap">
        <FileSpreadsheet className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">SPREADSHEET STUDIO</span>
        <input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          className="ml-2 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground w-48 focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        {symbol && <span className="font-terminal text-[7px] text-muted-foreground/70 border border-border/50 px-1.5 py-0.5">{symbol}</span>}
        {appliedTemplateId && (() => {
          const currentTemplate = getTemplate(appliedTemplateId);
          const isStale = !!currentTemplate && !!appliedTemplateVersion && currentTemplate.version > appliedTemplateVersion;
          return (
            <span
              title={isStale ? `This model was built from ${currentTemplate?.label ?? appliedTemplateId} v${appliedTemplateVersion} -- v${currentTemplate?.version} is now available. Re-applying the template gives you the current version (existing cell edits aren't merged automatically).` : `Built from ${currentTemplate?.label ?? appliedTemplateId} v${appliedTemplateVersion}`}
              className={`flex items-center gap-1 font-terminal text-[7px] border px-1.5 py-0.5 ${isStale ? "border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)]" : "border-border/50 text-muted-foreground/70"}`}
            >
              {currentTemplate?.label ?? appliedTemplateId} v{appliedTemplateVersion}
              {isStale && <span className="text-[hsl(38,95%,55%)]">· v{currentTemplate?.version} available</span>}
            </span>
          );
        })()}
        {status && <span className="font-terminal text-[7px] text-muted-foreground/60">{status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={undo} disabled={undoStackRef.current.length === 0} title="Undo (Ctrl/Cmd+Z)" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:border-border/60 disabled:cursor-not-allowed">
            <Undo2 className="w-3 h-3" />
          </button>
          <button onClick={redo} disabled={redoStackRef.current.length === 0} title="Redo (Ctrl/Cmd+Shift+Z)" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:border-border/60 disabled:cursor-not-allowed">
            <Redo2 className="w-3 h-3" />
          </button>
          <button onClick={handleNew} title="New model" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <FilePlus2 className="w-3 h-3" /> NEW
          </button>
          <button onClick={() => setShowTemplates(true)} title="Seed the model from a template" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10">
            <LayoutTemplate className="w-3 h-3" /> TEMPLATES
          </button>
          <button onClick={handleOpenList} title="Open saved model" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <FolderOpen className="w-3 h-3" /> OPEN
          </button>
          <button onClick={() => setShowNames(true)} title="Named ranges -- write =Revenue*TaxRate instead of =C13*$C$8" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Tag className="w-3 h-3" /> NAMES
          </button>
          <button onClick={handleOpenBlocks} title="Reusable Model Blocks -- insert a Debt Schedule or Working Capital Schedule at the selected cell, without building a whole template around it" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Blocks className="w-3 h-3" /> BLOCKS
          </button>
          <button
            onClick={() => { setLibraryError(null); setLibraryTab("browse"); setShowLibrary(true); }}
            title="Component Library -- publish a selected range for any analyst at the firm to reuse, or browse and insert something someone else already published"
            className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]"
          >
            <Library className="w-3 h-3" /> LIBRARY
            {libraryComponents && libraryComponents.length > 0 && (
              <span className="ml-0.5 px-1 bg-[hsl(38,95%,50%)]/20 text-[hsl(38,95%,55%)] rounded-sm">{libraryComponents.length}</span>
            )}
          </button>
          <button
            onClick={() => setShowHistory(true)}
            title={modelId ? "Time Machine -- every save is automatically kept as a version you can jump back to" : "Save this model at least once to start recording its version history"}
            disabled={!modelId}
            className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border/60"
          >
            <History className="w-3 h-3" /> HISTORY
            {modelVersions && modelVersions.length > 0 && (
              <span className="ml-0.5 px-1 bg-[hsl(38,95%,50%)]/20 text-[hsl(38,95%,55%)] rounded-sm">{modelVersions.length}</span>
            )}
          </button>
          <button onClick={() => setShowAssumptions(true)} title="Assumption Center -- shared assumptions (WACC, tax rate, ...) scoped to the active workspace, so every model in the deal uses the same number" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Layers className="w-3 h-3" /> ASSUMPTIONS
            {sharedAssumptions && sharedAssumptions.length > 0 && (
              <span className="ml-0.5 px-1 bg-[hsl(38,95%,50%)]/20 text-[hsl(38,95%,55%)] rounded-sm">{sharedAssumptions.length}</span>
            )}
          </button>
          <button onClick={handleOpenChartBuilder} title="Chart Builder -- turn a range on this sheet into a bar/line/pie chart, re-rendered live from the sheet's own values" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <BarChart3 className="w-3 h-3" /> CHART
          </button>
          <button
            onClick={() => setShowDashboard(true)}
            title="Dashboard -- every chart saved on this model, laid out together"
            disabled={charts.length === 0}
            className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border/60"
          >
            <LayoutDashboard className="w-3 h-3" /> DASHBOARD
            {charts.length > 0 && <span className="ml-0.5 px-1 bg-[hsl(38,95%,50%)]/20 text-[hsl(38,95%,55%)] rounded-sm">{charts.length}</span>}
          </button>
          <button
            onClick={() => { setSensOutputRef(selected); setShowSensitivity(true); }}
            title="Sensitivity / Data Table -- sweep one or two input cells across a range of values and see how an output cell responds, or rank several inputs by their impact on an output (tornado)"
            className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]"
          >
            <Sliders className="w-3 h-3" /> SENSITIVITY
          </button>
          <button
            onClick={() => setShowAudit((v) => !v)}
            title="Trace which cells feed the selected one and which cells depend on it, and list every flagged/error cell on the sheet"
            className={`flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border ${
              showAudit ? "border-[hsl(38,95%,50%)]/60 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]"
            }`}
          >
            <Search className="w-3 h-3" /> AUDIT
            {gridRef.current.getErrorCells().length > 0 && (
              <span className="ml-0.5 px-1 bg-red-500/20 text-red-400 rounded-sm">{gridRef.current.getErrorCells().length}</span>
            )}
          </button>
          <button
            onClick={() => { gridRef.current.setIterativeMode(!gridRef.current.getIterativeMode()); bump(); }}
            title="Iterative calculation -- lets a genuinely circular formula (e.g. an LBO debt schedule where interest depends on the average of beginning/ending balance) converge to a number instead of failing as #CIRCULAR!. Off by default so an accidental circular reference still fails loudly."
            className={`flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border ${
              gridRef.current.getIterativeMode() ? "border-[hsl(38,95%,50%)]/60 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]"
            }`}
          >
            <RefreshCw className="w-3 h-3" /> ITERATIVE CALC
          </button>
          <button onClick={handleSave} title="Save model" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Save className="w-3 h-3" /> SAVE
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="Import .xlsx" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Upload className="w-3 h-3" /> IMPORT
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleImport} />
          <button onClick={handleExport} title="Export .xlsx" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <Download className="w-3 h-3" /> XLSX
          </button>
          <button onClick={handleExportPdf} title="Export a presentation-ready PDF of this sheet -- titled, paginated, using each cell's display format" className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">
            <FileDown className="w-3 h-3" /> PDF
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-[#060606] shrink-0">
        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold w-12">{selected}</span>
        <input
          ref={formulaBarRef}
          value={isEditing ? editValue : gridRef.current.getCell(selected).raw}
          onFocus={() => setIsEditing(true)}
          onChange={(e) => { setIsEditing(true); setEditValue(e.target.value); }}
          onKeyDown={(e) => handleCellKeyDown(e, selected)}
          onBlur={() => commitEdit()}
          placeholder="Enter a value or formula (e.g. =SUM(A1:A5))"
          className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[10px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
        />
        {isMultiCellRange && (
          <>
            <button
              onClick={() => fillDirection("down")}
              title="Fill the top cell of the selected range down through the rest -- relative references shift per row, $-anchored references stay fixed"
              className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
            >
              <ArrowDown className="w-3 h-3" /> FILL DOWN
            </button>
            <button
              onClick={() => fillDirection("right")}
              title="Fill the left cell of the selected range right through the rest -- relative references shift per column, $-anchored references stay fixed"
              className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
            >
              <ArrowRight className="w-3 h-3" /> FILL RIGHT
            </button>
          </>
        )}
        <div className="flex items-center gap-1 border-l border-border/50 pl-2">
          {FORMAT_PRESETS.map(({ label, pattern, icon: Icon }) => {
            const active = pattern !== null && selectedRange.every((ref) => gridRef.current.getFormat(ref) === pattern);
            return (
              <button
                key={label}
                onClick={() => pattern && applyFormat(pattern)}
                title={`${label} format (click again to clear) -- applies to the whole selection`}
                className={`p-1 border ${active ? "border-[hsl(38,95%,50%)]/60 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]"}`}
              >
                <Icon className="w-3 h-3" />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 border-l border-border/50 pl-2">
          <button onClick={insertRowAtSelection} title={`Insert a row above ${selected} -- every reference sheet-wide shifts to follow`} className="font-terminal text-[8px] tracking-widest px-1.5 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">+ROW</button>
          <button onClick={deleteRowAtSelection} title={`Delete ${selected}'s row -- anything referencing it becomes #REF!, everything else shifts to follow`} className="font-terminal text-[8px] tracking-widest px-1.5 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-red-500/50">-ROW</button>
          <button onClick={insertColAtSelection} title={`Insert a column left of ${selected} -- every reference sheet-wide shifts to follow`} className="font-terminal text-[8px] tracking-widest px-1.5 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%]">+COL</button>
          <button onClick={deleteColAtSelection} title={`Delete ${selected}'s column -- anything referencing it becomes #REF!, everything else shifts to follow`} className="font-terminal text-[8px] tracking-widest px-1.5 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-red-500/50">-COL</button>
        </div>
        <span className="font-terminal text-[7px] text-muted-foreground/50" title="F2 edit cell · Esc collapse range selection · Ctrl/Cmd+Home jump to A1 · Ctrl/Cmd+End jump to the used range's corner · Ctrl/Cmd+A select the used range · Shift+Enter move up">
          SHIFT+CLICK OR SHIFT+ARROWS TO SELECT A RANGE · ARROWS/TAB TO NAVIGATE · F2 TO EDIT · CTRL+HOME/END TO JUMP · CTRL+C/V TO COPY-PASTE · CTRL+Z TO UNDO
        </span>
        <span className="ml-auto flex items-center gap-2.5 font-terminal text-[7px] text-muted-foreground/60" title="Standard IB modeling convention: blue is safe to overtype, black is calculated -- trace it instead of overtyping it">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[hsl(207,80%,68%)]" />INPUT</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-foreground/80" />FORMULA</span>
        </span>
      </div>

      {showAudit && (
        <>
        <div className="flex items-start gap-5 px-3 py-2 border-b border-border/50 bg-[#060606] shrink-0 font-terminal text-[8px] flex-wrap">
          <div className="min-w-[160px]">
            <div className="text-muted-foreground/70 tracking-widest mb-1">PRECEDENTS OF {selected} (feeds into it)</div>
            {gridRef.current.getPrecedents(selected).length === 0 ? (
              <span className="text-muted-foreground/50">none -- this is a leaf value</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {gridRef.current.getPrecedents(selected).map((ref) => (
                  <button key={ref} onClick={() => { setSelected(ref); setRangeEnd(null); }} className="px-1.5 py-0.5 border border-border/60 text-foreground/80 hover:border-[hsl(38,95%,50%)]/50 hover:text-[hsl(38,95%,55%)]">{ref}</button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-[160px]">
            <div className="text-muted-foreground/70 tracking-widest mb-1">DEPENDENTS OF {selected} (relies on it)</div>
            {gridRef.current.getDependents(selected).length === 0 ? (
              <span className="text-muted-foreground/50">none -- nothing downstream references this cell</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {gridRef.current.getDependents(selected).map((ref) => (
                  <button key={ref} onClick={() => { setSelected(ref); setRangeEnd(null); }} className="px-1.5 py-0.5 border border-border/60 text-foreground/80 hover:border-[hsl(38,95%,50%)]/50 hover:text-[hsl(38,95%,55%)]">{ref}</button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-muted-foreground/70 tracking-widest mb-1">FLAGGED CELLS ({gridRef.current.getErrorCells().length})</div>
            {gridRef.current.getErrorCells().length === 0 ? (
              <span className="text-up">no errors on this sheet</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {gridRef.current.getErrorCells().map(({ ref, error }) => (
                  <button key={ref} onClick={() => { setSelected(ref); setRangeEnd(null); }} className="flex items-center gap-1 px-1.5 py-0.5 border border-red-500/40 text-red-400 hover:bg-red-500/10">
                    <span className="font-bold">{ref}</span><span className="text-red-400/70">{error}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-[200px]">
            {(() => {
              const health = computeModelHealthScore(gridRef.current);
              const color = health.score >= 90 ? "text-up" : health.score >= 75 ? "text-[hsl(38,95%,55%)]" : health.score >= 50 ? "text-orange-400" : "text-red-400";
              return (
                <>
                  <div className="text-muted-foreground/70 tracking-widest mb-1">MODEL HEALTH SCORE</div>
                  <div className="flex items-center gap-2">
                    <span className={`font-bold text-[14px] ${color}`}>{health.score}</span>
                    <span className={`${color}`}>{health.label}</span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-muted-foreground/80 max-w-[420px]">
                    {health.findings.map((f, i) => <div key={i}>{f}</div>)}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-border/50 bg-[#060606] shrink-0 font-terminal text-[8px]">
          <div className="text-muted-foreground/70 tracking-widest mb-1.5">DEPENDENCY GRAPH -- {selected} (up to 2 hops each direction)</div>
          {(() => {
            const graph = buildDependencyGraph(gridRef.current, selected, 2);
            if (graph.precedentLayers.length === 0 && graph.dependentLayers.length === 0) {
              return <span className="text-muted-foreground/50">{selected} has no precedents or dependents -- it's an isolated cell.</span>;
            }
            const columns = [...graph.precedentLayers].reverse().map((nodes, i) => ({ label: `-${graph.precedentLayers.length - i} hop${graph.precedentLayers.length - i === 1 ? "" : "s"}`, nodes }))
              .concat([{ label: selected, nodes: [{ ref: selected, hasError: !!gridRef.current.getCell(selected).error }] }])
              .concat(graph.dependentLayers.map((nodes, i) => ({ label: `+${i + 1} hop${i + 1 === 1 ? "" : "s"}`, nodes })));
            return (
              <div className="flex items-start gap-4 overflow-x-auto scrollbar-thin pb-1">
                {columns.map((col, ci) => (
                  <div key={ci} className="min-w-[90px] shrink-0">
                    <div className="text-muted-foreground/50 mb-1">{col.label}</div>
                    <div className="space-y-1">
                      {col.nodes.map((n) => (
                        <button
                          key={n.ref}
                          onClick={() => { setSelected(n.ref); setRangeEnd(null); }}
                          className={`block w-full text-left px-1.5 py-0.5 border ${
                            n.ref === selected ? "border-[hsl(38,95%,50%)]/60 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" :
                            n.hasError ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-border/60 text-foreground/80 hover:border-[hsl(38,95%,50%)]/50 hover:text-[hsl(38,95%,55%)]"
                          }`}
                        >
                          {n.ref}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        <div className="px-3 py-2 border-b border-border/50 bg-[#060606] shrink-0 font-terminal text-[8px]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-muted-foreground/70 tracking-widest">CALCULATION PERFORMANCE</span>
            <button
              onClick={() => setPerfReport(analyzeCalculationPerformance(gridRef.current))}
              className="font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground"
            >
              RUN ANALYSIS
            </button>
          </div>
          {!perfReport ? (
            <span className="text-muted-foreground/50">Measures a cold full-rebuild cost and, for every formula cell, how long re-setting it (and cascading to its dependents) takes right now -- click RUN ANALYSIS.</span>
          ) : (
            <div className="flex items-start gap-5 flex-wrap">
              <div>
                <div className="text-muted-foreground/60">{perfReport.totalCells} cells, {perfReport.formulaCells} formulas</div>
                <div className="text-foreground/90">Full rebuild: <span className="font-bold">{perfReport.fullRebuildMs.toFixed(2)}ms</span></div>
                <div className="text-foreground/90">Avg edit cascade: <span className="font-bold">{perfReport.averageCascadeMs.toFixed(3)}ms</span></div>
              </div>
              <div className="min-w-[220px]">
                <div className="text-muted-foreground/60 mb-1">SLOWEST CELLS TO EDIT</div>
                {perfReport.slowestEdits.length === 0 ? (
                  <span className="text-muted-foreground/50">no formula cells on this sheet</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {perfReport.slowestEdits.map((t) => (
                      <button key={t.ref} onClick={() => { setSelected(t.ref); setRangeEnd(null); }} className="px-1.5 py-0.5 border border-border/60 text-foreground/80 hover:border-[hsl(38,95%,50%)]/50 hover:text-[hsl(38,95%,55%)]">
                        {t.ref} <span className="text-muted-foreground/60">{t.ms.toFixed(3)}ms</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </>
      )}

      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="border-collapse font-terminal text-[9px]">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr>
              <th className="w-10 border border-border/40 bg-[#0a0a0a] sticky left-0 z-20" />
              {cols.map((c) => (
                <th key={c} className="w-24 border border-border/40 text-muted-foreground font-normal py-1 px-1">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="border border-border/40 bg-[#0a0a0a] text-muted-foreground text-center sticky left-0 z-10 w-10">{r}</td>
                {cols.map((c) => {
                  const ref = `${c}${r}`;
                  const cell = gridRef.current.getCell(ref);
                  const isSelected = ref === selected;
                  return (
                    <td
                      key={ref}
                      onClick={(e) => {
                        if (e.shiftKey) { setRangeEnd(ref); return; }
                        if (isEditing) commitEdit();
                        setSelected(ref);
                        setRangeEnd(null);
                      }}
                      onDoubleClick={() => { setSelected(ref); setRangeEnd(null); setIsEditing(true); requestAnimationFrame(() => formulaBarRef.current?.focus()); }}
                      className={`border px-1.5 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-[9rem] cursor-cell ${
                        isSelected
                          ? "border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)]/10"
                          : selectedRange.includes(ref)
                            ? "border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/5"
                            : "border-border/30"
                      } ${getCellColorClass(cell.raw, cell.value, cell.error)} ${
                        typeof cell.value === "number" ? "text-right" : "text-left"
                      }`}
                    >
                      {formatCellValue(cell.value, cell.error, gridRef.current.getFormat(ref))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[70vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">OPEN MODEL</span>
              <button onClick={() => setShowOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {models.length === 0 ? (
                <div className="p-4 font-terminal text-[9px] text-muted-foreground">No saved models yet.</div>
              ) : (
                models.map((m) => (
                  <button key={m.id} onClick={() => handleLoadModel(m.id)} className="w-full text-left px-4 py-2.5 border-b border-border/20 hover:bg-white/[3%]">
                    <div className="font-terminal text-[9px] text-foreground">{m.name}</div>
                    <div className="font-terminal text-[7px] text-muted-foreground/60 mt-0.5">{m.symbol ? `${m.symbol} · ` : ""}{new Date(m.updatedAt).toLocaleString()}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showTemplates && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[70vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">TEMPLATES</span>
              <button onClick={() => setShowTemplates(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 py-2 border-b border-border/50 shrink-0">
              <div className="font-terminal text-[7px] text-muted-foreground/60 tracking-widest mb-1.5">INDUSTRY PACK (optional -- overrides a template's default assumptions with industry-typical ones)</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setSelectedIndustryPackId("")}
                  className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                    selectedIndustryPackId === "" ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  GENERIC
                </button>
                {INDUSTRY_PACKS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedIndustryPackId(p.id)}
                    title={p.description}
                    className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                      selectedIndustryPackId === p.id ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {Object.entries(
                TEMPLATE_REGISTRY.reduce<Record<string, typeof TEMPLATE_REGISTRY>>((acc, t) => {
                  (acc[t.category] ??= []).push(t);
                  return acc;
                }, {}),
              ).map(([category, templates]) => (
                <div key={category}>
                  <div className="px-4 py-1.5 font-terminal text-[7px] text-muted-foreground/60 tracking-widest bg-[#0a0a0a] border-b border-border/40">{category.toUpperCase()}</div>
                  {templates.map((t) => {
                    const packOverride = getPackOverride(getIndustryPack(selectedIndustryPackId), t.id);
                    return (
                      <button key={t.id} onClick={() => handleApplyTemplate(t.id)} className="w-full text-left px-4 py-2.5 border-b border-border/20 hover:bg-white/[3%]">
                        <div className="flex items-center gap-2">
                          <span className="font-terminal text-[9px] text-foreground font-bold">{t.label}</span>
                          {t.requiresSymbol && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)] border border-[hsl(38,95%,50%)]/40 px-1 py-0.5">NEEDS ACTIVE SYMBOL</span>}
                          {t.requiresIterativeCalc && <span className="font-terminal text-[7px] text-muted-foreground border border-border/50 px-1 py-0.5">CIRCULAR</span>}
                          {packOverride && <span className="font-terminal text-[7px] text-[hsl(38,95%,55%)] border border-[hsl(38,95%,50%)]/40 px-1 py-0.5">{getIndustryPack(selectedIndustryPackId)?.label.toUpperCase()} ASSUMPTIONS</span>}
                        </div>
                        <div className="font-terminal text-[8px] text-muted-foreground/70 mt-1 leading-relaxed">{t.description}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showNames && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[70vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">NAMED RANGES</span>
              <button onClick={() => setShowNames(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleDefineName} className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/50 shrink-0">
              <input
                value={newNameInput}
                onChange={(e) => setNewNameInput(e.target.value)}
                placeholder="Name (e.g. TaxRate)"
                className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
              <input
                value={newNameTarget}
                onChange={(e) => setNewNameTarget(e.target.value)}
                placeholder={`Target (default: ${defaultNameTarget()})`}
                className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
              />
              <button type="submit" disabled={!newNameInput.trim()} className="font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-40 disabled:cursor-not-allowed">
                DEFINE
              </button>
            </form>
            {nameError && <div className="px-4 py-1.5 font-terminal text-[8px] text-red-400 border-b border-border/50">{nameError}</div>}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {gridRef.current.getNames().size === 0 ? (
                <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                  No named ranges yet. Select a cell or shift+click a range, then define a name -- formulas can reference it by name instead of by cell address.
                </div>
              ) : (
                Array.from(gridRef.current.getNames().entries()).map(([name, target]) => (
                  <div key={name} className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                    <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold w-32 truncate">{name}</span>
                    <span className="font-terminal text-[9px] text-muted-foreground flex-1">{target}</span>
                    <button onClick={() => handleDeleteName(name)} title="Delete this name" className="text-muted-foreground hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showAssumptions && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[70vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">ASSUMPTION CENTER</span>
              <button onClick={() => setShowAssumptions(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {!activeWorkspaceId ? (
              <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                No active workspace selected. Shared assumptions are scoped to a workspace (a deal/client engagement) -- pick one from the Workspaces panel first, so every model in that engagement can share the same WACC, tax rate, and so on.
              </div>
            ) : (
              <>
                <form onSubmit={handleDefineSharedAssumption} className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/50 shrink-0">
                  <input
                    value={newAssumptionName}
                    onChange={(e) => setNewAssumptionName(e.target.value)}
                    placeholder="Name (e.g. WACC)"
                    className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                  />
                  <input
                    value={newAssumptionValue}
                    onChange={(e) => setNewAssumptionValue(e.target.value)}
                    placeholder="Value (e.g. 8.5)"
                    className="w-32 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                  />
                  <button type="submit" disabled={!newAssumptionName.trim() || !newAssumptionValue.trim()} className="font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-40 disabled:cursor-not-allowed">
                    SAVE
                  </button>
                </form>
                {assumptionError && <div className="px-4 py-1.5 font-terminal text-[8px] text-red-400 border-b border-border/50">{assumptionError}</div>}
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {!sharedAssumptions || sharedAssumptions.length === 0 ? (
                    <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                      No shared assumptions yet for this workspace. Define one above -- every model in this workspace can import it as a local named range with one click.
                    </div>
                  ) : (
                    sharedAssumptions.map((a) => (
                      <div key={a.name} className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold w-28 truncate">{a.name}</span>
                        <span className="font-terminal text-[9px] text-foreground flex-1 tabular-nums">{a.value}</span>
                        <button
                          onClick={() => handleImportAssumption(a.name, a.value)}
                          title={`Import ${a.name} into this model as a local named range`}
                          className="font-terminal text-[7px] tracking-widest px-1.5 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
                        >
                          IMPORT
                        </button>
                        <button onClick={() => handleDeleteSharedAssumption(a.name)} title="Delete this shared assumption" className="text-muted-foreground hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}

                  <div className="flex items-center gap-2 px-4 py-2 border-t border-b border-border/50 bg-white/[2%]">
                    <span className="panel-label">SCENARIOS</span>
                    <span className="font-terminal text-[7px] text-muted-foreground/60">named snapshots of the values above</span>
                  </div>
                  <form onSubmit={handleSaveScenario} className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/50">
                    <input
                      value={newScenarioName}
                      onChange={(e) => setNewScenarioName(e.target.value)}
                      placeholder="Scenario name (e.g. Upside Case)"
                      className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                    />
                    <button type="submit" disabled={!newScenarioName.trim()} title="Snapshot every shared assumption above, under this scenario name" className="font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-40 disabled:cursor-not-allowed">
                      SAVE CURRENT
                    </button>
                  </form>
                  {scenarioError && <div className="px-4 py-1.5 font-terminal text-[8px] text-red-400 border-b border-border/50">{scenarioError}</div>}
                  {!scenarios || scenarios.length === 0 ? (
                    <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                      No scenarios saved yet. Set your assumption values above, then "Save Current" to name that combination (e.g. Base Case, Upside, Downside) for one-click switching later.
                    </div>
                  ) : (
                    scenarios.map((s) => (
                      <div key={s.name} className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold flex-1 truncate">{s.name}</span>
                        <span className="font-terminal text-[7px] text-muted-foreground/60">{Object.keys(s.values).length} assumption{Object.keys(s.values).length === 1 ? "" : "s"}</span>
                        <button
                          onClick={() => handleApplyScenario(s)}
                          title={`Apply "${s.name}" -- imports every assumption in this snapshot into this model`}
                          className="font-terminal text-[7px] tracking-widest px-1.5 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
                        >
                          APPLY
                        </button>
                        <button onClick={() => handleDeleteScenario(s.name)} title="Delete this scenario" className="text-muted-foreground hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showSensitivity && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl max-h-[80vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">SENSITIVITY / DATA TABLE</span>
              <button onClick={() => setShowSensitivity(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/50 shrink-0">
              {(["one", "two", "tornado"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setSensMode(m)}
                  className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                    sensMode === m ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "one" ? "ONE-WAY" : m === "two" ? "TWO-WAY" : "TORNADO"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-terminal text-[8px] text-muted-foreground w-24 shrink-0">Output cell</span>
                <input value={sensOutputRef} onChange={(e) => setSensOutputRef(e.target.value)} placeholder="e.g. C25" className="w-28 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                <span className="font-terminal text-[7px] text-muted-foreground/50">defaults to the currently selected cell</span>
              </div>

              {sensMode === "one" && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-24 shrink-0">Input cell</span>
                    <input value={sensInputRef} onChange={(e) => setSensInputRef(e.target.value)} placeholder="e.g. C8" className="w-28 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground ml-2">Min</span>
                    <input value={sensMin} onChange={(e) => setSensMin(e.target.value)} className="w-20 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Max</span>
                    <input value={sensMax} onChange={(e) => setSensMax(e.target.value)} className="w-20 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Steps</span>
                    <input value={sensSteps} onChange={(e) => setSensSteps(e.target.value)} className="w-16 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  <button onClick={handleRunOneWaySensitivity} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold">RUN</button>
                  {sensError && <div className="font-terminal text-[8px] text-red-400">{sensError}</div>}
                  {oneWayResult && (
                    <div className="border border-border/50 overflow-x-auto">
                      <table className="w-full font-terminal text-[8px] tabular-nums">
                        <thead><tr className="border-b border-border/50"><th className="text-left px-2 py-1 text-muted-foreground">{sensInputRef.toUpperCase()}</th><th className="text-left px-2 py-1 text-muted-foreground">{sensOutputRef.toUpperCase()}</th></tr></thead>
                        <tbody>
                          {oneWayResult.inputValues.map((v, i) => (
                            <tr key={i} className="border-b border-border/20">
                              <td className="px-2 py-1 text-foreground">{Number(v.toFixed(4))}</td>
                              <td className={`px-2 py-1 ${oneWayResult.outputs[i].error ? "text-red-400" : "text-[hsl(38,95%,55%)]"}`}>
                                {oneWayResult.outputs[i].error ?? (typeof oneWayResult.outputs[i].value === "number" ? Number((oneWayResult.outputs[i].value as number).toFixed(4)) : oneWayResult.outputs[i].value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {sensMode === "two" && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-24 shrink-0">Row input</span>
                    <input value={sensInputRef} onChange={(e) => setSensInputRef(e.target.value)} placeholder="e.g. C8" className="w-24 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Min</span>
                    <input value={sensMin} onChange={(e) => setSensMin(e.target.value)} className="w-16 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Max</span>
                    <input value={sensMax} onChange={(e) => setSensMax(e.target.value)} className="w-16 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Steps</span>
                    <input value={sensSteps} onChange={(e) => setSensSteps(e.target.value)} className="w-14 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-24 shrink-0">Col input</span>
                    <input value={sensInputRef2} onChange={(e) => setSensInputRef2(e.target.value)} placeholder="e.g. C9" className="w-24 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Min</span>
                    <input value={sensMin2} onChange={(e) => setSensMin2(e.target.value)} className="w-16 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Max</span>
                    <input value={sensMax2} onChange={(e) => setSensMax2(e.target.value)} className="w-16 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                    <span className="font-terminal text-[8px] text-muted-foreground">Steps</span>
                    <input value={sensSteps2} onChange={(e) => setSensSteps2(e.target.value)} className="w-14 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  <button onClick={handleRunTwoWaySensitivity} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold">RUN</button>
                  {sensError && <div className="font-terminal text-[8px] text-red-400">{sensError}</div>}
                  {twoWayResult && (
                    <div className="border border-border/50 overflow-x-auto">
                      <table className="w-full font-terminal text-[8px] tabular-nums">
                        <thead>
                          <tr className="border-b border-border/50">
                            <th className="text-left px-2 py-1 text-muted-foreground">{sensInputRef.toUpperCase()} \ {sensInputRef2.toUpperCase()}</th>
                            {twoWayResult.colValues.map((cv, j) => <th key={j} className="text-left px-2 py-1 text-muted-foreground">{Number(cv.toFixed(2))}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {twoWayResult.rowValues.map((rv, i) => (
                            <tr key={i} className="border-b border-border/20">
                              <td className="px-2 py-1 text-foreground">{Number(rv.toFixed(2))}</td>
                              {twoWayResult.outputs[i].map((cell, j) => (
                                <td key={j} className={`px-2 py-1 ${cell.error ? "text-red-400" : "text-[hsl(38,95%,55%)]"}`}>
                                  {cell.error ?? (typeof cell.value === "number" ? Number(cell.value.toFixed(4)) : cell.value)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {sensMode === "tornado" && (
                <>
                  {tornadoRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={row.label} onChange={(e) => setTornadoRows((rows) => rows.map((r, idx) => idx === i ? { ...r, label: e.target.value } : r))} placeholder="Label" className="w-28 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                      <input value={row.ref} onChange={(e) => setTornadoRows((rows) => rows.map((r, idx) => idx === i ? { ...r, ref: e.target.value } : r))} placeholder="Cell (e.g. C8)" className="w-24 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                      <span className="font-terminal text-[8px] text-muted-foreground">Low</span>
                      <input value={row.low} onChange={(e) => setTornadoRows((rows) => rows.map((r, idx) => idx === i ? { ...r, low: e.target.value } : r))} className="w-20 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                      <span className="font-terminal text-[8px] text-muted-foreground">High</span>
                      <input value={row.high} onChange={(e) => setTornadoRows((rows) => rows.map((r, idx) => idx === i ? { ...r, high: e.target.value } : r))} className="w-20 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                      <button onClick={() => setTornadoRows((rows) => rows.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button onClick={() => setTornadoRows((rows) => [...rows, { ref: "", label: "", low: "", high: "" }])} className="flex items-center gap-1 font-terminal text-[7px] tracking-widest px-2 py-1 border border-border text-muted-foreground hover:text-foreground">
                    <Plus className="w-2.5 h-2.5" /> ADD INPUT
                  </button>
                  <div>
                    <button onClick={handleRunTornadoSensitivity} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold">RUN</button>
                  </div>
                  {sensError && <div className="font-terminal text-[8px] text-red-400">{sensError}</div>}
                  {tornadoResult && (
                    <div className="border border-border/50">
                      {tornadoResult.map((r) => {
                        const maxSwing = Math.max(...tornadoResult.map((x) => Number.isNaN(x.swing) ? 0 : x.swing), 1e-9);
                        const widthPct = Number.isNaN(r.swing) ? 0 : Math.max(2, (r.swing / maxSwing) * 100);
                        return (
                          <div key={r.ref} className="flex items-center gap-2 px-2 py-1.5 border-b border-border/20">
                            <span className="font-terminal text-[8px] text-foreground w-24 truncate">{r.label}</span>
                            <div className="flex-1 h-3 bg-white/[4%] relative">
                              <div className="h-full bg-[hsl(38,95%,50%)]/50" style={{ width: `${widthPct}%` }} />
                            </div>
                            <span className="font-terminal text-[7px] text-muted-foreground w-32 text-right tabular-nums">
                              {Number.isNaN(r.swing) ? "error" : `${r.low.value} → ${r.high.value}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showBlocks && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[80vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">INSERT MODEL BLOCK</span>
              <button onClick={() => setShowBlocks(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/50 shrink-0 flex-wrap">
              {BLOCK_REGISTRY.map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleSelectBlock(b.id)}
                  className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                    selectedBlockId === b.id ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              {(() => {
                const block = getBlock(selectedBlockId);
                if (!block) return null;
                return (
                  <>
                    <div className="font-terminal text-[8px] text-muted-foreground/80">{block.description}</div>
                    <div className="font-terminal text-[8px] text-muted-foreground">
                      Inserting at <span className="text-[hsl(38,95%,55%)]">{selected}</span> (the block's title lands on this cell's row, column onward).
                      {block.requiresIterativeCalc && <span className="text-muted-foreground/70"> Iterative calculation will be turned on automatically.</span>}
                    </div>
                    <div className="space-y-2">
                      {block.fields.map((f) => (
                        <div key={f.key} className="flex items-center gap-2">
                          <span className="font-terminal text-[8px] text-muted-foreground w-64 shrink-0">{f.label}</span>
                          <input
                            value={blockFieldValues[f.key] ?? ""}
                            onChange={(e) => setBlockFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                          />
                        </div>
                      ))}
                    </div>
                    {blockError && <div className="font-terminal text-[8px] text-red-400">{blockError}</div>}
                    <button onClick={handleInsertBlock} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold">
                      INSERT AT {selected}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[70vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">TIME MACHINE</span>
              <button onClick={() => setShowHistory(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 py-2 border-b border-border/50 font-terminal text-[8px] text-muted-foreground/80 shrink-0">
              Every SAVE keeps the sheet's prior state as a version, automatically -- up to the 20 most recent per model. Restoring one also saves whatever was on the sheet right before, so a restore is never a one-way trip.
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {!modelVersions || modelVersions.length === 0 ? (
                <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                  No saved versions yet -- SAVE this model at least once, and every save after that gets kept here.
                </div>
              ) : (
                modelVersions.map((v, i) => (
                  <div key={v.id} className="flex items-center gap-2 px-4 py-2 border-b border-border/20">
                    <span className="font-terminal text-[9px] text-foreground flex-1">{new Date(v.savedAt).toLocaleString()}</span>
                    {i === 0 && <span className="font-terminal text-[6.5px] tracking-widest text-[hsl(38,95%,55%)]/80 border border-[hsl(38,95%,50%)]/25 px-1">MOST RECENT</span>}
                    <button
                      onClick={() => handleRestoreVersion(v.id)}
                      title="Restore this version -- overwrites the sheet's current cells/names/formats"
                      className="font-terminal text-[7px] tracking-widest px-1.5 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
                    >
                      RESTORE
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showChartBuilder && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[80vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">CHART BUILDER</span>
              <button onClick={() => setShowChartBuilder(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-terminal text-[8px] text-muted-foreground w-16 shrink-0">Range</span>
                <input
                  value={chartRangeInput}
                  onChange={(e) => setChartRangeInput(e.target.value)}
                  placeholder="e.g. A3:E7 -- top row = series names, left column = labels"
                  className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-terminal text-[8px] text-muted-foreground w-16 shrink-0">Title</span>
                <input
                  value={chartTitleInput}
                  onChange={(e) => setChartTitleInput(e.target.value)}
                  placeholder="Defaults to the range"
                  className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                />
              </div>
              <div className="flex items-center gap-1.5">
                {(["bar", "line", "pie"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartTypeInput(t)}
                    className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                      chartTypeInput === t ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              {chartError && <div className="font-terminal text-[8px] text-red-400">{chartError}</div>}
              <div className="h-56 border border-border/50 bg-[#050505]">
                {chartRangeInput.trim()
                  ? renderChartBody({ id: "preview", title: chartTitleInput || chartRangeInput, type: chartTypeInput, rangeRef: chartRangeInput }, gridRef.current)
                  : <div className="flex items-center justify-center h-full font-terminal text-[8px] text-muted-foreground/50">Enter a range to preview</div>}
              </div>
              <button onClick={handleAddChart} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold">
                ADD TO DASHBOARD
              </button>
            </div>
          </div>
        </div>
      )}

      {showDashboard && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl max-h-[85vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">DASHBOARD</span>
              <span className="font-terminal text-[7px] text-muted-foreground/60">{modelName}</span>
              <button onClick={() => setShowDashboard(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
              {charts.map((c) => (
                <div key={c.id} className="border border-border/50 bg-[#050505] flex flex-col h-64">
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border/40 shrink-0">
                    <span className="font-terminal text-[8px] text-foreground truncate flex-1">{c.title}</span>
                    <span className="font-terminal text-[6.5px] tracking-widest text-muted-foreground/50 border border-border/40 px-1">{c.type.toUpperCase()}</span>
                    <button onClick={() => handleRemoveChart(c.id)} title="Remove from dashboard" className="text-muted-foreground hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <div className="flex-1 min-h-0 p-1">{renderChartBody(c, gridRef.current)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLibrary && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-lg max-h-[80vh] bg-[#070707] border border-border flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
              <span className="panel-label">COMPONENT LIBRARY</span>
              <span className="font-terminal text-[7px] text-muted-foreground/60">firm-wide -- published by any analyst, insertable by any analyst</span>
              <button onClick={() => setShowLibrary(false)} className="ml-auto text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/50 shrink-0">
              {(["browse", "publish"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setLibraryTab(t); setLibraryError(null); }}
                  className={`font-terminal text-[7px] tracking-widest px-2 py-1 border ${
                    libraryTab === t ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "browse" ? "BROWSE" : "PUBLISH CURRENT SELECTION"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {libraryTab === "browse" ? (
                !libraryComponents || libraryComponents.length === 0 ? (
                  <div className="p-4 font-terminal text-[9px] text-muted-foreground">
                    Nothing published yet. Select a range on the sheet, switch to "Publish Current Selection," and share it with the rest of the firm.
                  </div>
                ) : (
                  libraryComponents.map((c) => (
                    <div key={c.id} className="px-4 py-2.5 border-b border-border/20">
                      <div className="flex items-center gap-2">
                        <span className="font-terminal text-[9px] text-foreground font-bold">{c.name}</span>
                        <span className="font-terminal text-[6.5px] tracking-widest text-muted-foreground/60 border border-border/40 px-1">{c.category.toUpperCase()}</span>
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            onClick={() => handleInsertComponent(c)}
                            title={`Insert at ${selected}`}
                            className="font-terminal text-[7px] tracking-widest px-1.5 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
                          >
                            INSERT AT {selected}
                          </button>
                          <button onClick={() => handleDeleteComponent(c.id)} title="Remove from the library" className="text-muted-foreground hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                      {c.description && <div className="font-terminal text-[8px] text-muted-foreground/70 mt-1 leading-relaxed">{c.description}</div>}
                    </div>
                  ))
                )
              ) : (
                <div className="p-4 space-y-3">
                  <div className="font-terminal text-[8px] text-muted-foreground">
                    Publishes whatever's currently selected on the sheet (shift+click or shift+arrows to select a range first). Formulas are normalized so they still work wherever another analyst inserts this later.
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-20 shrink-0">Name</span>
                    <input value={publishName} onChange={(e) => setPublishName(e.target.value)} className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-20 shrink-0">Category</span>
                    <input value={publishCategory} onChange={(e) => setPublishCategory(e.target.value)} placeholder="e.g. Valuation, Debt Schedule..." className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-terminal text-[8px] text-muted-foreground w-20 shrink-0">Description</span>
                    <input value={publishDescription} onChange={(e) => setPublishDescription(e.target.value)} className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40" />
                  </div>
                  {libraryError && <div className="font-terminal text-[8px] text-red-400">{libraryError}</div>}
                  <button onClick={handlePublishComponent} disabled={libraryBusy} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold disabled:opacity-50">
                    {libraryBusy ? "PUBLISHING..." : "PUBLISH"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
