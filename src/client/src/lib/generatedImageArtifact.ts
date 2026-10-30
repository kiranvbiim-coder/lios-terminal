import type { ArtifactContent } from "@shared/artifactContracts";
import { artifactImageDataUri, readArtifactImage } from "@shared/artifactImage";

export interface GeneratedImageView {
  src: string;
  alt: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  createdAt: string | null;
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** Reads the generated-image Artifact shape; returns null for anything else or an unsafe source. */
export function generatedImageFromContent(content: ArtifactContent | null | undefined): GeneratedImageView | null {
  if (!content || content.kind !== "report" || content.templateId !== "generated_image") return null;
  const block = content.blocks?.find((candidate) => candidate.type === "image");
  const attrs = block?.attrs ?? {};
  let src: string;
  try { src = artifactImageDataUri(readArtifactImage(attrs.image)); } catch { return null; }
  const prompt = text(attrs.prompt) ?? text(attrs.alt) ?? "";
  return { src, alt: text(attrs.alt) ?? prompt ?? "Generated image", prompt, provider: text(attrs.provider), model: text(attrs.model), createdAt: text(attrs.createdAt) };
}

export function generatedImageFileName(image: Pick<GeneratedImageView, "src" | "prompt">): string {
  const ext = image.src.startsWith("data:image/jpeg") ? "jpg" : "png";
  const stem = image.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stem || "generated-image"}.${ext}`;
}

/** Plain-language message for a failed image request. */
export function generatedImageErrorMessage(status: number, body: { errorCode?: unknown; error?: unknown } | null): string {
  const serverText = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
  if (status === 402) return "Your trial or license is read-only right now, so new images can't be created.";
  if (status === 403 && body?.errorCode === "ai_not_connected") return "Connect an AI provider in Settings to create images.";
  if (status === 422 && body?.errorCode === "image_not_supported") return serverText ?? "Your connected AI provider can't create images.";
  if (status === 502) return serverText ?? "The AI provider couldn't create the image. Try again.";
  return serverText ?? "The image couldn't be created. Try again.";
}
