const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isHostedProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.DATABASE_URL?.trim()) return true;
  const host = env.HOST?.trim().toLowerCase();
  return Boolean(host && !LOCAL_HOSTS.has(host));
}

/** The operator must explicitly opt in to trusting a reverse proxy. Otherwise a direct Home
 * connection could spoof X-Forwarded-Proto: https and bypass TLS-only first-owner setup. */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): false | number {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0" || raw === "off") return false;
  const hops = Number.parseInt(raw, 10);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5 || String(hops) !== raw) {
    throw new Error("TRUST_PROXY must be a proxy-hop count from 1 to 5, or 0/false.");
  }
  return hops;
}

export function secureSessionCookieRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return isHostedProductionRuntime(env) || env.SESSION_COOKIE_SECURE?.trim().toLowerCase() === "true";
}


export function assertLocalByodRuntime(label: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isHostedProductionRuntime(env)) {
    throw new Error(`${label} is local-desktop only and cannot execute on the hosted control plane.`);
  }
}
