/**
 * Presentation only. The Connection Center source registry is the single
 * source of identity, licence state and recorded health. A failed read must
 * never invent "zero sources", and cached records are never current proof.
 */
export function sourceCataloguePresentation(input: {
  hasData: boolean;
  failed: boolean;
  fetching: boolean;
  matchingCount: number;
}): {
  heading: string;
  countLabel: string | null;
  emptyLabel: string | null;
  healthLabel: string | null;
} {
  if (!input.hasData) return {
    heading: "Registered source catalogue",
    countLabel: null,
    emptyLabel: null,
    healthLabel: input.failed
      ? "No source availability was verified. You can retry the read-only catalogue request."
      : input.fetching ? "Loading the registered source catalogue…" : null,
  };
  const stale = input.failed;
  const count = input.matchingCount;
  return {
    heading: stale ? "Previously loaded source catalogue" : "Registered source catalogue",
    countLabel: `${count} matching ${stale ? "previously loaded" : "registered"} source${count === 1 ? "" : "s"}`,
    emptyLabel: stale
      ? "No matches in the previously loaded catalogue. Current source availability could not be verified."
      : "No matching sources. Clear the search or manage connections.",
    healthLabel: stale
      ? "Showing the last loaded catalogue; current availability could not be refreshed."
      : input.fetching ? "Checking for source catalogue updates…" : null,
  };
}
