/** Project Home must distinguish available cached entries from a verified latest read.
 * A failed source must not silently contribute a trusted "0" count, nor
 * authorize edits to a resource whose current server state is unknown.
 */
export function projectSavedWorkReadPresentation(input: {
  chatsFailed: boolean;
  resourcesFailed: boolean;
  sessionsFailed: boolean;
  pending: boolean;
  fetching: boolean;
}): {
  label: string;
  countQualifier: string;
  resourcesWritable: boolean;
  retryAvailable: boolean;
} {
  const failed = input.chatsFailed || input.resourcesFailed || input.sessionsFailed;
  return {
    label: failed
      ? "Some Project records could not be verified. Listed items may be previously loaded or incomplete."
      : input.pending
        ? "Loading this Project's saved work…"
        : input.fetching
          ? "Checking for saved-work updates…"
          : "Saved work is from the latest successful Project read.",
    countQualifier: failed ? " · Previously loaded or incomplete" : input.pending ? " · Loading" : "",
    resourcesWritable: !input.resourcesFailed && !input.pending && !input.fetching,
    retryAvailable: failed && !input.fetching,
  };
}
