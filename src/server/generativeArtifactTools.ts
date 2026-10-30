import crypto from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { artifactContentSchema, type ArtifactContent } from "@shared/artifactContracts";
import { artifactImageDimensions, readArtifactImage } from "@shared/artifactImage";
import { getDb } from "./db";
import { assertExecutionAllowed } from "./accessMode";
import { requireMasterAiOn } from "./masterAiGate";
import { normalizeProviderId } from "./byoaiRouter";
import { invokeAIImageGeneration, invokeAIRoutedCompletion } from "./byoaiTransport";
import { fitGeneratedPng } from "./generatedImagePng";
import { createArtifact } from "./artifactStore";
import { getProjectChat } from "./projectChatStore";
import type { TenantContext } from "./tenantContext";
import type { ConversationToolDefinition, ConversationToolResult } from "./conversationRuntime";
import type { GovernedToolCall } from "./governedTools";

export class GenerativeArtifactError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const generativeInputSchema = z.object({ prompt: z.string().trim().min(1).max(4_000), format: z.enum(["report", "table"]).default("report") }).strict();
export function generativeRequestKind(message: string): "image" | "document" | null {
  if (/^\s*(?:please\s+)?(?:create|generate|draw|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|illustration|poster)\b/i.test(message)) return "image";
  if (/^\s*(?:please\s+)?(?:write|draft|create|make|generate)\s+(?:me\s+)?(?:an?\s+)?(?:memo|document|report|letter|essay|table|spreadsheet)\b/i.test(message)) return "document";
  return null;
}

export async function generateArtifactContent(ctx: TenantContext, kind: "image" | "document", prompt: string, signal: AbortSignal, format: "report" | "table" = "report"): Promise<{ content: ArtifactContent; title: string; sourceRefs: string[] }> {
  generativeInputSchema.parse({ prompt, format });
  await assertExecutionAllowed("ai");
  const [user] = await getDb().select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user || user.organizationId !== ctx.organizationId) throw new GenerativeArtifactError(403, "ai_not_connected", "Sign in to connect your AI.");
  const gate = await requireMasterAiOn({ id: user.id, email: user.email, role: ctx.role, organizationId: ctx.organizationId });
  if (!gate.ok) throw new GenerativeArtifactError(gate.status, gate.code, gate.error);
  signal.throwIfAborted();
  const provider = normalizeProviderId(gate.provider);
  if (!provider) throw new GenerativeArtifactError(403, "ai_not_connected", "Reconnect your AI provider.");
  if (kind === "image") {
    if (provider !== "openai" && provider !== "gemini") throw new GenerativeArtifactError(422, "image_not_supported", "Your connected AI does not create images. Choose OpenAI or Google Gemini in Connections.");
    const result = await invokeAIImageGeneration({ provider, chatModel: gate.model, prompt, signal });
    const bytes = fitGeneratedPng(result.bytes);
    const sourceRef = `ai-generated:${crypto.randomUUID()}`;
    const image = readArtifactImage({ mimeType: "image/png", dataBase64: bytes.toString("base64"), byteLength: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), ...artifactImageDimensions(bytes, "image/png"), sourceRef });
    return { title: prompt.slice(0, 120), sourceRefs: [sourceRef], content: artifactContentSchema.parse({ kind: "report", templateId: "generated_image", blocks: [{ id: "generated-image", type: "image", text: "AI-generated image", attrs: { image, sourceRef, prompt, alt: prompt, provider, model: result.model, createdAt: new Date().toISOString() } }], sections: [] }) };
  }
  const system = format === "table"
    ? "Create the requested table as one Markdown table (header row, separator row, then up to 100 rows and 20 columns). Output only the table. Never invent observations or sources; leave unknown cells empty. Label user-provided assumptions."
    : "Write the requested document in Markdown using only # headings, paragraphs and - bullet lists. Output only the document. Do not invent citations or claim live research. Distinguish assumptions from facts.";
  const result = await invokeAIRoutedCompletion({ preferredProvider: provider, preferredModel: gate.model, fallback: "none", system, messages: [{ role: "user", content: prompt }], maxTokens: 4000, signal, dataClassification: "organization" });
  signal.throwIfAborted();
  const content = format === "table" ? markdownTableContent(result.text) : markdownReportContent(result.text);
  return { content, title: prompt.slice(0, 120), sourceRefs: [`ai-provider:${provider}`] };
}

/** Markdown is the format every model can write reliably; it is converted into editable blocks here. */
export function markdownReportContent(markdown: string): ArtifactContent {
  const blocks: Array<{ id: string; type: "heading" | "paragraph" | "bullet_list" | "callout"; text: string; attrs: Record<string, unknown> }> = [
    { id: "provenance", type: "callout", text: "AI-written draft. Review factual claims before use.", attrs: {} },
  ];
  let paragraph: string[] = [], bullets: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ id: `block-${blocks.length}`, type: "paragraph", text: paragraph.join(" "), attrs: {} });
    if (bullets.length) blocks.push({ id: `block-${blocks.length}`, type: "bullet_list", text: bullets.join("\n"), attrs: {} });
    paragraph = []; bullets = [];
  };
  for (const raw of markdown.replace(/^```(?:markdown|md)?\s*|\s*```\s*$/gi, "").split(/\r?\n/)) {
    // Inline emphasis markers would otherwise appear as literal asterisks in the editor.
    const line = raw.trim().replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/`([^`]+)`/g, "$1");
    const heading = /^#{1,6}\s+(.+)$/.exec(line), bullet = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (!line) { flush(); continue; }
    if (heading) { flush(); blocks.push({ id: `block-${blocks.length}`, type: "heading", text: heading[1], attrs: {} }); }
    else if (bullet) { if (paragraph.length) flush(); bullets.push(bullet[1]); }
    else { if (bullets.length) flush(); paragraph.push(line); }
    if (blocks.length >= 200) break;
  }
  flush();
  if (blocks.length < 2) throw new GenerativeArtifactError(502, "empty_document", "Your AI returned an empty document. Try again.");
  return artifactContentSchema.parse({ kind: "report", templateId: "ai_written", blocks: blocks.map(block => ({ ...block, text: block.text.slice(0, 20_000) })), sections: [] });
}

export function markdownTableContent(markdown: string): ArtifactContent {
  const rows = markdown.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("|") || (line.match(/\|/g)?.length ?? 0) >= 2)
    .map(line => line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()))
    .filter(cells => !cells.every(cell => /^:?-{2,}:?$/.test(cell)));
  if (rows.length < 2) throw new GenerativeArtifactError(502, "empty_table", "Your AI did not return a table. Try again or rephrase.");
  const header = rows[0].slice(0, 20);
  const columns = header.map((label, index) => ({ key: `c${index + 1}`, label: (label || `Column ${index + 1}`).slice(0, 200) }));
  const body = rows.slice(1, 101).map(cells => Object.fromEntries(columns.map((column, index) => [column.key, cells[index] ? cells[index].slice(0, 4000) : null])));
  return artifactContentSchema.parse({ kind: "table", columns, rows: body });
}

export async function saveGeneratedArtifact(ctx: TenantContext, chatId: number, kind: "image" | "document", prompt: string, signal: AbortSignal, format: "report" | "table" = "report") {
  const chat = await getProjectChat(ctx, chatId);
  const generated = await generateArtifactContent(ctx, kind, prompt, signal, format);
  signal.throwIfAborted();
  // Recheck owner before committing an output after the provider await.
  await getProjectChat(ctx, chatId);
  return createArtifact(ctx, { projectId: chat.projectId, owningChatId: chatId, ...generated, origin: "conversation", actorType: "conversation", note: "AI-generated draft; not independently verified." });
}

const tenantSchema = z.object({ userId: z.number().int().positive(), organizationId: z.number().int().positive().nullable(), role: z.enum(["internal_admin", "internal_analyst", "client_admin", "client_user"]) });
const outputSchema = z.object({ output: z.object({ artifactId: z.string(), version: z.number().int().positive() }), summary: z.string(), deterministic: z.literal(false), sourceRefs: z.array(z.string()) });
function definition(kind: "image" | "document"): ConversationToolDefinition {
  return {
    id: kind === "image" ? "lios.image.generate" : "lios.document.write", label: kind === "image" ? "Create an AI image" : "Write an editable document or table",
    kind: "calculate", permissionClass: "safe_auto", access: "write", sideEffect: "internal_write", replaySafe: false, cancel: null,
    inputSchema: generativeInputSchema, outputSchema,
    invoke: async (raw: Record<string, unknown>, signal: AbortSignal, call: GovernedToolCall): Promise<ConversationToolResult> => {
      const ctx = tenantSchema.parse(call.tenant);
      if (call.userId !== ctx.userId || !call.chatId) throw new Error("Open a saved Chat before creating an Artifact.");
      const input = generativeInputSchema.parse(raw);
      const saved = await saveGeneratedArtifact(ctx, call.chatId, kind, input.prompt, signal, input.format);
      return { output: { artifactId: saved.artifact.id, version: saved.version.version }, summary: `Created an AI-written ${kind === "image" ? "image" : input.format} draft.`, deterministic: false, sourceRefs: saved.version.sourceRefs };
    },
  };
}
export const imageGenerationTool = definition("image");
export const documentGenerationTool = definition("document");
