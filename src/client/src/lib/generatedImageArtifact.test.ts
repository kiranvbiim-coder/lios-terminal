import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generatedImageFileName, generatedImageFromContent } from "./generatedImageArtifact";

const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xoAAAAASUVORK5CYII=", "base64");
const imageData = { mimeType: "image/png", dataBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length, width: 1, height: 1, sourceRef: "ai-generated:test" };
const report = (image: unknown, templateId: string | null = "generated_image") => ({
  kind: "report", templateId, sections: [],
  blocks: [{ id: "b1", type: "image", text: "", attrs: { image, alt: "A red fox", prompt: "A red fox", provider: "OpenAI", model: "gpt-image-1", createdAt: "2026-10-30T10:00:00.000Z" } }],
}) as never;

test("reads a generated image Artifact and refuses other reports or unsafe sources", () => {
  const image = generatedImageFromContent(report(imageData));
  assert.equal(image?.prompt, "A red fox");
  assert.equal(image?.provider, "OpenAI");
  assert.equal(generatedImageFileName(image!), "a-red-fox.png");
  assert.equal(generatedImageFromContent(report(imageData, null)), null);
  assert.equal(generatedImageFromContent(report({ ...imageData, sha256: "0".repeat(64) })), null);
  assert.equal(generatedImageFromContent(report({ ...imageData, dataBase64: "https://example.com/x.png" })), null);
});

