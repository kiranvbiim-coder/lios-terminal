import type { Express } from "express";

/**
 * Route manifest (GM-08c, D-01): every HTTP route the Home registers and who can reach its handler.
 *
 * The answer comes from the live Express router, not from source text or middleware names: for each route the
 * middleware that runs before the final handler (matching `app.use` layers, then the route's own guards) is
 * executed with a synthetic request for each identity, and the outcome is recorded — blocked with a status, or
 * let through to the handler. The final handler itself is never executed. Global middleware installed in index.ts
 * (local desktop trust, session, CSRF) precedes everything and is not part of this probe.
 */

export const PROBE_IDENTITIES = ["anonymous", "client_user", "client_admin", "internal_analyst", "internal_compliance", "internal_admin"] as const;
export type ProbeIdentity = (typeof PROBE_IDENTITIES)[number];

export type ProbeOutcome = "allowed" | "blocked" | "unprobed";

export interface RouteManifestEntry {
  method: string;
  path: string;
  /** Identities whose request reaches the handler. Empty means no probed identity can reach it. */
  reachableBy: ProbeIdentity[];
  /** True when a guard could not be evaluated synthetically (for example a body/stream parser); review manually. */
  unprobed: boolean;
}

interface MatchResult {
  path: string;
}

interface RouterLayer {
  name: string;
  matchers?: Array<(path: string) => MatchResult | false | undefined>;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: RouterLayer[] };
  handleRequest(req: object, res: object, next: (error?: unknown) => void): void;
}

const TERMINAL_RESPONSE_METHODS = ["json", "send", "end", "redirect", "sendStatus", "sendFile", "download", "render"];
const PROBE_TIMEOUT_MS = 25;

function samplePath(path: string): string {
  return path
    .replace(/:([A-Za-z0-9_]+)\??/g, (_match, name: string) => (/id$/i.test(name) ? "1" : "x"))
    .replace(/\{\/\*[A-Za-z0-9_]*\}|\/\*[A-Za-z0-9_]*/g, "/x");
}

function syntheticRequest(method: string, fullPath: string, remainder: string, baseUrl: string, role: ProbeIdentity) {
  const user = role === "anonymous" ? undefined : { id: 1_000_001, email: `${role}@probe.invalid`, role, organizationId: role.startsWith("client") ? 1 : null, lockedUntil: null };
  return {
    method,
    url: remainder,
    originalUrl: fullPath,
    path: remainder,
    baseUrl,
    query: {},
    params: {},
    body: {},
    headers: {},
    cookies: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1", encrypted: false },
    session: {},
    user,
    isAuthenticated: () => Boolean(user),
    get: () => undefined,
    header: () => undefined,
    is: () => false,
  };
}

function syntheticResponse(finish: (status: number) => void) {
  const state = { statusCode: 200, headersSent: false, writableEnded: false };
  const target: Record<string, unknown> = state;
  const proxy: object = new Proxy(target, {
    get(_target, property: string) {
      if (property in state) return state[property as keyof typeof state];
      if (property === "status") return (code: number) => { state.statusCode = code; return proxy; };
      if (TERMINAL_RESPONSE_METHODS.includes(property)) {
        return () => {
          state.headersSent = true;
          state.writableEnded = true;
          finish(property === "redirect" ? 302 : state.statusCode);
          return proxy;
        };
      }
      if (property === "on" || property === "once" || property === "emit") return () => proxy;
      return () => proxy;
    },
    set(_target, property: string, value: unknown) {
      if (property === "statusCode") state.statusCode = Number(value);
      return true;
    },
  });
  return proxy;
}

function probeStep(layer: RouterLayer, method: string, sample: string, remainder: string, baseUrl: string, role: ProbeIdentity): Promise<ProbeOutcome> {
  const { promise, resolve } = Promise.withResolvers<ProbeOutcome>();
  const timer = setTimeout(() => resolve("unprobed"), PROBE_TIMEOUT_MS);
  const req = syntheticRequest(method, sample, remainder, baseUrl, role);
  // A terminal response (401/403/...) blocks the request even though the layer itself may not have returned yet.
  const res = syntheticResponse(() => resolve("blocked"));
  try {
    layer.handleRequest(req, res, (error?: unknown) => resolve(error ? "blocked" : "allowed"));
  } catch {
    resolve("unprobed");
  }
  return promise.finally(() => clearTimeout(timer));
}

async function probeRoute(stack: RouterLayer[], index: number, method: string, path: string, role: ProbeIdentity): Promise<ProbeOutcome> {
  const route = stack[index]!.route!;
  const sample = samplePath(path);
  const chain: Array<{ layer: RouterLayer; remainder: string; baseUrl: string }> = [];
  for (let before = 0; before < index; before += 1) {
    const candidate = stack[before]!;
    if (candidate.route) continue;
    const match = candidate.matchers?.map((matches) => matches(sample)).find(Boolean);
    if (!match) continue;
    const baseUrl = match.path === "/" ? "" : match.path;
    chain.push({ layer: candidate, baseUrl, remainder: sample.slice(baseUrl.length) || "/" });
  }
  // Everything except the final handler is middleware; the final handler is never run.
  for (const layer of route.stack.slice(0, -1)) chain.push({ layer, baseUrl: "", remainder: sample });

  let sawUnprobed = false;
  for (const step of chain) {
    const outcome = await probeStep(step.layer, method, sample, step.remainder, step.baseUrl, role);
    if (outcome === "blocked") return "blocked";
    if (outcome === "unprobed") sawUnprobed = true;
  }
  return sawUnprobed ? "unprobed" : "allowed";
}

export async function buildRouteManifest(app: Express): Promise<RouteManifestEntry[]> {
  const stack = (app as unknown as { router: { stack: RouterLayer[] } }).router.stack;
  const entries: RouteManifestEntry[] = [];
  for (let index = 0; index < stack.length; index += 1) {
    const layer = stack[index]!;
    if (!layer.route) continue;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    const methods = Object.keys(layer.route.methods).filter((method) => layer.route!.methods[method]).map((method) => method.toUpperCase());
    for (const path of paths) {
      for (const method of methods) {
        const reachableBy: ProbeIdentity[] = [];
        let unprobed = false;
        for (const identity of PROBE_IDENTITIES) {
          const outcome = await probeRoute(stack, index, method, path, identity);
          if (outcome === "allowed") reachableBy.push(identity);
          if (outcome === "unprobed") {
            unprobed = true;
            reachableBy.push(identity);
          }
        }
        entries.push({ method, path, reachableBy, unprobed });
      }
    }
  }
  return entries.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}
