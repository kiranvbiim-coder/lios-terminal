/** UI preflight only: the existing authenticated server validates signatures and ownership. */
const SUPPORTED = new Set(["pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "tsv", "json", "png", "jpg", "jpeg", "webp"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export type StagedFile = Pick<File, "name" | "size" | "lastModified">;

export function stagedFileKey(file: StagedFile): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function planAttachmentStage<T extends StagedFile>(
  existing: readonly T[],
  newFiles: readonly T[],
  savedReferenceCount: number,
): { files: T[]; error: string | null } {
  const staged = [...existing];
  const seen = new Set(existing.map(stagedFileKey));
  for (const file of newFiles) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!SUPPORTED.has(ext)) return { files: [...existing], error: "Unsupported file type. Use PDF, Office, TXT, Markdown, CSV, TSV, JSON or a supported image." };
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 20 * 1024 * 1024)
      return { files: [...existing], error: "Each file must be between 1 byte and 20 MiB." };
    if (IMAGE_EXTENSIONS.has(ext) && file.size > 6 * 1024 * 1024)
      return { files: [...existing], error: "Images must be 6 MiB or smaller." };
    const key = stagedFileKey(file);
    if (seen.has(key)) continue; // Repeat picker/drop events do not create a duplicate upload.
    if (savedReferenceCount + staged.length >= 5)
      return { files: [...existing], error: "A message can include up to five files. Remove a file before adding another." };
    seen.add(key);
    staged.push(file);
  }
  return { files: staged, error: null };
}

/** A progress event measures bytes transferred, not saved/verified attachment success. */
export function progressPercent(loaded: number, total: number, computable: boolean): number | null {
  if (!computable || !Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return null;
  return Math.max(0, Math.min(99, Math.floor(loaded / total * 100)));
}
