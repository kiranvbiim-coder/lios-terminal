/**
 * Adapted from Opensource UI's accessible file-upload-field-input patterns:
 * bidyut10/opensourceui@892f486fdf0d46a44b21ddf3fa32a41a3a71173a
 * components/inputs/file-upload-field-input.tsx, blob
 * e0a22b94cfd01ffbf99541739991b4678a93d179 (MIT © 2026 Bidyut Kundu).
 * Full grant: third_party/licenses/opensourceui-MIT.txt.
 *
 * LIOS scope: one local XLSX/XLSM/CSV selection with explicit review and
 * user-confirmed import through the existing authorized Project endpoint.
 * No second uploader, browser-side spreadsheet parser, external storage,
 * object URL, auto-upload or donor React19/Next.js/Tailwind4 dependencies.
 */
import * as React from "react";
import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { FileSpreadsheet, FileUp, ShieldCheck, X } from "lucide-react";

export const SPREADSHEET_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const SPREADSHEET_IMPORT_ACCEPT = ".xlsx,.xlsm,.csv";

export function validateProjectSpreadsheetFile(file: { name: string; size: number }): string | null {
  if (!/\.(xlsx|xlsm|csv)$/i.test(file.name.trim())) return "Choose an XLSX, XLSM or CSV spreadsheet.";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "Choose a non-empty spreadsheet.";
  if (file.size > SPREADSHEET_IMPORT_MAX_FILE_BYTES) return "This spreadsheet is larger than the 20 MB import limit.";
  return null;
}

function fileSize(bytes: number): string {
  return bytes < 1_048_576 ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1_048_576).toFixed(1) + " MB";
}

export function ProjectSpreadsheetImportField({ onImport, busy = false }: {
  onImport: (file: File) => Promise<boolean>;
  busy?: boolean;
}) {
  const id = useId();
  const [selected, setSelected] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const blocked = busy || submitting;

  const choose = (file?: File) => {
    if (blocked || !file) return;
    const issue = validateProjectSpreadsheetFile(file);
    setError(issue);
    setSelected(issue ? null : file);
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    choose(event.currentTarget.files?.[0]);
    // Choosing the same file after removal must still emit an input change.
    event.currentTarget.value = "";
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (blocked) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setSelected(null);
      setError("Drop exactly one spreadsheet. Import another file after this one completes.");
      return;
    }
    choose(files[0]);
  };
  const submit = async () => {
    if (!selected || blocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await onImport(selected);
      if (saved) setSelected(null);
      else setError("The import was not completed. Review the error and try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The spreadsheet import failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-label="Import a spreadsheet into this Project" data-testid="project-spreadsheet-import"
      className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.025] p-4 font-ui">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">Import a spreadsheet</h3>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Choose XLSX, XLSM or CSV (maximum 20 MB). Review your file before importing it as a saved Project Artifact.
          </p>
        </div>
        <span className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">Project-scoped</span>
      </div>
      <div onDragEnter={event => { event.preventDefault(); if (!blocked) setDragging(true); }}
        onDragOver={event => { event.preventDefault(); if (!blocked) setDragging(true); }}
        onDragLeave={event => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={drop}
        className={["mt-3 rounded-xl border-2 border-dashed p-5 text-center transition-colors sm:p-7",
          dragging && !blocked ? "border-amber-300/70 bg-amber-300/[0.055]" : "border-border/70 bg-background/65",
          blocked ? "opacity-60" : ""].join(" ")}>
        <FileUp aria-hidden="true" className="mx-auto h-7 w-7 text-cyan-200" />
        <p className="mt-2 text-sm font-semibold text-foreground">{dragging ? "Release to review this spreadsheet" : "Drag a spreadsheet here"}</p>
        <p className="mt-1 text-xs text-muted-foreground">Or choose a file from your device</p>
        <label htmlFor={id} aria-disabled={blocked}
          className={["mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-300/35 px-4 text-sm font-semibold text-cyan-100",
            "focus-within:outline focus-within:outline-2 focus-within:outline-amber-300", blocked ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-cyan-300/[0.075]"].join(" ")}>
          <input id={id} type="file" accept={SPREADSHEET_IMPORT_ACCEPT} disabled={blocked}
            className="sr-only" aria-label="Choose a spreadsheet file" onChange={onChange} />
          Choose spreadsheet
        </label>
      </div>

      {selected && <div role="group" aria-label="Selected spreadsheet review"
        className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-background/70 p-3">
        <FileSpreadsheet aria-hidden="true" className="h-6 w-6 shrink-0 text-emerald-200" />
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-semibold text-foreground">{selected.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{fileSize(selected.size)} · not yet imported</p>
        </div>
        <button type="button" onClick={() => { setSelected(null); setError(null); }} disabled={blocked}
          aria-label="Remove selected spreadsheet"
          className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border/70 px-3 text-xs text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
          <X aria-hidden="true" className="h-4 w-4" /> Remove
        </button>
      </div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="flex max-w-xl items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
          The existing LIOS importer verifies your file and reports unsupported workbook features. Selecting a file never uploads it automatically.
        </p>
        <button type="button" disabled={!selected || blocked} onClick={() => void submit()}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.07] px-4 text-sm font-semibold text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40">
          <FileUp aria-hidden="true" className="h-4 w-4" />
          {blocked ? "Importing…" : "Import reviewed spreadsheet"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-rose-300/25 p-3 text-sm text-rose-200">{error}</p>}
    </section>
  );
}
