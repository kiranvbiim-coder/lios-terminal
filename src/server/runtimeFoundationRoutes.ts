import type { Express } from "express";
import { LIOS_RUNTIME_CONTRACT_VERSION } from "@shared/runtimeContracts";
import {
  createRuntimeFoundationRegistry,
  createRuntimeFoundationSnapshot,
} from "./runtimeFoundation";

/**
 * Internal diagnostics/discovery surface for the P0 runtime foundation.
 *
 * These routes are registered after the global internal-account API gate in
 * routes.ts. The payload deliberately contains no credentials, secret names,
 * provider tokens or Project data.
 */
export function registerRuntimeFoundationRoutes(app: Express): void {
  app.get("/api/runtime/foundation", (_req, res) => {
    res.json(createRuntimeFoundationSnapshot());
  });

  app.get("/api/runtime/foundation/health", async (_req, res) => {
    const registry = createRuntimeFoundationRegistry();
    const health = await registry.healthSnapshot();
    res.json({
      contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
      health,
    });
  });
}
