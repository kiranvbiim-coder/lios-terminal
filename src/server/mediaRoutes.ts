/**
 * Internal terminal's Marketing, PR & Communications domain routes --
 * backed by gdeltData.ts rather than fredData.ts, since this domain has no
 * FRED-hosted equivalent. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like the rest of this registration group.
 */
import type { Express } from "express";
import { getMediaQuotes, getMediaHistory, getMediaVolume, getMediaCatalog, getMediaTopicProfile } from "./gdeltData";

export function registerMediaRoutes(app: Express): void {
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
