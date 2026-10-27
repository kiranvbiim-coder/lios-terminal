/**
 * Internal terminal's Marketing, PR & Communications domain routes --
 * backed by gdeltData.ts rather than fredData.ts, since this domain has no
 * FRED-hosted equivalent. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like the rest of this registration group.
 */
import type { Express } from "express";
import { searchCommonsCC0 } from "../script/commons_cc0_news_image";
import { requireAuth } from "./auth";
import { getMediaQuotes, getMediaHistory, getMediaVolume, getMediaCatalog, getMediaTopicProfile } from "./gdeltData";

export function registerMediaRoutes(app: Express): void {
  // Explicit, read-only discovery, with the same authenticated media domain.
  // Does not download, persist, approve, proxy, or attach an image to a story.
  app.get("/api/media/commons/cc0", requireAuth, async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 3 || q.length > 100) return res.status(400).json({ error: "Search must be 3 to 100 characters." });
    try {
      const results = await searchCommonsCC0(q);
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
