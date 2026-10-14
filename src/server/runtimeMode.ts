import type { RuntimeMode } from "@shared/runtimeProviderContracts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * The one place that decides whether this process is a Desktop Local Home or a user-operated
 * always-on Home. Previously several modules each sniffed `HOST` on their own (GM-01 L-01).
 *
 * Mode answers "who can reach this server": an unset or loopback `HOST` is Desktop Local; any other
 * bind address means the user deliberately exposed the Home (NAS, server, VPS, container). It is
 * independent of the database choice: Desktop Local may use a user PostgreSQL via `DATABASE_URL`.
 */
export function resolveRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const host = env.HOST?.trim();
  return !host || LOOPBACK_HOSTS.has(host) ? "desktop_local" : "user_home_server";
}
