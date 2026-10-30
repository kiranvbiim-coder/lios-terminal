import { z } from "zod";

export const PROJECT_MEMORY_NOTE_MAX_CHARS = 4_000;
const content = z.string().min(1).max(PROJECT_MEMORY_NOTE_MAX_CHARS)
  .refine(value => Boolean(value.trim()) && !value.includes("\u0000"), "A note needs text without NUL characters.");
const revision = z.number().int().positive().safe();
export const projectMemoryNoteSchema = z.object({
  memoryKey: z.string().min(1).max(2_000),
  revision,
  content,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type ProjectMemoryNote = z.infer<typeof projectMemoryNoteSchema>;

/** Owner-authored text only. No origin/source/tenant/recall permission can come from a request body. */
export const createProjectMemoryNoteSchema = z.object({ content, reviewed: z.literal(true) }).strict();
export const updateProjectMemoryNoteSchema = z.object({ content, expectedRevision: revision, reviewed: z.literal(true) }).strict();
export const deleteProjectMemoryNoteSchema = z.object({ expectedRevision: revision, reviewed: z.literal(true) }).strict();
export const projectMemoryNoteListSchema = z.object({
  notes: z.array(projectMemoryNoteSchema).max(50),
  nextCursor: z.string().min(1).max(2_000).nullable(),
}).strict();
export type ProjectMemoryNoteList = z.infer<typeof projectMemoryNoteListSchema>;
