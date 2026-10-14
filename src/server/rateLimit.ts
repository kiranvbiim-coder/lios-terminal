import type { Express, Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

function clientKey(req: Request, scope: string): string {
  // Express resolves req.ip using the configured trust-proxy policy. Do not
  // trust an arbitrary X-Forwarded-For header directly from the client.
  return `${scope}:${req.ip || "unknown"}`;
}

function limiter(scope: string, limit: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = clientKey(req, scope);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }

    if (buckets.size > MAX_BUCKETS) {
      for (const [entryKey, entry] of Array.from(buckets)) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
        if (buckets.size <= MAX_BUCKETS) break;
      }
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}

export function registerRateLimits(app: Express): void {
  app.use("/api/auth/login", limiter("auth-login", 10));
  app.use("/api/auth/register", limiter("auth-register", 5));
  app.use("/api/auth/bootstrap/complete", limiter("owner-bootstrap", 5));
  app.use("/api", (req, res, next) => {
    const requestPath = req.path;
    if (requestPath === "/auth/login" || requestPath === "/auth/register") return next();
    if (requestPath.includes("/ai") || requestPath.includes("/agent")) return limiter("ai", 30)(req, res, next);
    if (requestPath === "/client/diagnostics") return limiter("client-diagnostics", 60)(req, res, next);
    if (req.method === "POST" && (requestPath.includes("/upload") || requestPath.includes("/ingest"))) return limiter("ingest", 10)(req, res, next);
    if (requestPath.includes("/export")) return limiter("export", 20)(req, res, next);
    return limiter("api", 240)(req, res, next);
  });
}
