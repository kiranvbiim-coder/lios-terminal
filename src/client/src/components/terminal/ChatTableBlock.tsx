// Trusted React-only table markup; no HTML injection or external data fetches.
import * as React from "react";
import { useEffect, useId, useState } from "react";
import type { Align, Block, Inline } from "@/lib/chatMarkdown";
import { copyChatTable } from "@/lib/chatTableCopy";

type ChatTable = Extract<Block, { t: "table" }>;
type CopyState = "idle" | "copied" | "failed";

interface Props {
  table: ChatTable;
  renderCell: (nodes: readonly Inline[]) => React.ReactNode;
  streaming?: boolean;
}

const ALIGN_CLASS: Record<Exclude<Align, null>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** Gives each real Markdown table a keyboard reachable scroll region and truthful clipboard feedback. */
export default function ChatTableBlock({ table, renderCell, streaming = false }: Props) {
  const id = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  useEffect(() => { setCopyState("idle"); }, [table, streaming]);
  const onCopy = async () => {
    if (streaming) return;
    const writeText = typeof navigator !== "undefined" && navigator.clipboard?.writeText
      ? (value: string) => navigator.clipboard.writeText(value)
      : undefined;
    setCopyState((await copyChatTable(writeText, table)) ? "copied" : "failed");
  };

  return (
    <section className="my-3 max-w-full overflow-hidden rounded-lg border border-border/60" data-chat-table-block="true" aria-labelledby={id}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border/50 bg-white/[0.035] px-3 py-1.5">
        <span id={id} className="font-ui text-[12px] text-muted-foreground">
          Answer table · {table.head.length} columns · {table.rows.length} rows
        </span>
        <button
          type="button"
          disabled={streaming}
          aria-label={streaming ? "Copy table after the answer finishes" : "Copy table as tab-separated text"}
          onClick={() => { void onCopy(); }}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-border/70 px-3 py-2 font-ui text-[12px] text-foreground hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-table-copy"
        >
          {streaming ? "Generating…" : copyState === "copied" ? "Copied" : "Copy table"}
        </button>
      </div>
      <div role="region" tabIndex={0} aria-label="Scrollable answer table" className="max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
        <table className="w-full min-w-max border-collapse font-ui text-[13px] leading-5">
          <caption className="sr-only">Answer table with {table.head.length} columns and {table.rows.length} data rows. Scroll horizontally to view all columns.</caption>
          <thead className="bg-white/[0.04]">
            <tr>{table.head.map((cell, column) => (
              <th key={column} scope="col" className={`border-b border-border/60 px-3 py-2 font-semibold text-foreground whitespace-normal break-words [overflow-wrap:anywhere] ${ALIGN_CLASS[table.align[column] ?? "left"]}`}>
                {renderCell(cell)}
              </th>
            ))}</tr>
          </thead>
          <tbody>{table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/30 last:border-b-0">
              {row.map((cell, column) => (
                <td key={column} className={`max-w-[28rem] whitespace-normal break-words [overflow-wrap:anywhere] px-3 py-2 align-top tabular-nums ${ALIGN_CLASS[table.align[column] ?? "left"]}`}>
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {copyState === "failed" && (
        <p role="alert" className="px-3 py-2 font-ui text-xs text-amber-200">Clipboard unavailable. Select the table cells and copy them manually.</p>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "copied" ? "Table copied as tab-separated text" : ""}
      </span>
    </section>
  );
}
