import type { Express, Request, Response } from "express";
import { z } from "zod";
import { thesisArtifactContentSchema } from "@shared/artifactContracts";
import { p7SearchRequestSchema, p7FilingSectionSchema } from "@shared/p7ResearchContracts";
import { requireAuth } from "./auth";
import { tenantContext } from "./tenantContext";
import {
  createArtifact,
  createArtifactVersion,
  getArtifact,
  getArtifactVersion,
} from "./artifactStore";
import {
  currentInsightLens,
  currentProjectIntelligence,
  getProjectIntelligenceSnapshot,
  getProjectIntelligenceHistoricalState,
  indexProjectDocument,
  listProjectIntelligenceDocuments,
  listProjectIntelligenceSnapshots,
  projectIntelligenceAsKnownOn,
  projectIntelligenceDelta,
  rebuildProjectIntelligence,
  searchProjectIntelligence,
} from "./p7ProjectIntelligenceStore";
import { parseLocalDocumentWithDocling, p7DocumentRuntimeStatus } from "./p7DocumentIntelligence";
import { searchProjectIntelligenceLocally } from "./p7LocalSearch";
import { comparePrimarySourceFilings } from "./p7FilingDiff";
import { p7Hash } from "./p7ProjectIntelligence";
import { appendThesisPostmortem, refreshThesisArtifact } from "./p7ThesisEngine";
import { P7_RESEARCH_TOOLS, p7AgentRuntimeContract } from "./p7ResearchTools";

function ctx(req: Request) {
  return tenantContext(req.user!);
}

function fail(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid P7 request.", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "P7 request failed.";
  if (/not found|not owned|boundary|different Project/i.test(message)) {
    res.status(404).json({ error: message });
    return;
  }
  if (/approval|required|local-desktop|runtime|unavailable/i.test(message)) {
    res.status(409).json({ error: message });
    return;
  }
  res.status(400).json({ error: message });
}

function projectId(req: Request): number {
  return z.coerce.number().int().positive().parse(req.params.projectId);
}

function collectThesisEvidence(content: z.infer<typeof thesisArtifactContentSchema>): string[] {
  return [...new Set([
    ...content.claims.flatMap((item) => [...item.evidenceRefs, ...item.counterEvidenceRefs]),
    ...content.expectedOutcomes.flatMap((item) => item.evidenceRefs),
    ...content.catalysts.flatMap((item) => item.evidenceRefs),
    ...content.risks.flatMap((item) => item.evidenceRefs),
    ...content.invalidationConditions.flatMap((item) => item.evidenceRefs),
    ...content.openQuestions.flatMap((item) => item.evidenceRefs),
    ...content.postmortems.flatMap((item) => item.evidenceRefs),
  ])].slice(0, 2_000);
}

async function thesisForProject(req: Request, artifactId: string) {
  const artifact = await getArtifact(ctx(req), artifactId);
  const pid = projectId(req);
  if (artifact.projectId !== pid) throw new Error("Thesis Artifact belongs to a different Project.");
  const version = await getArtifactVersion(ctx(req), artifactId, artifact.headVersion);
  const thesis = thesisArtifactContentSchema.parse(version.content);
  return { artifact, version, thesis, projectId: pid };
}

export function registerP7ResearchRoutes(app: Express): void {
  app.use("/api/projects/:projectId/intelligence", requireAuth);
  app.use("/api/projects/:projectId/theses", requireAuth);

  app.get("/api/projects/:projectId/intelligence/runtime", async (req, res) => {
    try {
      res.json({
        documentRuntime: p7DocumentRuntimeStatus(),
        agentRuntime: p7AgentRuntimeContract(),
        tools: P7_RESEARCH_TOOLS,
      });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/rebuild", async (req, res) => {
    try {
      const rebuilt = await rebuildProjectIntelligence(ctx(req), projectId(req));
      res.json({
        documentCount: rebuilt.documents.length,
        graph: rebuilt.graph,
        snapshot: rebuilt.snapshot,
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence", async (req, res) => {
    try {
      const value = await currentProjectIntelligence(ctx(req), projectId(req));
      res.json({
        documentCount: value.documents.length,
        graph: value.graph,
        researchGraph: value.researchGraph,
        timeline: value.timeline,
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/documents", async (req, res) => {
    try { res.json(await listProjectIntelligenceDocuments(ctx(req), projectId(req))); }
    catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/search", async (req, res) => {
    try {
      const request = p7SearchRequestSchema.parse(req.body);
      res.json(await searchProjectIntelligence(ctx(req), projectId(req), request));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/search/local", async (req, res) => {
    try { res.json(await searchProjectIntelligenceLocally(ctx(req), projectId(req), req.body)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/insights", async (req, res) => {
    try { res.json(await currentInsightLens(ctx(req), projectId(req))); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/timeline", async (req, res) => {
    try {
      const query = z.object({
        type: z.enum(["chat", "resource", "artifact", "ledger", "filing", "research", "decision", "thesis", "document"]).optional(),
        sourceRef: z.string().trim().min(1).max(1_000).optional(),
        entityRef: z.string().trim().min(1).max(500).optional(),
        artifactRef: z.string().trim().min(1).max(500).optional(),
        modelRef: z.string().trim().min(1).max(500).optional(),
        decisionRef: z.string().trim().min(1).max(500).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      }).parse(req.query);
      const value = await currentProjectIntelligence(ctx(req), projectId(req));
      const timeline = value.timeline.filter((event) =>
        (!query.type || event.type === query.type)
        && (!query.sourceRef || event.sourceRefs.includes(query.sourceRef))
        && (!query.entityRef || event.entityRefs.includes(query.entityRef))
        && (!query.artifactRef || event.artifactRefs.includes(query.artifactRef))
        && (!query.modelRef || event.modelRefs.includes(query.modelRef))
        && (!query.decisionRef || event.decisionRef === query.decisionRef)
        && (!query.from || event.at >= query.from)
        && (!query.to || event.at <= query.to)
      );
      res.json(timeline);
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/research-graph", async (req, res) => {
    try {
      const value = await currentProjectIntelligence(ctx(req), projectId(req));
      res.json(value.researchGraph);
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/snapshots", async (req, res) => {
    try {
      const limit = z.coerce.number().int().min(1).max(200).optional().parse(req.query.limit);
      res.json(await listProjectIntelligenceSnapshots(ctx(req), projectId(req), limit ?? 50));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/snapshots/:snapshotId", async (req, res) => {
    try { res.json(await getProjectIntelligenceSnapshot(ctx(req), projectId(req), req.params.snapshotId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/snapshots/:snapshotId/state", async (req, res) => {
    try { res.json(await getProjectIntelligenceHistoricalState(ctx(req), projectId(req), req.params.snapshotId)); }
    catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/as-known-on", async (req, res) => {
    try {
      const query = z.object({ at: z.string().datetime({ offset: true }) }).parse(req.query);
      res.json(await projectIntelligenceAsKnownOn(ctx(req), projectId(req), query.at));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/projects/:projectId/intelligence/delta", async (req, res) => {
    try {
      const query = z.object({ from: z.string().trim().min(1), to: z.string().trim().min(1) }).parse(req.query);
      res.json(await projectIntelligenceDelta(ctx(req), projectId(req), query.from, query.to));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/documents", async (req, res) => {
    try {
      const body = z.object({
        sourceType: z.enum(["research_evidence", "filing", "document"]),
        sourceRef: z.string().trim().min(1).max(1_000),
        title: z.string().trim().min(1).max(1_000),
        body: z.string().max(2_000_000),
        occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
        sourceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).optional(),
        entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).optional(),
        contextRefs: z.record(z.array(z.string().trim().min(1).max(500)).max(2_000)).optional(),
        metadata: z.record(z.unknown()).optional(),
        embedding: z.array(z.number().finite()).max(8_192).nullable().optional(),
      }).strict().parse(req.body);
      res.json(await indexProjectDocument(ctx(req), { projectId: projectId(req), ...body }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/docling", async (req, res) => {
    try {
      const body = z.object({
        localPath: z.string().trim().min(1).max(4_000),
        sourceRef: z.string().trim().min(1).max(1_000),
        title: z.string().trim().min(1).max(1_000),
        entityRefs: z.array(z.string().trim().min(1).max(500)).max(500).optional(),
        occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
      }).strict().parse(req.body);
      const parsed = await parseLocalDocumentWithDocling(body.localPath);
      const indexed = await indexProjectDocument(ctx(req), {
        projectId: projectId(req),
        sourceType: "document",
        sourceRef: body.sourceRef,
        title: body.title,
        body: parsed.markdown,
        occurredAt: body.occurredAt ?? null,
        entityRefs: body.entityRefs ?? [],
        sourceRefs: [],
        metadata: {
          parser: parsed.parser,
          parserVersion: parsed.parserVersion,
          upstreamCommit: parsed.upstreamCommit,
          sourceBytes: parsed.sourceBytes,
          warnings: parsed.warnings,
        },
      });
      res.json({ indexed, parser: { name: parsed.parser, version: parsed.parserVersion, upstreamCommit: parsed.upstreamCommit } });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/intelligence/filing-diff", async (req, res) => {
    try {
      const body = z.object({
        priorRef: z.string().trim().min(1).max(1_000),
        filingRef: z.string().trim().min(1).max(1_000),
        priorSections: z.array(p7FilingSectionSchema).max(10_000),
        currentSections: z.array(p7FilingSectionSchema).max(10_000),
      }).strict().parse(req.body);
      const diff = comparePrimarySourceFilings(body);
      const diffRef = "filing-diff:" + p7Hash({ priorRef: body.priorRef, filingRef: body.filingRef }).slice(0, 32);
      const summary = [
        "Primary-source filing comparison",
        "Prior: " + body.priorRef,
        "Current: " + body.filingRef,
        "Added sections: " + diff.addedSections.length,
        "Removed sections: " + diff.removedSections.length,
        "Changed sections: " + diff.changedSections.length,
        "Unchanged sections: " + diff.unchangedSectionCount,
        ...diff.changedSections.slice(0, 50).map((section) =>
          "Changed · " + section.id + " · " + section.title + "\nAdded: " + section.addedLines.slice(0, 20).join(" | ") + "\nRemoved: " + section.removedLines.slice(0, 20).join(" | ")
        ),
      ].join("\n");
      const indexed = await indexProjectDocument(ctx(req), {
        projectId: projectId(req),
        sourceType: "research_evidence",
        sourceRef: diffRef,
        title: "Filing diff · " + body.priorRef + " → " + body.filingRef,
        body: summary,
        occurredAt: diff.generatedAt,
        sourceRefs: diff.evidenceRefs,
        metadata: {
          filingDiff: {
            priorRef: body.priorRef,
            filingRef: body.filingRef,
            addedSectionIds: diff.addedSections.map((section) => section.id),
            removedSectionIds: diff.removedSections.map((section) => section.id),
            changedSectionIds: diff.changedSections.map((section) => section.id),
          },
          relations: [
            { type: "changes", targetRef: body.priorRef },
            { type: "derived_from", targetRef: body.filingRef },
          ],
        },
      });
      res.json({ diff, indexed });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/theses", async (req, res) => {
    try {
      const body = z.object({
        title: z.string().trim().min(1).max(500),
        thesis: thesisArtifactContentSchema,
      }).strict().parse(req.body);
      res.json(await createArtifact(ctx(req), {
        projectId: projectId(req),
        title: body.title,
        content: body.thesis,
        origin: "direct",
        adapterId: "lios.thesis.native",
        sourceRefs: collectThesisEvidence(body.thesis),
        note: "P7 Thesis Artifact created.",
      }));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/theses/:artifactId/refresh", async (req, res) => {
    try {
      const current = await thesisForProject(req, req.params.artifactId);
      const beforeSnapshots = await listProjectIntelligenceSnapshots(ctx(req), current.projectId, 1);
      const rebuilt = await rebuildProjectIntelligence(ctx(req), current.projectId);
      const delta = beforeSnapshots[0] && beforeSnapshots[0].id !== rebuilt.snapshot.id
        ? await projectIntelligenceDelta(ctx(req), current.projectId, beforeSnapshots[0].id, rebuilt.snapshot.id)
        : null;
      const refreshed = refreshThesisArtifact({
        thesis: current.thesis,
        documents: rebuilt.documents,
        snapshot: rebuilt.snapshot,
        delta,
      });
      const version = await createArtifactVersion(ctx(req), {
        artifactId: current.artifact.id,
        baseVersion: current.artifact.headVersion,
        content: refreshed.thesis,
        adapterId: "lios.thesis.native",
        sourceRefs: collectThesisEvidence(refreshed.thesis),
        actorType: "user",
        note: "P7 deterministic Thesis refresh from Project Intelligence snapshot " + rebuilt.snapshot.id,
      });
      const finalIndex = await rebuildProjectIntelligence(ctx(req), current.projectId);
      res.json({
        version,
        changes: refreshed.changes,
        contradictions: refreshed.contradictions,
        evidenceSnapshot: rebuilt.snapshot,
        currentSnapshot: finalIndex.snapshot,
      });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/projects/:projectId/theses/:artifactId/postmortem", async (req, res) => {
    try {
      const current = await thesisForProject(req, req.params.artifactId);
      const body = z.object({
        outcome: z.enum(["validated", "partially_validated", "invalidated", "closed"]),
        summary: z.string().trim().min(1).max(50_000),
        whatWorked: z.array(z.string().max(20_000)).max(1_000).optional(),
        whatFailed: z.array(z.string().max(20_000)).max(1_000).optional(),
        evidenceRefs: z.array(z.string().trim().min(1).max(1_000)).max(2_000).optional(),
      }).strict().parse(req.body);
      const thesis = appendThesisPostmortem({ thesis: current.thesis, ...body });
      const version = await createArtifactVersion(ctx(req), {
        artifactId: current.artifact.id,
        baseVersion: current.artifact.headVersion,
        content: thesis,
        adapterId: "lios.thesis.native",
        sourceRefs: collectThesisEvidence(thesis),
        actorType: "user",
        note: "P7 Thesis postmortem.",
      });
      await rebuildProjectIntelligence(ctx(req), current.projectId);
      res.json(version);
    } catch (error) { fail(res, error); }
  });
}
