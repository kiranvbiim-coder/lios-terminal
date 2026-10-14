import {
  RESEARCH_SOURCE_COMPOSITION_VERSION,
  researchSourceCompositionSchema,
  researchSourceMetadataSchema,
  type BlockedResearchSource,
  type ComposedResearchSource,
  type ResearchCompositionBlockReason,
  type ResearchCompositionUse,
  type ResearchSourceClass,
  type ResearchSourceComposition,
  type ResearchSourceMetadata,
} from "@shared/researchSourceComposition";
import type { P7ProjectDocument } from "@shared/p7ResearchContracts";

const SECRET_VALUE = /(?:[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|secret|password)=|\b(?:authorization|bearer)\s*[:= ]\s*\S+)/i;
const USER_ATTACHMENT_KIND = "chat_attachment";

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cleanString(value: unknown, max = 1_000): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().slice(0, max);
  return clean && !SECRET_VALUE.test(clean) ? clean : null;
}

function cleanUrl(value: unknown): string | null {
  const clean = cleanString(value, 2_000);
  if (!clean) return null;
  try {
    return new URL(clean).toString();
  } catch {
    return null;
  }
}

function explicitResearchSource(doc: P7ProjectDocument): ResearchSourceMetadata | null {
  const parsed = researchSourceMetadataSchema.safeParse(doc.metadata.researchSource);
  if (!parsed.success) return null;
  const identity = parsed.data.identity;
  if (
    SECRET_VALUE.test(identity.sourceId)
    || (identity.providerId && SECRET_VALUE.test(identity.providerId))
    || (identity.url && SECRET_VALUE.test(identity.url))
  ) return null;
  return parsed.data;
}

function userFileResearchSource(doc: P7ProjectDocument): ResearchSourceMetadata | null {
  const metadata = metadataRecord(doc.metadata);
  const isAttachment = metadata.kind === USER_ATTACHMENT_KIND
    || typeof metadata.attachmentSourceRef === "string";
  if (!isAttachment) return null;
  const sourceId = cleanString(metadata.attachmentSourceRef)
    ?? cleanString(metadata.resourceRef)
    ?? doc.sourceRef;
  return researchSourceMetadataSchema.parse({
    class: "user_file",
    identity: {
      sourceId,
      providerId: null,
      organization: null,
      author: null,
      analystId: null,
      expertId: null,
      url: null,
    },
    rights: {
      entitlement: {
        decision: "allowed",
        policyId: null,
        permittedUses: ["internal_research"],
        reasons: [
          "User-owned Project attachment is locally available to its owner; AI-transmission and redistribution rights are not inferred.",
        ],
      },
      aiTransmission: "unknown",
      internalUse: "permitted",
      redistribution: "unknown",
    },
  });
}

function browserResearchSource(doc: P7ProjectDocument): ResearchSourceMetadata | null {
  const metadata = metadataRecord(doc.metadata);
  const sourceUrl = cleanUrl(metadata.resolvedUrl)
    ?? cleanUrl(metadata.sourceUrl)
    ?? cleanUrl(metadata.requestedUrl);
  const acquisitionRef = cleanString(metadata.acquisitionRef);
  if (!sourceUrl || !acquisitionRef) return null;
  return researchSourceMetadataSchema.parse({
    class: "public_external",
    identity: {
      sourceId: doc.sourceRef,
      providerId: cleanString(metadata.provider, 240),
      organization: null,
      author: null,
      analystId: null,
      expertId: null,
      url: sourceUrl,
    },
    rights: {
      entitlement: {
        decision: "unknown",
        policyId: null,
        permittedUses: [],
        reasons: [
          "Governed browser acquisition proves source identity, not downstream entitlement or AI-transmission rights.",
        ],
      },
      aiTransmission: "unknown",
      internalUse: "unknown",
      redistribution: "unknown",
    },
  });
}

export function researchSourceForDocument(doc: P7ProjectDocument): ResearchSourceMetadata | null {
  return explicitResearchSource(doc)
    ?? userFileResearchSource(doc)
    ?? browserResearchSource(doc);
}

/**
 * Canonical provider identity for indexed research filtering.
 * Only explicit server-indexed metadata participates; prose, URLs and source labels never do.
 */
export function researchProviderIdForDocument(doc: P7ProjectDocument): string | null {
  const explicit = explicitResearchSource(doc);
  if (explicit) return explicit.identity.providerId;

  const metadata = metadataRecord(doc.metadata);
  const isAttachment = metadata.kind === USER_ATTACHMENT_KIND
    || typeof metadata.attachmentSourceRef === "string";
  if (isAttachment) return null;

  return cleanString(metadata.provider, 200);
}

function blockReasonForUse(source: ResearchSourceMetadata, targetUse: ResearchCompositionUse): ResearchCompositionBlockReason | null {
  if (source.rights.entitlement.decision === "denied") return "entitlement_denied";
  if (source.rights.entitlement.decision === "unknown") return "entitlement_unknown";

  if (source.rights.internalUse === "restricted") return "internal_use_restricted";
  if (source.rights.internalUse === "unknown") return "internal_use_unknown";

  if (targetUse === "ai_assistance") {
    if (source.rights.aiTransmission === "restricted") return "ai_transmission_restricted";
    if (source.rights.aiTransmission === "unknown") return "ai_transmission_unknown";
  }

  if (targetUse === "redistribution") {
    if (source.rights.redistribution === "restricted") return "redistribution_restricted";
    if (source.rights.redistribution === "unknown") return "redistribution_unknown";
  }

  return null;
}

function excerpt(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.slice(0, 1_800);
}

function composed(doc: P7ProjectDocument, source: ResearchSourceMetadata): ComposedResearchSource {
  return {
    documentId: doc.id,
    sourceRef: doc.sourceRef,
    sourceType: doc.sourceType,
    title: doc.title,
    sourceClass: source.class,
    identity: source.identity,
    rights: source.rights,
    occurredAt: doc.occurredAt,
    contentHash: doc.contentHash,
    sourceRefs: doc.sourceRefs.slice(0, 500),
    entityRefs: doc.entityRefs.slice(0, 500),
    excerpt: excerpt(doc.body),
  };
}

function blocked(
  doc: P7ProjectDocument,
  source: ResearchSourceMetadata | null,
  reason: ResearchCompositionBlockReason,
): BlockedResearchSource {
  return {
    documentId: doc.id,
    sourceRef: doc.sourceRef,
    sourceClass: source?.class ?? null,
    identity: source?.identity ?? null,
    reason,
  };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function composeResearchSources(input: {
  documents: readonly P7ProjectDocument[];
  targetUse: ResearchCompositionUse;
  sourceClasses?: readonly ResearchSourceClass[];
}): ResearchSourceComposition {
  const classFilter = new Set(input.sourceClasses ?? []);
  const included: ComposedResearchSource[] = [];
  const blockedSources: BlockedResearchSource[] = [];
  const byClass: Record<string, number> = {};
  const byBlockReason: Record<string, number> = {};

  for (const doc of input.documents) {
    const source = researchSourceForDocument(doc);
    if (source && classFilter.size && !classFilter.has(source.class)) continue;
    if (!source) {
      if (classFilter.size) continue;
      const item = blocked(doc, null, "source_identity_unknown");
      blockedSources.push(item);
      increment(byBlockReason, item.reason);
      continue;
    }

    increment(byClass, source.class);
    const reason = blockReasonForUse(source, input.targetUse);
    if (reason) {
      const item = blocked(doc, source, reason);
      blockedSources.push(item);
      increment(byBlockReason, reason);
      continue;
    }

    included.push(composed(doc, source));
  }

  return researchSourceCompositionSchema.parse({
    schemaVersion: RESEARCH_SOURCE_COMPOSITION_VERSION,
    targetUse: input.targetUse,
    included,
    blocked: blockedSources,
    counts: {
      included: included.length,
      blocked: blockedSources.length,
      byClass,
      byBlockReason,
    },
  });
}
