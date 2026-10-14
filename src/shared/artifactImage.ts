import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";

export const ARTIFACT_IMAGE_LIMITS = { bytes: 1024 * 1024, totalBytes: 3 * 1024 * 1024, dimension: 4096, pixels: 16 * 1024 * 1024 } as const;
const imageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]),
  dataBase64: z.string().min(4).max(Math.ceil(ARTIFACT_IMAGE_LIMITS.bytes / 3) * 4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().min(1).max(ARTIFACT_IMAGE_LIMITS.bytes),
  width: z.number().int().min(1).max(ARTIFACT_IMAGE_LIMITS.dimension),
  height: z.number().int().min(1).max(ARTIFACT_IMAGE_LIMITS.dimension),
  sourceRef: z.string().trim().min(1).max(1000),
}).strict();
export type ArtifactImage = z.infer<typeof imageSchema>;
export function artifactImageBytes(image: ArtifactImage): Uint8Array {
  const decoded = atob(image.dataBase64);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}
export function artifactImageDataUri(image: ArtifactImage): string { return `data:${image.mimeType};base64,${image.dataBase64}`; }
export function artifactImageDimensions(bytes: Uint8Array, mimeType: ArtifactImage["mimeType"]): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value) || view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("Captured PNG signature/header is invalid.");
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw new Error("Captured JPEG signature is invalid.");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) throw new Error("Captured JPEG marker is invalid.");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) break;
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) throw new Error("Captured JPEG segment is invalid.");
    if ([192, 193, 194].includes(marker)) {
      if (size < 8) throw new Error("Captured JPEG frame is invalid.");
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += size;
  }
  throw new Error("Captured JPEG has no supported frame dimensions.");
}
export function readArtifactImage(value: unknown): ArtifactImage {
  const image = imageSchema.parse(value);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64)) throw new Error("Captured image base64 is invalid.");
  const finalGroup = image.dataBase64.slice(-4);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if ((finalGroup.endsWith("==") && (alphabet.indexOf(finalGroup[1]) & 15) !== 0)
    || (finalGroup.endsWith("=") && !finalGroup.endsWith("==") && (alphabet.indexOf(finalGroup[2]) & 3) !== 0)) throw new Error("Captured image base64 has noncanonical padding bits.");
  const bytes = artifactImageBytes(image);
  if (bytes.length !== image.byteLength) throw new Error("Captured image byte count mismatch.");
  const hash = [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== image.sha256) throw new Error("Captured image integrity mismatch.");
  const dimensions = artifactImageDimensions(bytes, image.mimeType);
  if (dimensions.width !== image.width || dimensions.height !== image.height || image.width * image.height > ARTIFACT_IMAGE_LIMITS.pixels) throw new Error("Captured image dimensions mismatch or exceed bounds.");
  return image;
}
