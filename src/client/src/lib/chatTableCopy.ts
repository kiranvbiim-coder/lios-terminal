import type { Block, Inline } from "./chatMarkdown";

export type ChatTable = Extract<Block, { t: "table" }>;

/** Only visible text is copied: Markdown syntax and source links stay inert. */
export function chatInlineText(nodes: readonly Inline[]): string {
  return nodes.map(node => {
    switch (node.t) {
      case "text":
      case "code": return node.v;
      case "br": return " ";
      case "cite": return node.raw; // Do not manufacture a resolved citation.
      case "link":
      case "em":
      case "strong":
      case "del": return chatInlineText(node.c);
    }
  }).join("");
}

/**
 * Plain tab-separated text that can be pasted into spreadsheets safely.
 * Never allow untrusted model output to become an Excel/Sheets formula or
 * embedded tab/newline that changes the meaning of copied cell boundaries.
 */
export function safeTableCell(nodes: readonly Inline[]): string {
  const text = chatInlineText(nodes).replace(/[\t\r\n\u0000-\u001f\u007f]+/g, " ").trim();
  if (/^[=+@]/.test(text) || /^-(?!\d+(?:\.\d+)?%?$)/.test(text)) return "'" + text;
  return text;
}

export function chatTableToTsv(table: ChatTable): string {
  const rows = [table.head, ...table.rows];
  return rows.map(row => table.head.map((_, index) => safeTableCell(row[index] ?? [])).join("\t")).join("\n");
}

export async function copyChatTable(
  writeText: ((value: string) => Promise<void>) | undefined,
  table: ChatTable,
): Promise<boolean> {
  if (!writeText) return false;
  try {
    await writeText(chatTableToTsv(table));
    return true;
  } catch {
    return false;
  }
}
