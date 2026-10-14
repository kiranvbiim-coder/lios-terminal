import { projectPortabilityManifestV1Schema, type ProjectPortabilityManifestV1 } from "@shared/ledgerContracts";
import { projectWorkspaceSessionStateSchema } from "@shared/projectContracts";
import type { TenantContext } from "./tenantContext";
import { getProject } from "./projectStore";
import { listProjectResources } from "./projectResourceStore";
import { listProjectChats } from "./projectChatStore";
import { listProjectSessions } from "./projectSessionStore";
import {
  countProjectLedgerEvents,
  hashLedgerValue,
  listProjectLedgerStreamHeads,
  sanitizeLedgerPayload,
} from "./ledgerStore";

export async function createProjectPortabilityManifest(
  ctx: TenantContext,
  projectId: number,
): Promise<ProjectPortabilityManifestV1> {
  const [project, activeChats, archivedChats, activeSessions, archivedSessions, resources, streams, eventCount] = await Promise.all([
    getProject(ctx, projectId),
    listProjectChats(ctx, { projectId, status: "active" }),
    listProjectChats(ctx, { projectId, status: "archived" }),
    listProjectSessions(ctx, projectId, "active"),
    listProjectSessions(ctx, projectId, "archived"),
    listProjectResources(ctx, projectId, true),
    listProjectLedgerStreamHeads(ctx, projectId),
    countProjectLedgerEvents(ctx, projectId),
  ]);

  const sessions = [...activeSessions, ...archivedSessions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((session) => {
      const state = projectWorkspaceSessionStateSchema.parse(session.workspaceState);
      return {
        id: session.id,
        parentSessionId: session.parentSessionId,
        chatId: session.chatId,
        stateHash: hashLedgerValue(sanitizeLedgerPayload(state)),
        provenance: sanitizeLedgerPayload(state.provenance ?? {}) as Record<string, unknown>,
        updatedAt: session.updatedAt.toISOString(),
      };
    });

  const withoutHash = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      instructionsHash: hashLedgerValue(project.instructions ?? ""),
      updatedAt: project.updatedAt.toISOString(),
    },
    chats: [...activeChats, ...archivedChats]
      .sort((a, b) => a.id - b.id)
      .map((chat) => ({
        id: chat.id,
        status: chat.status === "archived" ? "archived" as const : "active" as const,
        titleHash: hashLedgerValue(chat.title),
        updatedAt: chat.updatedAt.toISOString(),
      })),
    sessions,
    // Portability manifests carry LiOS resource identities only. Raw resourceRef values
    // may be local paths, signed URLs or provider locators and are deliberately excluded.
    resourceRefs: resources.map((resource) => resource.id).sort(),
    ledger: {
      schemaVersion: "1" as const,
      eventCount,
      streams: streams.map((stream) => ({
        streamId: stream.streamId,
        headSequence: Math.max(0, Number(stream.nextSequence) - 1),
        headHash: stream.headHash,
      })),
    },
    excludesCredentials: true as const,
  };
  return projectPortabilityManifestV1Schema.parse({
    ...withoutHash,
    manifestHash: hashLedgerValue(withoutHash),
  });
}
