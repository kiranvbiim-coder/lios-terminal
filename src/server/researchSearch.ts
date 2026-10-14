import crypto from "crypto";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  clientDatasets,
  contentOrganizationLinks,
  publishedContent,
  type ResearchSearchFilters,
} from "@shared/schema";
import { getDb } from "./db";
import { getNews } from "./marketData";
import { getCompanyFilings } from "./secEdgarData";
import { callPythonService } from "./pythonService";
import { searchOfficialData } from "./researchOfficialCatalog";
import {
  createEvidenceFingerprint,
  defaultSourceQuality,
  type NormalizedResearchResult,
} from "./researchService";

export type ResearchSourceClass = "filing" | "news" | "official_data" | "published_content" | "private_data";

export interface UnifiedResearchSearchRequest {
  query: string;
  filters: ResearchSearchFilters;
  organizationId?: number | null;
  limit: number;
}

export interface UnifiedResearchSearchResponse {
  results: NormalizedResearchResult[];
  sources: Array<{ sourceClass: ResearchSourceClass; status: "ok" | "unavailable" | "not_requested"; count: number; message?: string }>;
}

function wants(filters: ResearchSearchFilters, sourceClass: ResearchSourceClass): boolean {
  return !filters.sourceClasses?.length || filters.sourceClasses.includes(sourceClass);
}

function inDateRange(value: string | null, filters: ResearchSearchFilters): boolean {
  if (!value) return !filters.dateFrom && !filters.dateTo && !filters.freshnessDays;
  const time = new Date(value).getTime();
  if (filters.dateFrom && time < new Date(filters.dateFrom).getTime()) return false;
  if (filters.dateTo && time > new Date(`${filters.dateTo}T23:59:59.999Z`).getTime()) return false;
  if (filters.freshnessDays && Date.now() - time > filters.freshnessDays * 86_400_000) return false;
  return true;
}

function resultId(provider: string, externalId: string | null, url: string | null, title: string, publishedAt: string | null): string {
  return createEvidenceFingerprint({ provider, sourceExternalId: externalId, sourceUrl: url, title, publishedAt });
}

async function searchFilings(request: UnifiedResearchSearchRequest): Promise<NormalizedResearchResult[]> {
  const ticker = request.filters.entity?.trim().toUpperCase();
  const forms = request.filters.documentTypes?.filter(Boolean);
  const retrievedAt = new Date().toISOString();
  let rows: Array<{
    company?: string; ticker?: string | null; form: string; filed: string;
    accessionNumber: string; score?: number; filingUrl: string;
  }> = [];

  if (request.query.trim()) {
    const response = await callPythonService("/sec/filing-search", {
      query: request.query,
      ticker: ticker || undefined,
      forms: forms?.length ? forms : undefined,
      limit: request.limit,
    }) as { results?: typeof rows };
    rows = response.results ?? [];
  } else if (ticker) {
    rows = (await getCompanyFilings(ticker, request.limit)).map((filing) => ({
      company: ticker,
      ticker,
      form: filing.formType,
      filed: filing.filedDate,
      accessionNumber: filing.accessionNumber,
      filingUrl: filing.filingUrl,
      score: 1,
    }));
  }

  return rows
    .filter((row) => (!forms?.length || forms.includes(row.form)) && inDateRange(`${row.filed}T00:00:00.000Z`, request.filters))
    .map((row) => {
      const publishedAt = `${row.filed}T00:00:00.000Z`;
      const title = `${row.ticker || row.company || "SEC filing"} ${row.form} filed ${row.filed}`;
      return {
        resultId: resultId("SEC EDGAR", row.accessionNumber, row.filingUrl, title, publishedAt),
        evidenceType: "filing" as const,
        evidenceKind: "fact" as const,
        title,
        excerpt: request.query ? `SEC full-text match for “${request.query}”.` : null,
        sourceName: "U.S. Securities and Exchange Commission",
        provider: "SEC EDGAR",
        sourceUrl: row.filingUrl,
        sourceExternalId: row.accessionNumber,
        publishedAt,
        effectiveAt: publishedAt,
        retrievedAt,
        sourceQuality: defaultSourceQuality("filing", "SEC EDGAR", true),
        relevanceScore: row.score ?? 1,
        metadata: { symbol: row.ticker ?? ticker ?? null, company: row.company ?? null, formType: row.form, providerPayload: row },
      };
    });
}

async function searchNews(request: UnifiedResearchSearchRequest): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const rows = await getNews(request.filters.entity, request.query || undefined);
  return rows.filter((row) => inDateRange(row.publishedAt, request.filters)).slice(0, request.limit).map((row) => ({
    resultId: resultId(row.feedProvider || "Limuria News", row.url, row.url, row.title, row.publishedAt),
    evidenceType: "news" as const,
    evidenceKind: "claim" as const,
    title: row.title,
    excerpt: row.summary || null,
    sourceName: row.source,
    provider: row.feedProvider || "Limuria News",
    sourceUrl: row.url,
    sourceExternalId: row.url,
    publishedAt: row.publishedAt,
    effectiveAt: null,
    retrievedAt,
    sourceQuality: defaultSourceQuality("news", row.feedProvider, true),
    relevanceScore: null,
    metadata: { symbol: request.filters.entity ?? null, sentiment: row.sentiment, providerPayload: row },
  }));
}

async function searchInternalSources(request: UnifiedResearchSearchRequest): Promise<{
  published: NormalizedResearchResult[];
  privateData: NormalizedResearchResult[];
}> {
  const db = getDb();
  const retrievedAt = new Date().toISOString();
  const pattern = `%${request.query || request.filters.entity || ""}%`;
  let allowedContentIds: number[] = [];
  if (request.organizationId) {
    const links = await db.select({ contentId: contentOrganizationLinks.contentId }).from(contentOrganizationLinks)
      .where(eq(contentOrganizationLinks.organizationId, request.organizationId));
    allowedContentIds = links.map((row) => row.contentId);
  }
  const visibility = request.organizationId
    ? allowedContentIds.length
      ? or(eq(publishedContent.visibility, "all_clients"), inArray(publishedContent.id, allowedContentIds))
      : eq(publishedContent.visibility, "all_clients")
    : undefined;
  const contentConditions = [
    eq(publishedContent.status, "published"),
    request.query || request.filters.entity ? or(ilike(publishedContent.title, pattern), ilike(publishedContent.body, pattern)) : undefined,
    request.filters.domainId ? eq(publishedContent.domainId, request.filters.domainId) : undefined,
    visibility,
  ].filter(Boolean) as Parameters<typeof and>;
  const contentRows = await db.select().from(publishedContent)
    .where(and(...contentConditions))
    .orderBy(desc(publishedContent.publishedAt))
    .limit(request.limit);
  const published = contentRows.filter((row) => inDateRange(row.publishedAt?.toISOString() ?? null, request.filters)).map((row) => {
    const publishedAt = row.publishedAt?.toISOString() ?? null;
    return {
      resultId: resultId("Limuria Publishing", String(row.id), null, row.title, publishedAt),
      evidenceType: "internal_note" as const,
      evidenceKind: "interpretation" as const,
      title: row.title,
      excerpt: row.body.slice(0, 2000),
      sourceName: "Limuria published research",
      provider: "Limuria Publishing",
      sourceUrl: null,
      sourceExternalId: String(row.id),
      publishedAt,
      effectiveAt: null,
      retrievedAt,
      sourceQuality: defaultSourceQuality("internal_note", "Limuria Publishing", false),
      relevanceScore: null,
      metadata: { contentType: row.contentType, domainId: row.domainId, visibility: row.visibility, providerPayload: row },
    };
  });

  let datasetRows: Array<typeof clientDatasets.$inferSelect> = [];
  if (request.organizationId) {
    datasetRows = await db.select().from(clientDatasets).where(and(
      eq(clientDatasets.organizationId, request.organizationId),
      request.query || request.filters.entity ? ilike(clientDatasets.fileName, pattern) : undefined,
    )).orderBy(desc(clientDatasets.createdAt)).limit(request.limit);
  }
  const privateData = datasetRows.map((row) => ({
    resultId: crypto.createHash("sha256").update(`client-dataset:${row.id}`).digest("hex"),
    evidenceType: "uploaded_document" as const,
    evidenceKind: "fact" as const,
    title: row.fileName,
    excerpt: `${row.sheetCount} sheets, ${row.totalRows} profiled rows.`,
    sourceName: "Client private data environment",
    provider: "Limuria BYOD",
    sourceUrl: null,
    sourceExternalId: String(row.id),
    publishedAt: null,
    effectiveAt: null,
    retrievedAt,
    sourceQuality: defaultSourceQuality("uploaded_document", "Limuria BYOD", false),
    relevanceScore: null,
    metadata: { fileExt: row.fileExt, sheetCount: row.sheetCount, totalRows: row.totalRows, profile: row.profile },
  }));
  return { published, privateData };
}

export async function unifiedResearchSearch(request: UnifiedResearchSearchRequest): Promise<UnifiedResearchSearchResponse> {
  const requested: ResearchSourceClass[] = ["filing", "news", "official_data", "published_content", "private_data"];
  const tasks: Array<{ sourceClass: ResearchSourceClass; promise: Promise<NormalizedResearchResult[]> }> = [];
  if (wants(request.filters, "filing")) tasks.push({ sourceClass: "filing", promise: searchFilings(request) });
  if (wants(request.filters, "news")) tasks.push({ sourceClass: "news", promise: searchNews(request) });
  if (wants(request.filters, "official_data")) tasks.push({ sourceClass: "official_data", promise: Promise.resolve(searchOfficialData(request)) });
  if (wants(request.filters, "published_content") || wants(request.filters, "private_data")) {
    const internal = searchInternalSources(request);
    if (wants(request.filters, "published_content")) tasks.push({ sourceClass: "published_content", promise: internal.then((rows) => rows.published) });
    if (wants(request.filters, "private_data")) tasks.push({ sourceClass: "private_data", promise: internal.then((rows) => rows.privateData) });
  }
  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const results: NormalizedResearchResult[] = [];
  const bySource = new Map<ResearchSourceClass, { status: "ok" | "unavailable"; count: number; message?: string }>();
  settled.forEach((entry, index) => {
    const sourceClass = tasks[index].sourceClass;
    if (entry.status === "fulfilled") {
      results.push(...entry.value);
      bySource.set(sourceClass, { status: "ok", count: entry.value.length });
    } else {
      bySource.set(sourceClass, { status: "unavailable", count: 0, message: entry.reason instanceof Error ? entry.reason.message : "Provider unavailable" });
    }
  });
  const deduped = Array.from(new Map(results.map((row) => [row.resultId, row])).values())
    .sort((a, b) => (b.publishedAt ?? b.retrievedAt).localeCompare(a.publishedAt ?? a.retrievedAt))
    .slice(0, request.limit * 4);
  return {
    results: deduped,
    sources: requested.map((sourceClass) => wants(request.filters, sourceClass)
      ? { sourceClass, ...(bySource.get(sourceClass) ?? { status: "ok" as const, count: 0 }) }
      : { sourceClass, status: "not_requested" as const, count: 0 }),
  };
}
