/**
 * Home attention is a projection of the existing Wave D Pulse read. Cached
 * server cards after a failed read are previous observations, never proof
 * of current priority, review status or an empty actionable Inbox.
 */
export function homeAttentionReadPresentation(input: {
  hasData: boolean;
  pending: boolean;
  fetching: boolean;
  failed: boolean;
  matchingCount: number;
}): {
  heading: string;
  countText: string | null;
  emptyText: string | null;
  availabilityText: string | null;
  mayReview: boolean;
} {
  if (input.failed) return {
    heading: input.hasData ? "Previously recorded Home intelligence" : "Home intelligence unavailable",
    countText: input.hasData ? `${input.matchingCount} matching previously recorded items` : null,
    emptyText: input.hasData ? "No matches in the previously recorded snapshot. Current attention could not be verified." : null,
    availabilityText: input.hasData
      ? "The latest Pulse check failed. These are previously recorded items, not verified current attention."
      : "No current Home intelligence snapshot could be verified. Retry the read-only check.",
    mayReview: false,
  };
  if (input.pending || !input.hasData) return {
    heading: "What deserves your attention",
    countText: null,
    emptyText: null,
    availabilityText: input.fetching ? "Reading recorded Home intelligence…" : "No verified Home intelligence snapshot is available.",
    mayReview: false,
  };
  return {
    heading: "What deserves your attention",
    countText: `${input.matchingCount} matching recorded items`,
    emptyText: "No material intelligence currently needs attention.",
    availabilityText: input.fetching ? "Checking for newer Home intelligence…" : null,
    mayReview: !input.fetching,
  };
}
