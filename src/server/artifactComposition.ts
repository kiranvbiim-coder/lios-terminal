import { inflateSync } from "node:zlib";
import { z } from "zod";
import { artifactContentSchema } from "@shared/artifactContracts";
import type { RichArtifactBlock } from "@shared/artifactContracts";
import { ARTIFACT_IMAGE_LIMITS, artifactImageDimensions, readArtifactImage } from "@shared/artifactImage";
import { assertArtifactRefsSafe, createArtifactProposal, getArtifact, getArtifactVersion, listArtifactProposals } from "./artifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { hashLedgerValue } from "./ledgerStore";
import { loadProjectAttachment } from "./projectAttachmentService";
import type { TenantContext } from "./tenantContext";

export const artifactCompositionRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
  kind: z.enum(["image", "chart", "table", "artifact"]),
  sourceId: z.string().trim().min(1).max(300),
  sourceVersion: z.number().int().positive().optional(),
  caption: z.string().max(4_000).default(""),
  sectionId: z.string().trim().min(1).max(200).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.kind === "image") {
    if (!z.string().uuid().safeParse(input.sourceId).success) ctx.addIssue({ code: "custom", path: ["sourceId"], message: "Choose an owned Project image attachment id." });
    if (input.sourceVersion !== undefined) ctx.addIssue({ code: "custom", path: ["sourceVersion"], message: "Image attachment capture has no Artifact version." });
  } else if (input.sourceVersion === undefined) {
    ctx.addIssue({ code: "custom", path: ["sourceVersion"], message: "Choose an explicit immutable source Artifact version." });
  }
});

const MAX_COMPOSITION_BYTES = 6 * 1024 * 1024;

async function assertCompositionRights(ctx: TenantContext, refs: readonly string[]): Promise<void> {
  assertArtifactRefsSafe(refs);
  const now = new Date();
  for (const ref of new Set(refs)) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    if (!policy || policy.effectiveFrom > now || (policy.effectiveTo !== null && policy.effectiveTo <= now)
      || !["display", "derived_output", "export"].every(use => policy.permittedUses.includes(use))
      || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))) {
      throw new Error("Current linked source rights do not permit Artifact composition.");
    }
  }
}

/** Acceptance rechecks captured custody and live rights without downloading or reviving the original source. */
export async function revalidateArtifactComposition(ctx: TenantContext, raw: unknown, inheritedRefs: readonly string[] = []): Promise<void> {
  const content = artifactContentSchema.parse(raw);
  if (content.kind !== "report" && content.kind !== "research") return;
  const refs = [...inheritedRefs];
  let imageBytes = 0;
  for (const block of content.blocks) {
    if (block.attrs.sourceRefs !== undefined) refs.push(...z.array(z.string().trim().min(1).max(1_000)).max(5_000).parse(block.attrs.sourceRefs));
    if (typeof block.attrs.sourceRef === "string") refs.push(block.attrs.sourceRef);
    if (block.type !== "image") continue;
    const image = readArtifactImage(block.attrs.image);
    imageBytes += image.byteLength;
    const bytes = Buffer.from(image.dataBase64, "base64");
    if (image.mimeType === "image/png") assertPngStream(bytes, image.width, image.height);
    else assertJpegStream(bytes);
    refs.push(image.sourceRef);
  }
  if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) throw new Error("Artifact composition images exceed the 3 MiB total bound.");
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > MAX_COMPOSITION_BYTES) throw new Error("Artifact composition exceeds the 6 MiB canonical snapshot bound.");
  await assertCompositionRights(ctx, refs);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate the actual local PNG stream, not just its name or header metadata. */
function assertPngStream(bytes: Buffer, width: number, height: number): void {
  const compressed: Buffer[] = [];
  let offset = 8;
  let header = false;
  let ended = false;
  let seenData = false;
  let dataEnded = false;
  let palette = false;
  let bitDepth = 0;
  let channels = 0;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) throw new Error("Invalid PNG chunk bounds.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== bytes.readUInt32BE(offset + 8 + size)) throw new Error("Invalid PNG chunk checksum.");
    const payload = bytes.subarray(offset + 8, offset + 8 + size);
    if (!header && type !== "IHDR") throw new Error("Invalid PNG header order.");
    if (type === "IHDR") {
      if (header || size !== 13) throw new Error("Invalid PNG header.");
      header = true;
      bitDepth = payload[8];
      const color = payload[9];
      const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
      if (!depths[color]?.includes(bitDepth) || payload[10] !== 0 || payload[11] !== 0 || payload[12] > 1) throw new Error("Invalid PNG encoding.");
    } else if (type === "PLTE") {
      if (seenData || palette || size === 0 || size % 3 !== 0 || size > 768) throw new Error("Invalid PNG palette.");
      palette = true;
    } else if (type === "IDAT") {
      if (dataEnded) throw new Error("Invalid PNG data order.");
      seenData = true;
      compressed.push(payload);
    } else if (type === "IEND") {
      if (size !== 0 || !seenData || offset + 12 !== bytes.length) throw new Error("Invalid PNG ending.");
      ended = true;
      break;
    } else {
      if (seenData) dataEnded = true;
      if (type === "acTL" || type === "fcTL" || type === "fdAT") throw new Error("Only static PNG images may be composed.");
      if (type[0] === type[0].toUpperCase()) throw new Error("Invalid unsupported PNG critical chunk.");
    }
    offset += size + 12;
  }
  if (!ended || (bytes[25] === 3 && !palette)) throw new Error("Invalid incomplete PNG image.");
  const passes = bytes[28] === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx));
    const h = Math.max(0, Math.ceil((height - y) / dy));
    return { height: w ? h : 0, stride: 1 + Math.ceil(w * channels * bitDepth / 8) };
  });
  const expected = rows.reduce((sum, row) => sum + row.height * row.stride, 0);
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); }
  catch { throw new Error("Invalid PNG compressed image data."); }
  if (pixels.length !== expected) throw new Error("Invalid PNG decoded image bounds.");
  let cursor = 0;
  for (const row of rows) for (let y = 0; y < row.height; y++, cursor += row.stride) {
    if (pixels[cursor] > 4) throw new Error("Invalid PNG row filter.");
  }
}

function assertJpegStream(bytes: Buffer): void {
  let offset = 2;
  let frame = false;
  let scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG marker.");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scan || offset !== bytes.length) throw new Error("Invalid JPEG ending.");
      return;
    }
    if (marker === undefined || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) throw new Error("Invalid JPEG marker order.");
    if (offset + 2 > bytes.length) throw new Error("Invalid JPEG segment bounds.");
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) throw new Error("Invalid JPEG segment bounds.");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || size < 8 || bytes[offset + 2] !== 8 || size !== 8 + 3 * bytes[offset + 7]) throw new Error("Invalid JPEG frame.");
      frame = true;
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      throw new Error("Only standard JPEG frames may be composed.");
    }
    offset += size;
    if (marker === 0xda) {
      if (!frame || size < 6) throw new Error("Invalid JPEG scan.");
      scan = true;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
    }
  }
  throw new Error("Invalid incomplete JPEG image.");
}

function metadataRefs(metadata: Record<string, unknown>): string[] {
  return ["sourceRefs", "dependencyRefs"].flatMap(key => {
    const refs = metadata[key];
    if (refs === undefined) return [];
    return z.array(z.string().trim().min(1).max(1_000)).max(5_000).parse(refs);
  });
}

/** Explicit selection captures owned immutable bytes/content into a pending P4 append, never applies it. */
export async function proposeArtifactComposition(ctx: TenantContext, artifactId: string, raw: unknown) {
  const input = artifactCompositionRequestSchema.parse(raw);
  const target = await getArtifact(ctx, artifactId);
  if (target.headVersion !== input.baseVersion) throw new Error("Artifact composition base version is stale.");
  const base = await getArtifactVersion(ctx, artifactId, input.baseVersion);
  if (hashLedgerValue(base.content) !== base.contentHash) throw new Error("Invalid target Artifact immutable content hash.");
  const content = artifactContentSchema.parse(base.content);
  if (content.kind !== "report" && content.kind !== "research") throw new Error("Only report or research Artifacts support composition.");
  if (input.sectionId && (content.kind !== "report" || !content.sections.some(section => section.id === input.sectionId))) throw new Error("Invalid selected report section.");
  await assertCompositionRights(ctx, [...base.sourceRefs, ...base.dependencyRefs]);

  let block: RichArtifactBlock;
  let sourceRef: string;
  let sourceHash: string;
  let sourceRefs: string[];
  if (input.kind === "image") {
    if (target.projectId === null) throw new Error("Project image attachments require an Artifact in their owning Project.");
    const { resource, reference, bytes } = await loadProjectAttachment(ctx, target.projectId, input.sourceId);
    if (reference.kind !== "image" || !["image/png", "image/jpeg"].includes(reference.mimeType)
      || reference.byteLength !== bytes.length || bytes.length > ARTIFACT_IMAGE_LIMITS.bytes
      || reference.sourceRef !== `project-attachment:${input.sourceId}`) throw new Error("Invalid Project image metadata or image exceeds the 1 MiB composition limit.");
    sourceRef = reference.sourceRef;
    sourceHash = reference.sha256;
    sourceRefs = [...new Set([sourceRef, ...metadataRefs(resource.metadata as Record<string, unknown>)])];
    await assertCompositionRights(ctx, sourceRefs);
    // The canonical validator verifies actual signature, dimensions, SHA-256 and exact base64 bytes.
    const dataBase64 = bytes.toString("base64");
    const dimensions = artifactImageDimensions(bytes, reference.mimeType as "image/png" | "image/jpeg");
    const image = readArtifactImage({ mimeType: reference.mimeType, dataBase64, sha256: sourceHash, byteLength: bytes.length, ...dimensions, sourceRef });
    const metadata = resource.metadata as Record<string, unknown>;
    if (metadata.storageVersion !== 1 || (metadata.width !== undefined && metadata.width !== image.width)
      || (metadata.height !== undefined && metadata.height !== image.height)) throw new Error("Invalid stored Project image version or dimensions.");
    if (image.mimeType === "image/png") assertPngStream(bytes, image.width, image.height);
    else assertJpegStream(bytes);
    block = { id: "", type: "image", text: input.caption, attrs: { image, sourceRef, sourceRefs, sourceHash,
      sourceAttachmentId: reference.id, sourceResourceId: resource.id, sourceStorageVersion: 1, captionProvenance: "user_asserted" } };
  } else {
    const source = await getArtifact(ctx, input.sourceId);
    if (source.projectId !== target.projectId || (target.projectId === null && source.owningChatId !== target.owningChatId)) throw new Error("Selected source belongs to a different Artifact ownership context.");
    const revision = await getArtifactVersion(ctx, source.id, input.sourceVersion!);
    if (hashLedgerValue(revision.content) !== revision.contentHash) throw new Error("Invalid source Artifact immutable content hash.");
    const captured = artifactContentSchema.parse(revision.content);
    if (input.kind !== "artifact" && captured.kind !== input.kind) throw new Error(`Selected source Artifact must have ${input.kind} content.`);
    sourceRef = `${source.id}@v${revision.version}`;
    sourceHash = revision.contentHash;
    sourceRefs = [...new Set([sourceRef, ...revision.sourceRefs, ...revision.dependencyRefs])];
    await assertCompositionRights(ctx, sourceRefs);
    block = {
      id: "", type: input.kind === "chart" ? "chart_ref" : input.kind === "table" ? "table" : "artifact_ref", text: input.caption,
      attrs: { sourceRef, sourceRefs, sourceArtifactId: source.id, sourceVersion: revision.version, sourceHash,
        artifactId: source.id, version: revision.version, contentHash: sourceHash, title: source.title, kind: captured.kind,
        captionProvenance: "user_asserted", ...(input.kind === "chart" ? { chart: captured } : input.kind === "table" ? { table: captured } : {}) },
    };
  }
  const selectionHash = hashLedgerValue({ kind: input.kind, sourceRef, sourceHash, caption: input.caption, sectionId: input.sectionId ?? null });
  const stem = `composition:${selectionHash.slice(0, 32)}`;
  let suffix = 0;
  const used = new Set(content.blocks.map(existing => existing.id));
  while (used.has(`${stem}:${suffix}`)) suffix++;
  block.id = `${stem}:${suffix}`;
  content.blocks.push(block);
  let sectionId: string | null = null;
  if (content.kind === "report") {
    if (input.sectionId) {
      const section = content.sections.find(section => section.id === input.sectionId)!;
      section.blockIds.push(block.id);
      sectionId = section.id;
    } else {
      sectionId = `${block.id}:section`;
      while (content.sections.some(section => section.id === sectionId)) sectionId += ":append";
      content.sections.push({ id: sectionId, title: "Selected source composition", blockIds: [block.id] });
    }
  }
  let imageBytes = 0;
  for (const existing of content.blocks) if (existing.type === "image") imageBytes += readArtifactImage(existing.attrs.image).byteLength;
  if (imageBytes > ARTIFACT_IMAGE_LIMITS.totalBytes) throw new Error("Artifact composition images exceed the 3 MiB total bound.");
  const proposed = artifactContentSchema.parse(content);
  if (Buffer.byteLength(JSON.stringify(proposed), "utf8") > MAX_COMPOSITION_BYTES) throw new Error("Artifact composition exceeds the 6 MiB canonical snapshot bound.");
  const proposedHash = hashLedgerValue(proposed);
  const summary = `Append selected ${input.kind} ${sourceRef}; source SHA-256 ${sourceHash}; block ${block.id}${sectionId ? ` in section ${sectionId}` : ""}; caption is user-asserted; proposed content SHA-256 ${proposedHash}. Review exact content before explicit acceptance.`;
  const pending = (await listArtifactProposals(ctx, artifactId)).find(proposal => proposal.status === "pending" && proposal.baseVersion === base.version && proposal.proposedContentHash === proposedHash && proposal.summary === summary);
  const proposal = pending ?? await createArtifactProposal(ctx, { artifactId, baseVersion: base.version, type: "document_edit", summary, patch: proposed as unknown as Record<string, unknown>, actorType: "user" });
  return { proposal, block, sectionId, sourceRefs, sourceHash, proposedContentHash: proposedHash, changed: true };
}
