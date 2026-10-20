import { z } from "zod";

/**
 * Reference to an Artifact that a Project conversation run retained, stored in the assistant message's
 * existing `metadata.persistedArtifacts`. It is a pointer only: the canonical Artifact (content, versions,
 * tenant/Project access) stays in the P4 store and is always resolved through its access-checked queries.
 * `title` and `kind` are a display snapshot taken at retention time; entries written before they existed
 * carry only `id` and `version` and remain valid.
 */
export const savedMessageArtifactRefSchema = z.object({
  id: z.string().regex(/^artifact:[0-9a-f-]{36}$/i),
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  kind: z.string().trim().min(1).max(40).optional(),
}).passthrough();

export interface SavedMessageArtifactRef {
  id: string;
  version: number;
  title: string | null;
  kind: string | null;
}

const MAX_REFS_PER_MESSAGE = 20;

/** Retained-Artifact reference written into message metadata at persistence time. */
export function retainedArtifactMessageRef(input: {
  artifact: { id: string; title: string; kind: string };
  version: { version: number };
}): { id: string; version: number; title: string; kind: string } {
  return { id: input.artifact.id, version: input.version.version, title: input.artifact.title.trim().slice(0, 300) || "Saved Artifact", kind: input.artifact.kind };
}

/** Malformed or foreign-shaped entries are ignored; duplicates collapse to the first occurrence. */
const metadataEnvelopeSchema = z.object({ persistedArtifacts: z.array(z.unknown()).optional() }).passthrough();

export function savedMessageArtifactRefs(metadata: unknown): SavedMessageArtifactRef[] {
  const envelope = metadataEnvelopeSchema.safeParse(metadata);
  if (!envelope.success || !envelope.data.persistedArtifacts) return [];
  const entries = envelope.data.persistedArtifacts;
  const seen = new Set<string>();
  const refs: SavedMessageArtifactRef[] = [];
  for (const entry of entries) {
    const parsed = savedMessageArtifactRefSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    refs.push({ id: parsed.data.id, version: parsed.data.version, title: parsed.data.title ?? null, kind: parsed.data.kind ?? null });
    if (refs.length >= MAX_REFS_PER_MESSAGE) break;
  }
  return refs;
}
