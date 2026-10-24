/**
 * Shared, read-only recovery taxonomy for authenticated workspace surfaces.
 *
 * Distinguish transport/session denial from ordinary missing and retryable
 * service failures. Never use the backend response body as display copy:
 * errors can contain private Project/provider state.
 */
export type AsyncSurfaceState = "loading" | "ready" | "signed_out" | "denied" | "missing" | "failed";

export type AsyncSurfaceQuery = {
  hasData: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
};

export function asyncSurfaceStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = error.status;
    if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  const text = error instanceof Error ? error.message : "";
  // apiRequest currently prefixes HTTP failures with "<status>: ".
  const status = /^([1-5][0-9]{2})(?=\s|:|$)/.exec(text);
  return status ? Number(status[1]) : null;
}

export function resolveAsyncSurfaceState(query: AsyncSurfaceQuery): AsyncSurfaceState {
  // Retain existing rendered revisions during revalidation: a failed
  // background refetch must not destroy a local edit or flash a fake empty view.
  if (query.hasData) return "ready";
  if (query.isPending) return "loading";
  if (!query.isError) return "missing";
  const status = asyncSurfaceStatus(query.error);
  if (status === 401) return "signed_out";
  if (status === 403) return "denied";
  if (status === 404 || status === 410) return "missing";
  return "failed";
}
