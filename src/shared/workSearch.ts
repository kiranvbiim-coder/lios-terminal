import { z } from "zod";

export const workSearchKindSchema = z.enum(["project", "chat", "artifact", "file"]);

export const workSearchResultSchema = z.object({
  kind: workSearchKindSchema,
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  snippet: z.string().max(600).nullable(),
  projectId: z.number().int().positive().nullable(),
  chatId: z.number().int().positive().nullable(),
  artifactId: z.string().min(1).max(500).nullable(),
  resourceId: z.string().min(1).max(500).nullable(),
  updatedAt: z.string().min(1).max(100),
}).strict();

export const workSearchResponseSchema = z.object({
  query: z.string().max(200),
  results: z.array(workSearchResultSchema).max(50),
}).strict();

export type WorkSearchResult = z.infer<typeof workSearchResultSchema>;
export type WorkSearchResponse = z.infer<typeof workSearchResponseSchema>;
