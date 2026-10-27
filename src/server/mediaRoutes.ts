/**
 * Internal terminal's Marketing, PR & Communications domain routes --
 * backed by gdeltData.ts rather than fredData.ts, since this domain has no
 * FRED-hosted equivalent. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like the rest of this registration group.
 */
import type { Express } from "express";
import { lookupCommonsCC0, searchCommonsCC0 } from "./commonsCc0Media";
import { requireAuth } from "./auth";
import { getMediaQuotes, getMediaHistory, getMediaVolume, getMediaCatalog, getMediaTopicProfile } from "./gdeltData";

type CommonsDiscoverySources = Readonly<{ search: typeof searchCommonsCC0; lookup: typeof lookupCommonsCC0 }>;

export function registerMediaRoutes(app: Express, sources: CommonsDiscoverySources = { search: searchCommonsCC0, lookup: lookupCommonsCC0 }): void {
  // Saved Commons references must be checked against the CURRENT file metadata
  // on explicit user action; restoring panel state cannot itself load pixels.
  app.get("/api/media/commons/cc0/file", requireAuth, async (req, res) => {
    const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
    if (!title.startsWith("File:") || title.length < 7 || title.length > 260) {
      return res.status(400).json({ error: "A valid Commons File: title is required." });
    }
    try {
      const candidate = await sources.lookup(title);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ candidate, status: "unreviewed" });
    } catch {
      return res.status(502).json({ error: "The saved Commons file is unavailable or no longer verified CC0." });
    }
  });
  // Explicit, read-only discovery, with the same authenticated media domain.
  // Does not download, persist, approve, proxy, or attach an image to a story.
  app.get("/api/media/commons/cc0", requireAuth, async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 3 || q.length > 100) return res.status(400).json({ error: "Search must be 3 to 100 characters." });
    try {
      const results = await sources.search(q);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json({ results, status: "unreviewed", source: "Wikimedia Commons CC0 metadata" });
    } catch (reason) {
      return res.status(502).json({ error: "Commons image discovery is unavailable. No images were inferred." });
    }
  });

  app.get("/api/media/topics", async (_req, res) => {
    const quotes = await getMediaQuotes(getMediaCatalog().map((t) => t.topicId));
    res.json(quotes);
  });

  app.get("/api/media/topic/:topicId", async (req, res) => {
    const topicId = String(req.params.topicId).toLowerCase();
    const [quote] = await getMediaQuotes([topicId]);
    const history = await getMediaHistory(topicId);
    const volume = await getMediaVolume(topicId);
    const wikipediaArticle = getMediaTopicProfile(topicId)?.wikipediaArticle ?? null;
    res.json({ quote, history, volume, wikipediaArticle });
  });
}
