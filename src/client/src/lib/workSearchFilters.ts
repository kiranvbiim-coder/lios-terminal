import type { WorkSearchResult } from "@shared/workSearch";

/**
 * Client-side filtering of already-authorized, server-returned work.
 * Never broaden server search or infer Project/file access from an ID.
 */
export type WorkSearchFilter = "all" | WorkSearchResult["kind"];

export const WORK_SEARCH_FILTERS: ReadonlyArray<{ value: WorkSearchFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chats" },
  { value: "project", label: "Projects" },
  { value: "artifact", label: "Artifacts" },
  { value: "file", label: "Files" },
];

export function filterWorkSearchResults(
  results: readonly WorkSearchResult[],
  kind: WorkSearchFilter,
): WorkSearchResult[] {
  return kind === "all" ? [...results] : results.filter((result) => result.kind === kind);
}

export function countWorkSearchKind(results: readonly WorkSearchResult[], kind: WorkSearchFilter): number {
  return kind === "all" ? results.length : results.filter((result) => result.kind === kind).length;
}

export function clampWorkSearchSelection(index: number, resultCount: number): number {
  return Math.max(0, Math.min(index, Math.max(0, resultCount - 1)));
}

export function workSearchEmptyMessage(
  query: string,
  filter: WorkSearchFilter,
  returnedCount: number,
): string {
  if (query.trim().length < 2) return "Enter at least 2 characters to search saved LIOS work.";
  if (filter !== "all" && returnedCount > 0) {
    const name = WORK_SEARCH_FILTERS.find((entry) => entry.value === filter)?.label.toLowerCase() || "items";
    return `No ${name} among the returned matches. Try a more specific search.`;
  }
  return "No matching work found.";
}
