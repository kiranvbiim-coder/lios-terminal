const AUTHENTICATED_SELF_SERVICE_ROUTES = new Set([
  "GET /wave-c/ai/state",
  "PUT /wave-c/ai/state",
]);

/** Exact self-service routes allowed through the global API gate for signed-in client accounts. */
export function isAuthenticatedSelfServiceRoute(method: string, path: string): boolean {
  return AUTHENTICATED_SELF_SERVICE_ROUTES.has(`${method.toUpperCase()} ${path}`);
}
