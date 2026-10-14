import { type Express, type Response } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

async function serveSpaIndex(vite: Awaited<ReturnType<typeof createViteServer>>, url: string, res: Response): Promise<void> {
  const clientTemplate = path.resolve(import.meta.dirname, "..", "client", "index.html");
  let template = await fs.promises.readFile(clientTemplate, "utf-8");
  template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
  const page = await vite.transformIndexHtml(url, template);
  res.status(200).set({ "Content-Type": "text/html" }).end(page);
}

export async function setupVite(server: Server, app: Express) {
  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server, path: "/vite-hmr" },
      allowedHosts: true as const,
      watch: {
        ignored: ["**/data/history/**", "**/data/pgdata/**"],
      },
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;
    if (url.startsWith("/api") || url.startsWith("/gateway")) return next();

    try {
      await serveSpaIndex(vite, url, res);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
