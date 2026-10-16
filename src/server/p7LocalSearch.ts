import crypto from "node:crypto";
import { p7LocalSearchRequestSchema, type P7LocalSearchResult } from "@shared/p7ResearchContracts";
import type { TenantContext } from "./tenantContext";
import { invokeLocalEmbeddings } from "./byoaiTransport";
import { currentPermittedProjectSearchDocuments } from "./p7ProjectIntelligenceStore";
import { filterPermittedProjectDocuments, searchProjectDocuments } from "./p7ProjectIntelligence";
import { getRequestIdentity, runWithRequestIdentity } from "./requestContext";
import { loadOrganizationCredentials } from "./organizationCredentialVault";
import { researchProviderIdForDocument, researchSourceForDocument, researchSourceUseBlockReason } from "./researchSourceComposition";

/** P7 owns retrieval and sources; local vectors are request-only derived values, never source truth or a second index. */
export async function searchProjectIntelligenceLocally(ctx: TenantContext, projectId: number, raw: unknown): Promise<P7LocalSearchResult> {
  const { localEmbedding, ...request } = p7LocalSearchRequestSchema.parse(raw);
  const permitted = filterPermittedProjectDocuments(await currentPermittedProjectSearchDocuments(ctx, projectId), request);
  const modelPermitted = permitted.filter(document => {
    // Retained provider grants are not current model-input rights; keep provider-bound data on lexical retrieval.
    if (researchProviderIdForDocument(document)) return false;
    const source = researchSourceForDocument(document);
    if (!source) return true; // Explicit owner request for owner-scoped Project content, never an external transfer.
    if (source.class === "user_file") return researchSourceUseBlockReason(source, "internal_research") === null && source.rights.aiTransmission !== "restricted";
    return researchSourceUseBlockReason(source, "ai_assistance") === null;
  });
  const documents = modelPermitted.slice(0, 64);
  const sourceTexts = documents.map(document => `${document.title}\n${document.body.slice(0, Math.max(0, 4_095 - document.title.length))}`);
  const retrieval: P7LocalSearchResult["retrieval"] = {
    mode: "local_embedding", status: "no_permitted_sources", provider: localEmbedding.provider,
    requestedModel: localEmbedding.model, servedModel: null, spaceId: crypto.randomUUID(), dimensions: null,
    generatedAt: new Date().toISOString(), sourceCount: documents.length,
    omittedSourceCount: modelPermitted.length - documents.length,
    rightsBlockedSourceCount: permitted.length - modelPermitted.length,
    sourceRevisions: documents.map(document => ({ documentId: document.id, contentHash: document.contentHash })),
    truncatedSourceCount: documents.filter(document => document.title.length + 1 + document.body.length > 4_096).length,
    persistence: "request_only",
  };
  if (!documents.length) return { hits: [], retrieval };
  const credentials = ctx.organizationId === null ? undefined : await loadOrganizationCredentials(ctx.organizationId);
  const generated = await runWithRequestIdentity({ ...getRequestIdentity(), userId: ctx.userId, organizationId: ctx.organizationId, credentials }, () => invokeLocalEmbeddings({
    ...localEmbedding, inputs: [request.query, ...sourceTexts],
  }));
  // All query/source vectors share one response space. No cached/bare vector from another model or revision is mixed in.
  const vectors = documents.map((document, index) => ({ ...document, embedding: generated.vectors[index + 1]! }));
  // Revocation while a local model was working must also remove the resulting source from presentation.
  const current = new Map((await currentPermittedProjectSearchDocuments(ctx, projectId)).map(document => [document.id, document.contentHash]));
  const stillPermitted = vectors.filter(document => current.get(document.id) === document.contentHash);
  const hits = searchProjectDocuments(stillPermitted, { ...request, queryEmbedding: generated.vectors[0] });
  return { hits, retrieval: { ...retrieval, status: "generated", servedModel: generated.model, dimensions: generated.dimensions, generatedAt: new Date().toISOString(), sourceCount: stillPermitted.length, sourceRevisions: stillPermitted.map(document => ({ documentId: document.id, contentHash: document.contentHash })) } };
}
