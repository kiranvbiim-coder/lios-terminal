import type { Express, Response } from "express";
import { requireAuth } from "./auth";
import { connectTelegram, disconnectTelegram, listTelegramConnections, TelegramSetupError } from "./telegramConnectionSetup";

function fail(res: Response, error: unknown): void {
  if (error instanceof TelegramSetupError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  // Never echo database, vault or provider detail; the bot token must not appear in any response or log line.
  res.status(500).json({ error: "The Telegram connection request could not be completed." });
}

/** Owner-scoped setup only. Polling starts by Home reconciliation of an enabled source, never from these handlers. */
export function registerTelegramConnectionRoutes(app: Express): void {
  app.get("/api/setup/telegram-connections", requireAuth, async (req, res) => {
    try { res.json({ connections: await listTelegramConnections(req.user!) }); } catch (error) { fail(res, error); }
  });
  app.post("/api/setup/telegram-connections", requireAuth, async (req, res) => {
    try { res.status(201).json({ connection: await connectTelegram(req.user!, req.body) }); } catch (error) { fail(res, error); }
  });
  app.delete("/api/setup/telegram-connections/:id", requireAuth, async (req, res) => {
    try { res.json({ connection: await disconnectTelegram(req.user!, Number(req.params.id)) }); } catch (error) { fail(res, error); }
  });
}
