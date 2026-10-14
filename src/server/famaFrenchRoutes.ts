/**
 * Internal terminal routes for the Kenneth French factor data connector --
 * official, free, no key required. Gated by the app.use("/api",
 * requireInternal) middleware in routes.ts like everything else in this
 * registration group.
 */
import type { Express } from "express";
import { getFamaFrench3Factors, getCarhart4Factors, getFamaFrench5Factors, isFamaFrenchAvailable } from "./famaFrenchData";

export function registerFamaFrenchRoutes(app: Express): void {
  app.get("/api/famafrench/status", async (_req, res) => {
    res.json({ available: await isFamaFrenchAvailable() });
  });

  app.get("/api/famafrench/factors3", async (req, res) => {
    const start = String(req.query.start ?? "1990-01-01");
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    res.json(await getFamaFrench3Factors(start, end));
  });

  app.get("/api/famafrench/carhart4", async (req, res) => {
    const start = String(req.query.start ?? "1990-01-01");
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    res.json(await getCarhart4Factors(start, end));
  });

  app.get("/api/famafrench/factors5", async (req, res) => {
    const start = String(req.query.start ?? "1990-01-01");
    const end = String(req.query.end ?? new Date().toISOString().slice(0, 10));
    res.json(await getFamaFrench5Factors(start, end));
  });
}
