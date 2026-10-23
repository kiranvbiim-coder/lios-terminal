import { z } from "zod";
import { terminalScreenStateSchema } from "@shared/terminalArtifact";
import { retainedArtifactMessageRef } from "@shared/conversationArtifactRefs";
import { persistConversationDraft } from "./artifactStore";
import { getProjectChat, retainTerminalNavigationMessages } from "./projectChatStore";
import type { TenantContext } from "./tenantContext";

export const openTerminalArtifactSchema = z.object({
  requestId: z.string().uuid(),
  view: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  symbol: z.string().trim().min(1).max(100).nullable(),
  state: terminalScreenStateSchema,
  message: z.string().trim().max(2000).optional(),
}).strict();
export async function openTerminalArtifact(ctx: TenantContext, chatId: number, raw: unknown) {
  const input = openTerminalArtifactSchema.parse(raw);
  const chat = await getProjectChat(ctx, chatId);
  if (input.state.subject.symbol !== input.symbol) throw new Error("Terminal subject must match the selected screen.");
  if (input.state.marketMode !== "live" || input.state.asOf !== null) throw new Error("Opening a view cannot invent a frozen market observation. Use an authorized source snapshot.");
  const result = await persistConversationDraft(ctx, {
    projectId: chat.projectId, owningChatId: chatId, requestId: input.requestId,
    draft: {
      schemaVersion: "1", artifactId: input.requestId, artifactType: "screen", title: input.title,
      projectId: chat.projectId, sourceRefs: [], executionReceiptIds: [],
      persistence: chat.projectId === null ? "chat_candidate" : "project_candidate",
      data: { kind: "screen", view: input.view, symbol: input.symbol, state: { terminal: input.state } },
    },
  });
  await retainTerminalNavigationMessages(ctx, chatId, input.requestId, {
    user: input.message || `Open ${input.title}`,
    assistant: `Opened ${input.title}. This is the existing interactive terminal tool. Analytical inputs and settings are retained here; live observations remain subject to connected-source availability.`,
    artifactRef: retainedArtifactMessageRef(result),
  });
  return result;
}
