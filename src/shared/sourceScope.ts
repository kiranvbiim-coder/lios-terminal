import { z } from "zod";

export const conversationSourceScopeSchema = z.enum(["auto", "my_data", "web", "files"]);
export type ConversationSourceScope = z.infer<typeof conversationSourceScopeSchema>;

export const CONVERSATION_SOURCE_SCOPE_LABELS: Record<ConversationSourceScope, string> = {
  auto: "Auto",
  my_data: "My Data",
  web: "Web",
  files: "Files",
};
