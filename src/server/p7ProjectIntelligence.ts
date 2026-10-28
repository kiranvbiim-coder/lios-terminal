import crypto from "node:crypto";
import {
  P7_SCHEMA_VERSION,
  p7ContextGraphSchema,
  p7DeltaSchema,
  p7InsightLensSchema,
  p7ProjectSnapshotSchema,
  p7SearchRequestSchema,
  type P7ContextEdge,
  type P7ContextGraph,
  type P7ContextNode,
  type P7Delta,
  type P7Insight,
  type P7InsightLens,
  type P7ProjectDocument,
  type P7ProjectSnapshot,
  type P7SearchHit,
  type P7SearchRequest,
  type P7TimelineEvent,
} from "@shared/p7ResearchContracts";
import { researchProviderIdForDocument } from "./researchSourceComposition";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) =>
    JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key])
  ).join(",") + "}";
}

export function p7Hash(value: unknown): string {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function p7DocumentId(projectId: number, sourceType: string, sourceRef: string): string {
  return "p7doc:" + p7Hash({ projectId, sourceType, sourceRef }).slice(0, 32);
}

function nodeKindFor(sourceType: P7ProjectDocument["sourceType"]): P7ContextNode["kind"] {
  if (sourceType === "chat") return "chat";
  if (sourceType === "chat_message") return "message";
  if (sourceType === "resource") return "resource";
  if (sourceType === "artifact") return "artifact";
  if (sourceType === "ledger_event") return "ledger_event";
  if (sourceType === "research_evidence") return "evidence";
  if (sourceType === "filing") return "filing";
  if (sourceType === "assumption") return "assumption";
  if (sourceType === "decision") return "decision";
  if (sourceType === "report") return "report";
  if (sourceType === "thesis") return "thesis";
  return "document";
}

function relationType(value: unknown): P7ContextEdge["type"] {
  const allowed = new Set(["contains","mentions","derived_from","supports","contradicts","supersedes","changes","references","decides","assumes","evidences"]);
  return typeof value === "string" && allowed.has(value) ? value as P7ContextEdge["type"] : "references";
}

export function buildReactiveContextGraph(input: {
  projectId: number;
  documents: P7ProjectDocument[];
  generatedAt?: string;
}): P7ContextGraph {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectNodeId = "project:" + input.projectId;
  const nodes: P7ContextNode[] = [{
    id: projectNodeId,
    kind: "project",
    label: "Project " + input.projectId,
    sourceRef: projectNodeId,
    occurredAt: null,
    contentHash: null,
    metadata: {},
  }];
  const edges: P7ContextEdge[] = [];
  const seenNodes = new Set([projectNodeId]);
  const bySourceRef = new Map<string, string>();

  for (const doc of input.documents) {
    const nodeId = "doc:" + doc.id;
    bySourceRef.set(doc.sourceRef, nodeId);
    if (!seenNodes.has(nodeId)) {
      nodes.push({
        id: nodeId,
        kind: nodeKindFor(doc.sourceType),
        label: doc.title,
        sourceRef: doc.sourceRef,
        occurredAt: doc.occurredAt,
        contentHash: doc.contentHash,
        metadata: { sourceType: doc.sourceType, ...doc.metadata },
      });
      seenNodes.add(nodeId);
    }
    edges.push({
      id: "edge:" + p7Hash({ from: projectNodeId, to: nodeId, type: "contains" }).slice(0, 32),
      from: projectNodeId,
      to: nodeId,
      type: "contains",
      evidenceRefs: [doc.sourceRef],
      metadata: {},
    });

    for (const entityRef of doc.entityRefs) {
      const entityNodeId = "entity:" + entityRef;
      if (!seenNodes.has(entityNodeId)) {
        nodes.push({ id: entityNodeId, kind: "entity", label: entityRef, sourceRef: entityRef, occurredAt: null, contentHash: null, metadata: {} });
        seenNodes.add(entityNodeId);
      }
      edges.push({
        id: "edge:" + p7Hash({ from: nodeId, to: entityNodeId, type: "mentions" }).slice(0, 32),
        from: nodeId,
        to: entityNodeId,
        type: "mentions",
        evidenceRefs: [doc.sourceRef],
        metadata: {},
      });
    }
    const latitude=doc.metadata.latitude,longitude=doc.metadata.longitude;
    if(typeof latitude==="number"&&Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&
       typeof longitude==="number"&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180){
      const locationId="geography:"+doc.id;
      if(!seenNodes.has(locationId)){
        nodes.push({id:locationId,kind:"geography",label:doc.title,sourceRef:doc.sourceRef,
          occurredAt:doc.occurredAt,contentHash:doc.contentHash,metadata:{latitude,longitude,coordinateAuthority:"recorded_source"}});
        seenNodes.add(locationId);
        edges.push({id:"edge:"+p7Hash({from:nodeId,to:locationId,type:"references"}).slice(0,32),
          from:nodeId,to:locationId,type:"references",evidenceRefs:[doc.sourceRef],metadata:{}});
      }
    }

    const dimensionEntries = Object.entries(doc.contextRefs) as Array<[keyof typeof doc.contextRefs, string[]]>;
    for (const [dimension, refs] of dimensionEntries) {
      for (const contextRef of refs) {
        if (dimension === "entity" && doc.entityRefs.includes(contextRef)) continue;
        const contextNodeId = dimension + ":" + contextRef;
        if (!seenNodes.has(contextNodeId)) {
          nodes.push({
            id: contextNodeId,
            kind: dimension,
            label: contextRef,
            sourceRef: contextRef,
            occurredAt: dimension === "date" && !Number.isNaN(new Date(contextRef).getTime()) ? new Date(contextRef).toISOString() : null,
            contentHash: null,
            metadata: { dimension },
          });
          seenNodes.add(contextNodeId);
        }
        edges.push({
          id: "edge:" + p7Hash({ from: nodeId, to: contextNodeId, type: "references", dimension }).slice(0, 32),
          from: nodeId,
          to: contextNodeId,
          type: "references",
          evidenceRefs: [doc.sourceRef],
          metadata: { dimension },
        });
      }
    }
  }

  for (const doc of input.documents) {
    const from = bySourceRef.get(doc.sourceRef);
    if (!from) continue;
    const relations = Array.isArray(doc.metadata.relations) ? doc.metadata.relations : [];
    for (const raw of relations) {
      if (!raw || typeof raw !== "object") continue;
      const rel = raw as Record<string, unknown>;
      const targetRef = typeof rel.targetRef === "string" ? rel.targetRef : null;
      if (!targetRef) continue;
      const to = bySourceRef.get(targetRef) ?? "external:" + targetRef;
      if (!seenNodes.has(to)) {
        nodes.push({ id: to, kind: "document", label: targetRef, sourceRef: targetRef, occurredAt: null, contentHash: null, metadata: { external: true } });
        seenNodes.add(to);
      }
      const type = relationType(rel.type);
      edges.push({
        id: "edge:" + p7Hash({ from, to, type, targetRef }).slice(0, 32),
        from,
        to,
        type,
        evidenceRefs: [doc.sourceRef, targetRef],
        metadata: typeof rel.note === "string" ? { note: rel.note } : {},
      });
    }
  }

  const dedupedEdges = [...new Map(edges.map((edge) => [edge.id, edge])).values()];
  const base = { schemaVersion: P7_SCHEMA_VERSION, projectId: input.projectId, generatedAt, nodes, edges: dedupedEdges };
  return p7ContextGraphSchema.parse({ ...base, contentHash: p7Hash({ projectId: input.projectId, nodes, edges: dedupedEdges }) });
}

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g) ?? [])
    .filter((term) => term.length > 1);
}

function cosine(a: number[], b: number[]): number | null {
  if (!a.length || a.length !== b.length) return null;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return null;
  return dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

function excerptAround(body: string, queryTerms: string[]): string {
  const clean = body.replace(/\s+/g, " ").trim();
  if (clean.length <= 700) return clean;
  const lower = clean.toLowerCase();
  const pos = queryTerms.map((term) => lower.indexOf(term)).filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, pos - 180);
  return (start > 0 ? "…" : "") + clean.slice(start, start + 700) + (start + 700 < clean.length ? "…" : "");
}

function referenceMatchScore(refs: string[], query: string, queryTerms: string[]): number {
  const normalizedQuery = query.trim().toLowerCase();
  let best = 0;
  for (const ref of refs) {
    const normalizedRef = ref.trim().toLowerCase();
    if (!normalizedRef) continue;
    let score = 0;
    if (normalizedRef === normalizedQuery) score = 4;
    else if (
      normalizedQuery.length >= 3
      && normalizedRef.length >= 3
      && (normalizedRef.includes(normalizedQuery) || normalizedQuery.includes(normalizedRef))
    ) score = 2;
    const refTerms = [...new Set(terms(normalizedRef))];
    if (queryTerms.length && refTerms.length) {
      const overlap = queryTerms.filter((term) => refTerms.includes(term)).length;
      if (overlap) score = Math.max(score, 2 * overlap / queryTerms.length);
    }
    best = Math.max(best, score);
  }
  return best;
}

function structuredContextScore(doc: P7ProjectDocument, query: string, queryTerms: string[]): number {
  let score = 0;
  for (const [dimension, refs] of Object.entries(doc.contextRefs)) {
    if (dimension === "entity") continue;
    score += referenceMatchScore(refs, query, queryTerms);
  }
  return score;
}

function rankByScore<T extends { doc: P7ProjectDocument }>(
  candidates: T[],
  score: (candidate: T) => number,
): Map<string, number> {
  const ranked = candidates
    .filter((candidate) => score(candidate) > 0)
    .sort((left, right) =>
      score(right) - score(left)
      || (right.doc.occurredAt ?? "").localeCompare(left.doc.occurredAt ?? "")
      || left.doc.sourceRef.localeCompare(right.doc.sourceRef)
    );
  return new Map(ranked.map((candidate, index) => [candidate.doc.id, index + 1]));
}

function reciprocalRank(rank: number | undefined, weight: number): number {
  return rank && weight > 0 ? weight / (60 + rank) : 0;
}

export function filterPermittedProjectDocuments(documents: P7ProjectDocument[], request: P7SearchRequest): P7ProjectDocument[] {
  const allowedRefs = new Set(request.allowedSourceRefs);
  const providerAllow = new Set(request.providerAllow);
  const providerDeny = new Set(request.providerDeny);

  // Permission/source/provider filtering happens before every retrieval channel
  // and before excerpts are constructed, so excluded metadata/content cannot
  // affect ranking or become observable. Provider identity is explicit metadata only.
  return documents.filter((doc) => {
    if (request.sourceTypes.length && !request.sourceTypes.includes(doc.sourceType)) return false;
    const providerId = researchProviderIdForDocument(doc);
    if (providerId && providerDeny.has(providerId)) return false;
    if (providerAllow.size && (!providerId || !providerAllow.has(providerId))) return false;
    if (!allowedRefs.size) return true;
    return allowedRefs.has(doc.sourceRef) || doc.sourceRefs.some((ref) => allowedRefs.has(ref));
  });
}

export function searchProjectDocuments(documents: P7ProjectDocument[], input: unknown): P7SearchHit[] {
  const request = p7SearchRequestSchema.parse(input);
  const queryTerms = [...new Set(terms(request.query))];
  const filtered = filterPermittedProjectDocuments(documents, request);

  const df = new Map<string, number>();
  for (const term of queryTerms) {
    df.set(term, filtered.reduce((count, doc) => count + (terms(doc.title + " " + doc.body).includes(term) ? 1 : 0), 0));
  }
  const averageLength = filtered.length
    ? filtered.reduce((sum, doc) => sum + Math.max(1, terms(doc.title + " " + doc.body).length), 0) / filtered.length
    : 1;
  const semanticWeight = request.queryEmbedding ? request.semanticWeight : 0;
  const lexicalWeight = request.queryEmbedding ? 1 - semanticWeight : 1;

  const candidates = filtered.map((doc) => {
    const docTerms = terms(doc.title + " " + doc.body);
    const counts = new Map<string, number>();
    for (const term of docTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
    let lexicalScore = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term) ?? 0;
      if (!tf) continue;
      const docFreq = df.get(term) ?? 0;
      const idf = Math.log(1 + (filtered.length - docFreq + 0.5) / (docFreq + 0.5));
      const k1 = 1.2, b = 0.75;
      const normTf = tf * (k1 + 1) / (tf + k1 * (1 - b + b * docTerms.length / averageLength));
      lexicalScore += idf * normTf;
    }
    if (doc.title.toLowerCase().includes(request.query.toLowerCase())) lexicalScore += 2;

    const semanticScore = request.queryEmbedding && doc.embedding ? cosine(request.queryEmbedding, doc.embedding) : null;
    const normalizedSemantic = semanticScore === null ? 0 : Math.max(0, Math.min(1, (semanticScore + 1) / 2));
    const entityScore = referenceMatchScore(
      [...new Set([...doc.entityRefs, ...doc.contextRefs.entity])],
      request.query,
      queryTerms,
    );
    const structuredScore = structuredContextScore(doc, request.query, queryTerms);
    return { doc, lexicalScore, semanticScore, normalizedSemantic, entityScore, structuredScore };
  });

  // Haystack-style multi-retriever composition is adapted here as weighted
  // reciprocal-rank fusion. P7 keeps one index/authority and fuses only ranks,
  // avoiding direct comparison of BM25, cosine, entity and structured scales.
  const lexicalRanks = rankByScore(candidates, (candidate) => candidate.lexicalScore);
  const semanticRanks = rankByScore(candidates, (candidate) => candidate.normalizedSemantic);
  const entityRanks = rankByScore(candidates, (candidate) => candidate.entityScore);
  const structuredRanks = rankByScore(candidates, (candidate) => candidate.structuredScore);

  return candidates.map((candidate): P7SearchHit => {
    const combinedScore = 100 * (
      reciprocalRank(lexicalRanks.get(candidate.doc.id), lexicalWeight)
      + reciprocalRank(semanticRanks.get(candidate.doc.id), semanticWeight)
      + reciprocalRank(entityRanks.get(candidate.doc.id), 0.65)
      + reciprocalRank(structuredRanks.get(candidate.doc.id), 0.55)
    );
    return {
      documentId: candidate.doc.id,
      sourceType: candidate.doc.sourceType,
      sourceRef: candidate.doc.sourceRef,
      title: candidate.doc.title,
      excerpt: excerptAround(candidate.doc.body, queryTerms),
      contentHash: candidate.doc.contentHash,
      lexicalScore: candidate.lexicalScore,
      semanticScore: candidate.semanticScore,
      combinedScore,
      sourceRefs: candidate.doc.sourceRefs,
      entityRefs: candidate.doc.entityRefs,
      contextRefs: candidate.doc.contextRefs,
      occurredAt: candidate.doc.occurredAt,
    };
  })
    .filter((hit) => hit.combinedScore > 0)
    .sort((a, b) =>
      b.combinedScore - a.combinedScore
      || (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "")
      || a.sourceRef.localeCompare(b.sourceRef)
    )
    .slice(0, request.limit);
}

export function createProjectSnapshot(input: {
  projectId: number;
  graph: P7ContextGraph;
  documents: P7ProjectDocument[];
  generatedAt?: string;
  id?: string;
}): P7ProjectSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const manifest = input.documents
    .map((doc) => ({
      id: doc.id,
      sourceType: doc.sourceType,
      sourceRef: doc.sourceRef,
      title: doc.title,
      contentHash: doc.contentHash,
      occurredAt: doc.occurredAt,
    }))
    .sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
  const contentHash = p7Hash({ projectId: input.projectId, graphHash: input.graph.contentHash, manifest });
  return p7ProjectSnapshotSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    id: input.id ?? "p7snapshot:" + contentHash.slice(0, 32),
    projectId: input.projectId,
    generatedAt,
    contentHash,
    graphHash: input.graph.contentHash,
    manifest,
  });
}

export function diffProjectSnapshots(from: P7ProjectSnapshot, to: P7ProjectSnapshot): P7Delta {
  if (from.projectId !== to.projectId) throw new Error("Project snapshots must belong to the same Project.");
  const before = new Map(from.manifest.map((entry) => [entry.sourceRef, entry]));
  const after = new Map(to.manifest.map((entry) => [entry.sourceRef, entry]));
  const added = to.manifest.filter((entry) => !before.has(entry.sourceRef));
  const removed = from.manifest.filter((entry) => !after.has(entry.sourceRef));
  const changed = to.manifest.flatMap((entry) => {
    const prior = before.get(entry.sourceRef);
    return prior && prior.contentHash !== entry.contentHash ? [{ sourceRef: entry.sourceRef, before: prior, after: entry }] : [];
  });
  return p7DeltaSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    projectId: to.projectId,
    fromSnapshotId: from.id,
    toSnapshotId: to.id,
    added,
    removed,
    changed,
  });
}

export type P7ExplicitContradiction = {
  id: string;
  sourceRefs: [string, string];
  entityRefs: string[];
  occurredAt: string | null;
  summary: string;
};

export function detectExplicitContradictions(documents: P7ProjectDocument[]): P7ExplicitContradiction[] {
  const bySourceRef = new Map(documents.map((doc) => [doc.sourceRef, doc]));
  const pairs = new Map<string, P7ExplicitContradiction>();

  for (const doc of documents) {
    const relations = Array.isArray(doc.metadata.relations) ? doc.metadata.relations : [];
    for (const raw of relations) {
      if (!raw || typeof raw !== "object") continue;
      const relation = raw as Record<string, unknown>;
      if (relation.type !== "contradicts") continue;
      const targetRef = typeof relation.targetRef === "string" ? relation.targetRef.trim() : "";
      if (!targetRef || targetRef === doc.sourceRef) continue;

      const sourceRefs = [doc.sourceRef, targetRef].sort((left, right) => left.localeCompare(right)) as [string, string];
      const pairKey = sourceRefs.join("\u0000");
      if (pairs.has(pairKey)) continue;

      const [leftRef, rightRef] = sourceRefs;
      const left = bySourceRef.get(leftRef);
      const right = bySourceRef.get(rightRef);
      const entityRefs = [...new Set([...(left?.entityRefs ?? []), ...(right?.entityRefs ?? [])])].sort();
      const occurredAt = [left?.occurredAt, right?.occurredAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
      const leftLabel = left?.title || leftRef;
      const rightLabel = right?.title || rightRef;

      pairs.set(pairKey, {
        id: "contradiction:" + p7Hash({ sourceRefs }).slice(0, 24),
        sourceRefs,
        entityRefs,
        occurredAt,
        summary: `Explicit contradiction relation recorded between "${leftLabel}" and "${rightLabel}".`,
      });
    }
  }

  return [...pairs.values()].sort((left, right) => left.sourceRefs.join("\u0000").localeCompare(right.sourceRefs.join("\u0000")));
}

export function compileDeterministicInsights(input: {
  projectId: number;
  documents: P7ProjectDocument[];
  delta?: P7Delta | null;
  now?: string;
  staleEvidenceDays?: number;
}): P7InsightLens {
  const now = new Date(input.now ?? new Date().toISOString());
  const staleMs = Math.max(1, input.staleEvidenceDays ?? 365) * 86_400_000;
  const insights: P7Insight[] = [];
  const add = (insight: Omit<P7Insight, "deterministic">) => insights.push({ ...insight, deterministic: true });

  if (input.delta) {
    for (const item of input.delta.added) add({
      id: "change:add:" + p7Hash(item.sourceRef).slice(0, 20),
      kind: "change", title: "New project evidence: " + item.title,
      summary: "A new indexed source appeared since the selected Project snapshot.",
      severity: "info", sourceRefs: [item.sourceRef], entityRefs: [], occurredAt: item.occurredAt,
    });
    for (const item of input.delta.changed) add({
      id: "change:update:" + p7Hash(item.sourceRef).slice(0, 20),
      kind: "change", title: "Project source changed: " + item.after.title,
      summary: "The content hash changed between the selected Project snapshots.",
      severity: "watch", sourceRefs: [item.sourceRef], entityRefs: [], occurredAt: item.after.occurredAt,
    });
  }

  for (const contradiction of detectExplicitContradictions(input.documents)) add({
    id: contradiction.id,
    kind: "contradiction",
    title: "Contradictory evidence requires review",
    summary: contradiction.summary,
    severity: "material",
    sourceRefs: contradiction.sourceRefs,
    entityRefs: contradiction.entityRefs,
    occurredAt: contradiction.occurredAt,
  });

  for (const doc of input.documents) {
    if ((doc.sourceType === "research_evidence" || doc.sourceType === "filing") && doc.occurredAt) {
      const at = new Date(doc.occurredAt);
      if (Number.isFinite(at.getTime()) && now.getTime() - at.getTime() > staleMs) add({
        id: "stale:" + doc.id,
        kind: "stale_evidence", title: "Evidence may be stale: " + doc.title,
        summary: "This evidence is older than the configured freshness horizon.",
        severity: "watch", sourceRefs: [doc.sourceRef], entityRefs: doc.entityRefs, occurredAt: doc.occurredAt,
      });
    }
    const kind = typeof doc.metadata.insightKind === "string" ? doc.metadata.insightKind : null;
    if (kind === "open_question" || kind === "risk" || kind === "catalyst" || kind === "decision") {
      add({
        id: kind + ":" + doc.id,
        kind,
        title: doc.title,
        summary: doc.body.slice(0, 20_000),
        severity: kind === "risk" ? "material" : "watch",
        sourceRefs: [doc.sourceRef, ...doc.sourceRefs],
        entityRefs: doc.entityRefs,
        occurredAt: doc.occurredAt,
      });
    }

    const deterministicSignals = Array.isArray(doc.metadata.deterministicInsights) ? doc.metadata.deterministicInsights : [];
    const deterministicKinds = new Set(["anomaly","trend","percentile","revision","correlation","curve","regime"]);
    for (const raw of deterministicSignals) {
      if (!raw || typeof raw !== "object") continue;
      const signal = raw as Record<string, unknown>;
      const signalKind = typeof signal.kind === "string" ? signal.kind : "";
      if (!deterministicKinds.has(signalKind)) continue;
      const signalTitle = typeof signal.title === "string" && signal.title.trim() ? signal.title.trim() : doc.title;
      const signalSummary = typeof signal.summary === "string" ? signal.summary : doc.body.slice(0, 20_000);
      const severity = signal.severity === "material" || signal.severity === "watch" || signal.severity === "info"
        ? signal.severity
        : "watch";
      add({
        id: signalKind + ":" + doc.id + ":" + p7Hash(signal).slice(0, 16),
        kind: signalKind as "anomaly" | "trend" | "percentile" | "revision" | "correlation" | "curve" | "regime",
        title: signalTitle.slice(0, 1_000),
        summary: signalSummary.slice(0, 20_000),
        severity,
        sourceRefs: [...new Set([doc.sourceRef, ...doc.sourceRefs, ...(Array.isArray(signal.sourceRefs) ? signal.sourceRefs.map(String) : [])])].slice(0, 500),
        entityRefs: [...new Set([...doc.entityRefs, ...(Array.isArray(signal.entityRefs) ? signal.entityRefs.map(String) : [])])].slice(0, 500),
        occurredAt: doc.occurredAt,
      });
    }
  }

  const unique = [...new Map(insights.map((item) => [item.id, item])).values()];
  const counts: Record<string, number> = {};
  for (const insight of unique) counts[insight.kind] = (counts[insight.kind] ?? 0) + 1;
  return p7InsightLensSchema.parse({
    schemaVersion: P7_SCHEMA_VERSION,
    projectId: input.projectId,
    generatedAt: now.toISOString(),
    insights: unique,
    counts,
  });
}

/**
 * Current P7 read surfaces cannot reuse snapshot-only insight titles after a
 * resource, Chat or Artifact is excluded or archived. A compiled delta can
 * still name a revoked source even when current indexed documents are filtered.
 * Keep only findings whose recorded refs remain accessible in this Project.
 */
export function retainPermittedProjectInsights(
  lens: P7InsightLens, currentSourceRefs: ReadonlySet<string>,
): P7InsightLens {
  const insights = lens.insights.filter(insight =>
    insight.sourceRefs.length > 0 && insight.sourceRefs.every(ref => currentSourceRefs.has(ref)));
  const counts: Record<string, number> = {};
  for (const insight of insights) counts[insight.kind] = (counts[insight.kind] ?? 0) + 1;
  return p7InsightLensSchema.parse({ ...lens, insights, counts });
}

export function buildUnifiedTimeline(documents: P7ProjectDocument[]): P7TimelineEvent[] {
  const typeFor = (doc: P7ProjectDocument): P7TimelineEvent["type"] => {
    if (doc.sourceType === "chat" || doc.sourceType === "chat_message") return "chat";
    if (doc.sourceType === "resource") return "resource";
    if (doc.sourceType === "artifact") return "artifact";
    if (doc.sourceType === "ledger_event") return "ledger";
    if (doc.sourceType === "filing") return "filing";
    if (doc.sourceType === "decision") return "decision";
    if (doc.sourceType === "thesis") return "thesis";
    if (doc.sourceType === "research_evidence") return "research";
    return "document";
  };
  const metadataString = (doc: P7ProjectDocument, key: string): string | null => {
    const value = doc.metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const metadataStrings = (doc: P7ProjectDocument, key: string): string[] => {
    const value = doc.metadata[key];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  };
  const canonicalArtifactRef = (value: string): string | null => {
    if (!value.startsWith("artifact:")) return null;
    return value.split("@v")[0] || null;
  };
  const modelKinds = new Set(["valuation", "backtest", "strategy", "portfolio", "screen"]);

  return documents
    .filter((doc) => doc.occurredAt)
    .map((doc) => {
      const artifactRefs = [...new Set([
        metadataString(doc, "artifactId"),
        metadataString(doc, "researchArtifactId"),
        metadataString(doc, "thesisArtifactId"),
        ...metadataStrings(doc, "artifactRefs"),
        canonicalArtifactRef(doc.sourceRef),
        ...doc.sourceRefs.map(canonicalArtifactRef),
      ].filter((value): value is string => Boolean(value)))];
      const artifactKind = metadataString(doc, "artifactKind");
      const modelRefs = [...new Set([
        ...metadataStrings(doc, "modelRefs"),
        metadataString(doc, "modelRef"),
        metadataString(doc, "modelId"),
        ...(artifactKind && modelKinds.has(artifactKind) ? artifactRefs : []),
      ].filter((value): value is string => Boolean(value)))];
      const decisionRef = metadataString(doc, "decisionRef")
        ?? (doc.sourceType === "decision" ? artifactRefs[0] ?? doc.sourceRef : null);
      return {
        id: "timeline:" + doc.id,
        at: doc.occurredAt!,
        type: typeFor(doc),
        title: doc.title,
        summary: doc.body.replace(/\s+/g, " ").trim().slice(0, 2_000),
        sourceRefs: [...new Set([doc.sourceRef, ...doc.sourceRefs])],
        entityRefs: doc.entityRefs,
        artifactRefs,
        modelRefs,
        decisionRef,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function buildResearchGraph(graph: P7ContextGraph): P7ContextGraph {
  const keepKinds = new Set<P7ContextNode["kind"]>(["project","artifact","evidence","filing","report","thesis","entity","metric","period","date","event","portfolio","benchmark","scenario","geography","currency","document"]);
  const nodes = graph.nodes.filter((node) => keepKinds.has(node.kind));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const base = { schemaVersion: P7_SCHEMA_VERSION, projectId: graph.projectId, generatedAt: graph.generatedAt, nodes, edges };
  return p7ContextGraphSchema.parse({ ...base, contentHash: p7Hash({ projectId: graph.projectId, nodes, edges }) });
}
