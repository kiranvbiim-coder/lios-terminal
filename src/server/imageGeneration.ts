import type { Request, Response } from "express";
import { z } from "zod";
import { tenantContext } from "./tenantContext";
import { addProjectChatMessage } from "./projectChatStore";
import { GenerativeArtifactError, saveGeneratedArtifact } from "./generativeArtifactTools";
import { aiImageResponseError, AIProviderError } from "./byoaiTransport";
import { isReadOnlyModeError } from "./accessMode";

export async function generateImageHandler(req: Request, res: Response): Promise<void> {
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", disconnect);
  try {
    const chatId = z.coerce.number().int().positive().parse(req.params.chatId);
    const { prompt } = z.object({ prompt: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    const ctx = tenantContext(req.user!);
    const saved = await saveGeneratedArtifact(ctx, chatId, "image", prompt, controller.signal);
    await addProjectChatMessage(ctx, chatId, { role: "assistant", content: "Created an AI-generated image.", metadata: { persistedArtifacts: [{ id: saved.artifact.id, version: saved.version.version, title: saved.artifact.title, kind: "report" }] } });
    res.json({ artifact: { id: saved.artifact.id, version: saved.version.version } });
  } catch (error) {
    if (controller.signal.aborted) return;
    if (isReadOnlyModeError(error)) { res.status(error.status).json(error.body()); return; }
    if (error instanceof GenerativeArtifactError) { res.status(error.status).json({ errorCode: error.code, error: error.message }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Enter an image description of up to 4,000 characters." }); return; }
    if (error instanceof AIProviderError) { res.status(502).json({ error: aiImageResponseError(error) }); return; }
    if (error instanceof Error && /not found|not owned|outside/i.test(error.message)) { res.status(404).json({ error: "Chat not found." }); return; }
    res.status(502).json({ error: "The image could not be created. Try again." });
  } finally { res.off("close", disconnect); }
}
