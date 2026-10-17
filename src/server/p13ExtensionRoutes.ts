import express, { type Express, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@shared/schema";
import { hiddenEnginePackPlatformSchema } from "@shared/hiddenEnginePackManifest";
import { requireAuth, isHomeOwner } from "./auth";
import { getDb } from "./db";
import { dataRoot } from "./dataRoot";
import { getP13PluginRuntimeHost } from "./p13PluginRuntime";
import { P11PackManager } from "./p11PackManager";
import { ExtensionAdmissionError, P13ExtensionService, type ExtensionPrincipal } from "./p13ExtensionService";
import { recordAuditEvent } from "./auditEvents";

let service: P13ExtensionService | null = null;
export function getP13ExtensionService(): P13ExtensionService {
  if (!service) {
    const platform = hiddenEnginePackPlatformSchema.safeParse(`${process.platform}-${process.arch}`);
    const packs = platform.success ? new P11PackManager({ rootDir: path.join(dataRoot(), "p11-packs"), coreVersion: "1.0.0", platform: platform.data, publisherKeys: {} }) : null;
    service = new P13ExtensionService(getP13PluginRuntimeHost(), packs);
  }
  return service;
}
async function currentOwner(req: Request): Promise<ExtensionPrincipal> {
  const [user] = req.user ? await getDb().select().from(users).where(eq(users.id, req.user.id)).limit(1) : [];
  if (!user) throw new ExtensionAdmissionError(403, "Current Home owner is required.");
  return { userId: user.id, role: user.role, organizationId: user.organizationId, active: user.active, mustChangePassword: user.mustChangePassword, lockedUntil: user.lockedUntil, homeOwner: isHomeOwner(user) };
}
const revokeSchema = z.object({ kind: z.enum(["p13", "p11"]), id: z.string().min(1).max(180), digest: z.string().regex(/^[a-f0-9]{64}$/), version: z.string().max(80).optional(), revoke: z.literal(true) }).strict();

export function registerP13ExtensionRoutes(app: Express): void {
  const router = express.Router();
  router.use(requireAuth);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", async (req, res, next) => {
    try { res.json(getP13ExtensionService().catalog(await currentOwner(req))); } catch (error) { next(error); }
  });
  router.post("/preview", async (req, res, next) => {
    try { const actor = await currentOwner(req); res.json(getP13ExtensionService().preview(actor, req.body)); } catch (error) { next(error); }
  });
  router.post("/publisher-key/preview", async (req, res, next) => {
    try {
      getP13ExtensionService().catalog(await currentOwner(req));
      const { publicKeyPem } = z.object({ publicKeyPem: z.string().min(32).max(4096) }).strict().parse(req.body);
      const key = crypto.createPublicKey(publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new ExtensionAdmissionError(400, "Publisher key must use Ed25519.");
      res.json({ fingerprint: crypto.createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex") });
    } catch (error) { next(error); }
  });
  router.post("/publisher-key/consent", async (req, res, next) => {
    try {
      const actor = await currentOwner(req);
      const result = getP13ExtensionService().trustPublisher(actor, req.body);
      await recordAuditEvent(actor.userId, "extension_publisher_trusted", { keyId: result.publisherKeyId, fingerprint: result.publisherFingerprint, packageDigest: result.packageDigest });
      res.json(result);
    } catch (error) { next(error); }
  });
  router.post("/install", async (req, res, next) => {
    try {
      const actor = await currentOwner(req);
      const result = getP13ExtensionService().install(actor, req.body);
      await recordAuditEvent(actor.userId, "extension_installed", { kind: result.kind, packageDigest: req.body.packageDigest, rightsConfirmed: true, sessionOnly: result.kind === "p13" });
      res.json(result);
    } catch (error) { next(error); }
  });
  router.get("/inspect", async (req, res, next) => {
    try {
      const parsed = z.object({ kind: z.enum(["p13", "p11"]), id: z.string().min(1).max(180), version: z.string().max(80).optional() }).strict().parse(req.query);
      res.json(getP13ExtensionService().inspect(await currentOwner(req), parsed.kind, parsed.id, parsed.version));
    } catch (error) { next(error); }
  });
  router.post("/revoke", async (req, res, next) => {
    try {
      const parsed = revokeSchema.parse(req.body);
      const actor = await currentOwner(req);
      const result = getP13ExtensionService().revoke(actor, parsed.kind, parsed.id, parsed.digest, parsed.version);
      await recordAuditEvent(actor.userId, "extension_revoked", { kind: parsed.kind, id: parsed.id, digest: parsed.digest, version: parsed.version });
      res.json(result);
    } catch (error) { next(error); }
  });
  router.post("/cancel", async (req, res, next) => {
    try {
      const parsed = z.object({ previewId: z.string().uuid() }).strict().parse(req.body);
      getP13ExtensionService().cancel(await currentOwner(req), parsed.previewId);
      res.json({ cancelled: true });
    } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof ExtensionAdmissionError) return res.status(error.status).json({ error: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid local extension request.", issues: error.issues });
    if (error instanceof Error) return res.status(409).json({ error: error.message });
    next(error);
  });
  app.use("/api/extensions", router);
}
