import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { buildRouteManifest, compareStoredRouteManifest } from "../server/routeManifest";

// Registering the routes opens the data root; use a throwaway one so the check never touches a real install.
process.env.LIOS_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lios-routes-"));
process.env.LIMURIA_VAULT_SECRET ??= "route-manifest-check-secret-0000000000";
delete process.env.DATABASE_URL;
// Routes/DB read the data-root environment during module initialization, so they must load after isolation.
const { registerRoutes } = await import("../server/routes");
const { initDb } = await import("../server/db");

const MANIFEST_PATH = path.resolve(import.meta.dirname, "../../docs/technical/ROUTE_MANIFEST.json");

/**
 * Routes any unauthenticated caller may reach. Anything else that becomes reachable anonymously fails `--check`
 * until a person adds it here with a reason (and the owner agrees).
 */
const ANONYMOUS_ROUTES: Record<string, string> = {
  "POST /api/auth/bootstrap/complete": "first-owner setup; the handler requires the one-time setup token or refuses once an owner exists",
  "GET /api/auth/bootstrap/status": "tells the setup screen whether an owner exists",
  "POST /api/auth/login": "sign-in",
  "POST /api/auth/logout": "sign-out of the current session",
  "GET /api/auth/me": "session probe; answers 401 when signed out",
  "POST /api/auth/register": "customer self-registration on Desktop Local",
  "GET /api/client/auth/sso/:orgId": "organization SSO discovery",
  "GET /api/client/auth/sso/:orgId/start": "SSO redirect",
  "GET /api/client/auth/sso/:orgId/callback": "OIDC callback",
  "POST /api/client/auth/sso/:orgId/saml/acs": "SAML assertion consumer",
  "POST /api/client/auth/sso/device/start": "SSO device flow",
  "POST /api/client/auth/sso/device/poll": "SSO device flow",
  "GET /api/public/desktop-distribution": "public download metadata (GM-24 reviews the marketing/distribution surface)",
};

await initDb();
const app = express();
await registerRoutes(createServer(app), app);
const entries = await buildRouteManifest(app);
const manifest = { generatedBy: "npm run routes:manifest", routes: entries };
const json = JSON.stringify(manifest, null, 1) + "\n";

const anonymous = entries.filter((entry) => entry.reachableBy.includes("anonymous")).map((entry) => `${entry.method} ${entry.path}`);
const unexpected = anonymous.filter((route) => !(route in ANONYMOUS_ROUTES));
const stale = Object.keys(ANONYMOUS_ROUTES).filter((route) => !anonymous.includes(route));

if (process.argv.includes("--check")) {
  if (unexpected.length || stale.length) {
    for (const route of unexpected) console.error(`Anonymously reachable and not allow-listed: ${route}`);
    for (const route of stale) console.error(`Allow-listed but no longer anonymously reachable (remove it): ${route}`);
    process.exit(1);
  }
  const current = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, "utf8") : "";
  const difference = compareStoredRouteManifest(current, manifest);
  if (difference) {
    console.error("docs/technical/ROUTE_MANIFEST.json is out of date. Run `npm run routes:manifest` and review the diff (a new public route needs an owner decision).");
    console.error(difference);
    process.exit(1);
  }
  console.log(`Route manifest up to date (${entries.length} routes).`);
} else {
  fs.writeFileSync(MANIFEST_PATH, json);
  console.log(`Wrote ${entries.length} routes to ${MANIFEST_PATH} (${anonymous.length} anonymously reachable, ${entries.filter((entry) => entry.unprobed).length} with a guard that could not be probed).`);
}
process.exit(0);
