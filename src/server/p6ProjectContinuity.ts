import crypto from "node:crypto";
import { decisionArtifactContentSchema } from "@shared/artifactContracts";
import {
  P6_CONTINUITY_SCHEMA_VERSION,
  p6AutomationSummarySchema,
  p6DecisionMemoryEntrySchema,
  p6ProjectContinuitySnapshotSchema,
  p6SessionSummarySchema,
  type P6AutomationSummary,
  type P6ChangeSummary,
  type P6ContinuityEdge,
  type P6ContinuityGraph,
  type P6ContinuityNode,
  type P6ContinuationItem,
  type P6DecisionMemoryEntry,
  type P6ProjectContinuitySnapshot,
  type P6SessionSummary,
} from "@shared/p6ContinuityContracts";
import { projectWorkspaceSessionStateSchema } from "@shared/projectContracts";
import type { P7ContextGraph, P7Delta, P7InsightLens } from "@shared/p7ResearchContracts";
import type { ProjectAutomationRun, ProjectAutomationWorkflow } from "@shared/schema";
import { getArtifactVersion, listProjectArtifacts } from "./artifactStore";
import {
  currentInsightLens,
  currentProjectIntelligence,
  listProjectIntelligenceSnapshots,
  projectIntelligenceDelta,
  rebuildProjectIntelligence,
} from "./p7ProjectIntelligenceStore";
import { listP9Notifications, listP9Runs, listP9Workflows, parseP9StoredWorkflow } from "./p9AutomationStore";
import { getProjectDependencySummary, type ProjectDependencySummary } from "./projectStore";
import { listProjectSessions } from "./projectSessionStore";
import type { TenantContext } from "./tenantContext";

const PRIORITY_RANK: Record<P6ContinuationItem["priority"], number> = { high: 0, medium: 1, low: 2 };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function edgeId(from: string, type: string, to: string): string {
  return "p6-edge:" + hash([from, type, to]).slice(0, 28);
}

function addNode(nodes: Map<string, P6ContinuityNode>, node: P6ContinuityNode): void {
  const existing = nodes.get(node.id);
  nodes.set(node.id, existing
    ? {
        ...existing,
        ...node,
        sourceRef: node.sourceRef ?? existing.sourceRef,
        occurredAt: node.occurredAt ?? existing.occurredAt,
        contentHash: node.contentHash ?? existing.contentHash,
        metadata: { ...existing.metadata, ...node.metadata },
      }
    : node);
}

function namespacedNodeId(namespace: string, value: string): string {
  return value.startsWith(namespace + ":") ? value : namespace + ":" + value;
}

function existingGraphNodeId(graph: P7ContextGraph, reference: string): string | null {
  const artifactBase = reference.replace(/@v\d+$/i, "");
  return graph.nodes.find((node) =>
    node.sourceRef === reference
    || node.metadata.artifactId === reference
    || node.metadata.artifactId === artifactBase
  )?.id ?? null;
}

function addEdge(edges: Map<string, P6ContinuityEdge>, edge: P6ContinuityEdge): void {
  if (!edges.has(edge.id)) edges.set(edge.id, edge);
}

export function decisionMemoryFromArtifact(input: {
  artifact: { id: string; title: string; headVersion: number; updatedAt: Date | string };
  version: {
    version: number;
    content: unknown;
    sourceRefs: string[] | null;
    dependencyRefs: string[] | null;
  };
}): P6DecisionMemoryEntry {
  const content = decisionArtifactContentSchema.parse(input.version.content);
  const selected = content.selectedAlternativeId
    ? content.alternatives.find((item) => item.id === content.selectedAlternativeId) ?? null
    : null;
  return p6DecisionMemoryEntrySchema.parse({
    artifactId: input.artifact.id,
    version: input.version.version || input.artifact.headVersion,
    title: input.artifact.title,
    objective: content.objective,
    whatChanged: content.whatChanged,
    why: content.why,
    uncertainties: content.uncertainties,
    updatedAt: iso(input.artifact.updatedAt) ?? new Date(0).toISOString(),
    selectedAlternativeId: content.selectedAlternativeId,
    selectedAlternativeLabel: selected?.label ?? null,
    constraints: content.constraints,
    assumptionKeys: Object.keys(content.assumptions).sort(),
    nextActions: content.nextActions,
    implementation: content.implementation,
    monitoring: content.monitoring,
    linkedRefs: content.linkedRefs,
    sourceRefs: [...new Set(input.version.sourceRefs ?? [])],
    dependencyRefs: [...new Set(input.version.dependencyRefs ?? [])],
  });
}

export function automationSummaryFromWorkflow(
  workflow: ProjectAutomationWorkflow,
  latestRun: ProjectAutomationRun | null,
): P6AutomationSummary {
  const parsed = parseP9StoredWorkflow(workflow);
  return p6AutomationSummarySchema.parse({
    workflowId: workflow.id,
    name: workflow.name,
    template: workflow.template,
    enabled: workflow.enabled,
    triggerType: parsed.trigger.type,
    actionKind: parsed.action.kind,
    nextRunAt: iso(workflow.nextRunAt),
    lastRunAt: iso(workflow.lastRunAt),
    lastFailureAt: iso(workflow.lastFailureAt),
    consecutiveFailures: workflow.consecutiveFailures,
    latestRunStatus: latestRun?.status ?? null,
    latestRunSummary: latestRun?.summary ?? null,
    sourceRefs: workflow.sourceRefs,
    engineRefs: workflow.engineRefs,
    artifactRefs: workflow.artifactRefs,
  });
}

function changeSummary(delta: P7Delta | null): P6ChangeSummary | null {
  if (!delta) return null;
  return {
    fromSnapshotId: delta.fromSnapshotId,
    toSnapshotId: delta.toSnapshotId,
    added: delta.added.length,
    changed: delta.changed.length,
    removed: delta.removed.length,
    sourceRefs: [...new Set([
      ...delta.added.map((item) => item.sourceRef),
      ...delta.changed.map((item) => item.sourceRef),
      ...delta.removed.map((item) => item.sourceRef),
    ])].slice(0, 2_000),
  };
}

function buildContinuityGraph(
  projectId: number,
  graph: P7ContextGraph,
  sessions: P6SessionSummary[],
  decisions: P6DecisionMemoryEntry[],
  automations: P6AutomationSummary[],
): P6ContinuityGraph {
  const nodes = new Map<string, P6ContinuityNode>();
  const edges = new Map<string, P6ContinuityEdge>();

  for (const node of graph.nodes) addNode(nodes, { ...node });
  for (const edge of graph.edges) addEdge(edges, { ...edge });

  const projectNode = graph.nodes.find((node) => node.kind === "project");
  const projectNodeId = projectNode?.id ?? "project:" + projectId;
  addNode(nodes, {
    id: projectNodeId,
    kind: "project",
    label: projectNode?.label ?? "Project " + projectId,
    sourceRef: projectNode?.sourceRef ?? String(projectId),
    occurredAt: projectNode?.occurredAt ?? null,
    contentHash: projectNode?.contentHash ?? null,
    metadata: projectNode?.metadata ?? {},
  });

  for (const session of sessions) {
    const sessionNodeId = namespacedNodeId("session", session.sessionId);
    addNode(nodes, {
      id: sessionNodeId,
      kind: "session",
      label: session.name,
      sourceRef: session.sessionId,
      occurredAt: session.updatedAt,
      contentHash: null,
      metadata: {
        status: session.status,
        chatId: session.chatId,
        sourcePolicyRef: session.sourcePolicyRef,
        strategyRef: session.strategyRef,
        backtestRef: session.backtestRef,
      },
    });
    addEdge(edges, {
      id: edgeId(projectNodeId, "contains", sessionNodeId),
      from: projectNodeId,
      to: sessionNodeId,
      type: "contains",
      evidenceRefs: [],
      metadata: {},
    });
    if (session.chatId) {
      const chatRef = "chat:" + session.chatId;
      const existingChat = graph.nodes.find((node) => node.kind === "chat" && node.sourceRef === chatRef);
      const chatNodeId = existingChat?.id ?? chatRef;
      if (!existingChat) {
        addNode(nodes, {
          id: chatNodeId,
          kind: "chat",
          label: "Chat " + session.chatId,
          sourceRef: chatRef,
          occurredAt: null,
          contentHash: null,
          metadata: { referencedBySession: session.sessionId },
        });
      }
      addEdge(edges, {
        id: edgeId(sessionNodeId, "references", chatNodeId),
        from: sessionNodeId,
        to: chatNodeId,
        type: "references",
        evidenceRefs: [],
        metadata: {},
      });
    }
        if (session.parentSessionId) {
      const parentNodeId = namespacedNodeId("session", session.parentSessionId);
      addNode(nodes, {
        id: parentNodeId,
        kind: "session",
        label: session.parentSessionId,
        sourceRef: session.parentSessionId,
        occurredAt: null,
        contentHash: null,
        metadata: { referencedAsParent: true },
      });
      addEdge(edges, {
        id: edgeId(sessionNodeId, "branches_from", parentNodeId),
        from: sessionNodeId,
        to: parentNodeId,
        type: "branches_from",
        evidenceRefs: [],
        metadata: {},
      });
    }
    for (const assumptionRef of session.assumptionRefs) {
      const assumptionNodeId = "continuity-assumption-ref:" + hash(assumptionRef).slice(0, 28);
      addNode(nodes, {
        id: assumptionNodeId,
        kind: "assumption",
        label: assumptionRef,
        sourceRef: assumptionRef,
        occurredAt: null,
        contentHash: null,
        metadata: { referencedBySession: session.sessionId },
      });
      addEdge(edges, {
        id: edgeId(sessionNodeId, "assumes", assumptionNodeId),
        from: sessionNodeId,
        to: assumptionNodeId,
        type: "assumes",
        evidenceRefs: [],
        metadata: {},
      });
    }
    for (const artifactRef of session.artifactVersionRefs) {
      const artifactNodeId = existingGraphNodeId(graph, artifactRef) ?? "session-artifact-ref:" + hash(artifactRef).slice(0, 28);
      addNode(nodes, {
        id: artifactNodeId,
        kind: "artifact",
        label: artifactRef,
        sourceRef: artifactRef,
        occurredAt: null,
        contentHash: null,
        metadata: { referencedBySession: session.sessionId },
      });
      addEdge(edges, {
        id: edgeId(artifactNodeId, "configured_by", sessionNodeId),
        from: artifactNodeId,
        to: sessionNodeId,
        type: "configured_by",
        evidenceRefs: [artifactRef],
        metadata: {},
      });
    }
  }

  for (const decision of decisions) {
    const decisionNodeId = existingGraphNodeId(graph, decision.artifactId) ?? "decision-memory:" + decision.artifactId;
    addNode(nodes, {
      id: decisionNodeId,
      kind: "decision",
      label: decision.title,
      sourceRef: decision.artifactId,
      occurredAt: decision.updatedAt,
      contentHash: null,
      metadata: {
        artifactId: decision.artifactId,
        version: decision.version,
        selectedAlternativeId: decision.selectedAlternativeId,
        selectedAlternativeLabel: decision.selectedAlternativeLabel,
      },
    });
    addEdge(edges, {
      id: edgeId(projectNodeId, "contains", decisionNodeId),
      from: projectNodeId,
      to: decisionNodeId,
      type: "contains",
      evidenceRefs: decision.sourceRefs.slice(0, 500),
      metadata: {},
    });

    decision.monitoring.forEach((instruction, index) => {
      const monitorId = "decision-monitor:" + hash([decision.artifactId, instruction, index]).slice(0, 28);
      addNode(nodes, {
        id: monitorId,
        kind: "monitor",
        label: instruction.slice(0, 1_000),
        sourceRef: decision.linkedRefs.monitors[index] ?? null,
        occurredAt: decision.updatedAt,
        contentHash: null,
        metadata: { decisionArtifactId: decision.artifactId, linked: Boolean(decision.linkedRefs.monitors[index]) },
      });
      addEdge(edges, {
        id: edgeId(decisionNodeId, "monitors", monitorId),
        from: decisionNodeId,
        to: monitorId,
        type: "monitors",
        evidenceRefs: decision.sourceRefs.slice(0, 500),
        metadata: {},
      });
    });
  }

  for (const workflow of automations) {
    const automationNodeId = "automation:" + workflow.workflowId;
    addNode(nodes, {
      id: automationNodeId,
      kind: "automation",
      label: workflow.name,
      sourceRef: workflow.workflowId,
      occurredAt: workflow.lastRunAt,
      contentHash: null,
      metadata: {
        template: workflow.template,
        enabled: workflow.enabled,
        triggerType: workflow.triggerType,
        actionKind: workflow.actionKind,
        consecutiveFailures: workflow.consecutiveFailures,
      },
    });
    addEdge(edges, {
      id: edgeId(projectNodeId, "contains", automationNodeId),
      from: projectNodeId,
      to: automationNodeId,
      type: "contains",
      evidenceRefs: workflow.sourceRefs.slice(0, 500),
      metadata: {},
    });
    for (const artifactRef of workflow.artifactRefs) {
      const artifactNodeId = existingGraphNodeId(graph, artifactRef) ?? "continuity-artifact-ref:" + hash(artifactRef).slice(0, 28);
      addNode(nodes, {
        id: artifactNodeId,
        kind: "artifact",
        label: artifactRef,
        sourceRef: artifactRef,
        occurredAt: null,
        contentHash: null,
        metadata: { referencedByAutomation: workflow.workflowId },
      });
      addEdge(edges, {
        id: edgeId(automationNodeId, "refreshes", artifactNodeId),
        from: automationNodeId,
        to: artifactNodeId,
        type: "refreshes",
        evidenceRefs: workflow.sourceRefs.slice(0, 500),
        metadata: {},
      });
    }
  }

  return {
    projectId,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function buildContinuationQueue(input: {
  change: P6ChangeSummary | null;
  decisions: P6DecisionMemoryEntry[];
  automations: P6AutomationSummary[];
  insights: P7InsightLens;
  unreadChangeNotification: boolean;
}): P6ContinuationItem[] {
  const items = new Map<string, P6ContinuationItem>();
  const add = (item: P6ContinuationItem) => {
    if (!items.has(item.id)) items.set(item.id, item);
  };

  if (input.unreadChangeNotification && input.change && input.change.added + input.change.changed + input.change.removed > 0) {
    add({
      id: "review-change:" + input.change.toSnapshotId,
      kind: "review_change",
      priority: "high",
      title: "Review what changed",
      summary: `${input.change.added} added · ${input.change.changed} changed · ${input.change.removed} removed Project sources since the previous retained snapshot.`,
      sourceRefs: input.change.sourceRefs.slice(0, 500),
      artifactRefs: [],
      decisionArtifactId: null,
      workflowId: null,
      deterministic: true,
    });
  }

  for (const decision of input.decisions) {
    if (!decision.selectedAlternativeId && decision.nextActions.length > 0) {
      add({
        id: "complete-decision:" + decision.artifactId,
        kind: "complete_decision",
        priority: "medium",
        title: "Complete decision · " + decision.title,
        summary: "This Decision Artifact has explicit alternatives/next actions but no selected alternative yet.",
        sourceRefs: decision.sourceRefs.slice(0, 500),
        artifactRefs: [decision.artifactId],
        decisionArtifactId: decision.artifactId,
        workflowId: null,
        deterministic: true,
      });
    }
    if (decision.selectedAlternativeId && decision.monitoring.length > 0 && decision.linkedRefs.monitors.length === 0) {
      add({
        id: "configure-monitor:" + decision.artifactId,
        kind: "configure_monitor",
        priority: "medium",
        title: "Attach monitoring · " + decision.title,
        summary: "A selected decision has monitoring conditions but no linked monitor reference.",
        sourceRefs: decision.sourceRefs.slice(0, 500),
        artifactRefs: [decision.artifactId],
        decisionArtifactId: decision.artifactId,
        workflowId: null,
        deterministic: true,
      });
    }
  }

  for (const workflow of input.automations) {
    if (workflow.enabled && (workflow.consecutiveFailures > 0 || workflow.latestRunStatus === "failed")) {
      add({
        id: "automation-failed:" + workflow.workflowId,
        kind: "automation_failed",
        priority: "high",
        title: "Repair workflow · " + workflow.name,
        summary: workflow.latestRunSummary || `This enabled workflow has ${workflow.consecutiveFailures} consecutive failure(s).`,
        sourceRefs: workflow.sourceRefs.slice(0, 500),
        artifactRefs: workflow.artifactRefs.slice(0, 500),
        decisionArtifactId: null,
        workflowId: workflow.workflowId,
        deterministic: true,
      });
    }
  }

  for (const insight of input.insights.insights) {
    if (insight.kind === "open_question") {
      add({
        id: "open-question:" + insight.id,
        kind: "open_question",
        priority: insight.severity === "material" ? "high" : "medium",
        title: insight.title,
        summary: insight.summary,
        sourceRefs: insight.sourceRefs,
        artifactRefs: [],
        decisionArtifactId: null,
        workflowId: null,
        deterministic: true,
      });
    } else if (insight.kind === "risk") {
      add({
        id: "risk-review:" + insight.id,
        kind: "risk_review",
        priority: insight.severity === "material" ? "high" : "medium",
        title: insight.title,
        summary: insight.summary,
        sourceRefs: insight.sourceRefs,
        artifactRefs: [],
        decisionArtifactId: null,
        workflowId: null,
        deterministic: true,
      });
    } else if (insight.kind === "stale_evidence") {
      add({
        id: "stale-evidence:" + insight.id,
        kind: "refresh_stale_evidence",
        priority: "medium",
        title: insight.title,
        summary: insight.summary,
        sourceRefs: insight.sourceRefs,
        artifactRefs: [],
        decisionArtifactId: null,
        workflowId: null,
        deterministic: true,
      });
    }
  }

  return [...items.values()]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id))
    .slice(0, 500);
}

export function buildP6ContinuitySnapshot(input: {
  projectId: number;
  generatedAt: string;
  dependencies: ProjectDependencySummary;
  intelligenceGraph: P7ContextGraph;
  delta: P7Delta | null;
  insightLens: P7InsightLens;
  sessions: P6SessionSummary[];
  decisions: P6DecisionMemoryEntry[];
  automations: P6AutomationSummary[];
  unreadChangeNotification?: boolean;
}): P6ProjectContinuitySnapshot {
  const change = changeSummary(input.delta);
  const graph = buildContinuityGraph(input.projectId, input.intelligenceGraph, input.sessions, input.decisions, input.automations);
  const queue = buildContinuationQueue({
    change,
    decisions: input.decisions,
    automations: input.automations,
    insights: input.insightLens,
    unreadChangeNotification: input.unreadChangeNotification ?? false,
  });
  const fingerprint = hash({
    projectId: input.projectId,
    dependencies: input.dependencies,
    graph,
    sessions: [...input.sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    decisions: [...input.decisions].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    automations: [...input.automations].sort((a, b) => a.workflowId.localeCompare(b.workflowId)),
    changeSummary: change,
    continuationQueue: queue,
  });
  return p6ProjectContinuitySnapshotSchema.parse({
    schemaVersion: P6_CONTINUITY_SCHEMA_VERSION,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    fingerprint,
    dependencies: input.dependencies,
    graph,
    sessions: input.sessions,
    decisions: input.decisions,
    automations: input.automations,
    changeSummary: change,
    continuationQueue: queue,
    counts: {
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      sessions: input.sessions.length,
      branchedSessions: input.sessions.filter((item) => Boolean(item.parentSessionId)).length,
      decisions: input.decisions.length,
      unresolvedDecisions: input.decisions.filter((item) => !item.selectedAlternativeId).length,
      activeAutomations: input.automations.filter((item) => item.enabled).length,
      failedAutomations: input.automations.filter((item) => item.enabled && (item.consecutiveFailures > 0 || item.latestRunStatus === "failed")).length,
      continuationItems: queue.length,
    },
  });
}

async function loadSessionSummaries(ctx: TenantContext, projectId: number): Promise<P6SessionSummary[]> {
  const sessions = await listProjectSessions(ctx, projectId);
  return sessions.map((session) => {
    const state = projectWorkspaceSessionStateSchema.parse(session.workspaceState);
    const provenance = state.provenance ?? {
      layoutStateRef: null,
      sourcePolicyRef: null,
      strategyRef: null,
      backtestRef: null,
      assumptionRefs: [],
      artifactVersionRefs: [],
    };
    return p6SessionSummarySchema.parse({
      sessionId: session.id,
      name: session.name,
      status: session.status,
      chatId: session.chatId,
      parentSessionId: session.parentSessionId,
      updatedAt: iso(session.updatedAt),
      sourcePolicyRef: provenance.sourcePolicyRef,
      strategyRef: provenance.strategyRef,
      backtestRef: provenance.backtestRef,
      assumptionRefs: provenance.assumptionRefs,
      artifactVersionRefs: provenance.artifactVersionRefs,
    });
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.sessionId.localeCompare(b.sessionId));
}

async function loadDecisionMemory(ctx: TenantContext, projectId: number): Promise<P6DecisionMemoryEntry[]> {
  const artifacts = await listProjectArtifacts(ctx, projectId, { kind: "decision", limit: 500 });
  const entries = await Promise.all(artifacts.map(async (artifact) => {
    const version = await getArtifactVersion(ctx, artifact.id, artifact.headVersion);
    return decisionMemoryFromArtifact({ artifact, version });
  }));
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.artifactId.localeCompare(b.artifactId));
}

async function loadAutomationContext(ctx: TenantContext, projectId: number): Promise<{
  summaries: P6AutomationSummary[];
  unreadChangeNotification: boolean;
}> {
  const [workflows, runs, notifications] = await Promise.all([
    listP9Workflows(ctx, projectId),
    listP9Runs(ctx, projectId, undefined, 200),
    listP9Notifications(ctx, projectId, 200),
  ]);
  const latest = new Map<string, ProjectAutomationRun>();
  for (const run of runs) if (!latest.has(run.workflowId)) latest.set(run.workflowId, run);
  return {
    summaries: workflows.map((workflow) => automationSummaryFromWorkflow(workflow, latest.get(workflow.id) ?? null)),
    unreadChangeNotification: notifications.some((item) =>
      item.status === "delivered" && item.reason === "change_detected" && !item.readAt
    ),
  };
}

export async function getP6ProjectContinuity(
  ctx: TenantContext,
  projectId: number,
  options: { refreshIntelligence?: boolean; now?: Date } = {},
): Promise<P6ProjectContinuitySnapshot> {
  if (options.refreshIntelligence) await rebuildProjectIntelligence(ctx, projectId);

  const [dependencies, intelligence, insightLens, snapshots, sessions, decisions, automationContext] = await Promise.all([
    getProjectDependencySummary(ctx, projectId),
    currentProjectIntelligence(ctx, projectId),
    currentInsightLens(ctx, projectId),
    listProjectIntelligenceSnapshots(ctx, projectId, 2),
    loadSessionSummaries(ctx, projectId),
    loadDecisionMemory(ctx, projectId),
    loadAutomationContext(ctx, projectId),
  ]);
  const delta = snapshots.length >= 2
    ? await projectIntelligenceDelta(ctx, projectId, snapshots[1].id, snapshots[0].id)
    : null;

  return buildP6ContinuitySnapshot({
    projectId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    dependencies,
    intelligenceGraph: intelligence.graph,
    delta,
    sessions,
    insightLens,
    decisions,
    automations: automationContext.summaries,
    unreadChangeNotification: automationContext.unreadChangeNotification,
  });
}
