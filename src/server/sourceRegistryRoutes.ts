import type { Express } from "express";
import { requireAuth } from "./auth";
import { getUserSourceRegistry } from "./sourceRegistryService";

export function registerSourceRegistryRoutes(app: Express): void {
  app.get("/api/setup/source-registry", requireAuth, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }

      res.json(await getUserSourceRegistry(userId));
    } catch (error) {
      console.error("Failed to load source registry", error);
      res.status(500).json({ message: "Unable to load source registry" });
    }
  });
}
