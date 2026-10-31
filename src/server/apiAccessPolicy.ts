// Exact routes that pass the global /api internal gate for any signed-in
// account. Each handler still enforces its own role, tenant and entitlement
// checks (Wave D routes use requireWaveDRetailRead; voice routes requireAuth).
const AUTHENTICATED_SELF_SERVICE_ROUTES = new Set([
  "GET /wave-c/ai/state",
  "PUT /wave-c/ai/state",
  "GET /wave-d/pulse",
  "POST /wave-d/pulse/review",
  "GET /wave-d/pulse/preferences",
  "POST /wave-d/pulse/preferences",
  "GET /wave-d/pulse/views",
  "POST /wave-d/pulse/views",
  "GET /wave-d/briefs/morning",
  "GET /wave-d/briefs/evening",
  "GET /wave-d/action-inbox",
  "GET /wave-d/report-templates",
  "GET /voice/setup",
  "POST /voice/setup/refresh",
  "GET /voice/providers",
  "POST /voice/transcribe",
  "POST /voice/speak",
]);

// Single-segment id routes (UUID or inbox:<card id> as one path segment).
const AUTHENTICATED_SELF_SERVICE_ID_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "DELETE", pattern: /^\/wave-d\/pulse\/views\/[^/]+$/ },
  { method: "POST", pattern: /^\/wave-d\/action-inbox\/[^/]+$/ },
];

/** Exact self-service routes allowed through the global API gate for signed-in client accounts. */
export function isAuthenticatedSelfServiceRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return AUTHENTICATED_SELF_SERVICE_ROUTES.has(`${m} ${path}`)
    || AUTHENTICATED_SELF_SERVICE_ID_ROUTES.some((r) => r.method === m && r.pattern.test(path));
}
