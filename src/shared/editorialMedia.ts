import { z } from "zod";

/**
 * A2 media rights are a separate, explicit assertion by the content owner.
 * Neither a source URL nor a NewsItem provider grants image redistribution.
 * Only a locally bundled, hash-named LiOS image can be projected to the UI.
 */
export const editorialMediaSchema = z.object({
  kind: z.literal("image"),
  assetPath: z.string().max(130).regex(/^\/editorial-media\/[a-f0-9]{64}\.(?:webp|avif|png|jpg|jpeg)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  alt: z.string().trim().min(5).max(300),
  caption: z.string().trim().max(500).optional(),
  attribution: z.string().trim().min(2).max(240),
  owner: z.string().trim().min(2).max(240),
  licenseName: z.string().trim().min(2).max(180),
  licenseEvidenceRef: z.string().trim().min(4).max(300),
  sourceEvidenceId: z.string().trim().min(1).max(2048),
  verifiedBy: z.string().trim().min(2).max(160),
  verifiedAt: z.string().datetime(),
  permission: z.literal("commercial_redistribution_and_display"),
  offlineBundlingPermitted: z.literal(true),
  state: z.enum(["approved", "revoked", "pending"]),
  expiresAt: z.string().datetime().optional(),
}).strict().superRefine((media, context) => {
  const expectedName = media.assetPath.split("/").at(-1);
  if (!expectedName?.startsWith(media.sha256 + ".")) context.addIssue({
    code: z.ZodIssueCode.custom, path: ["assetPath"],
    message: "Filename hash must equal the reviewed asset SHA-256.",
  });
  if (media.expiresAt && Date.parse(media.expiresAt) <= Date.parse(media.verifiedAt)) context.addIssue({
    code: z.ZodIssueCode.custom, path: ["expiresAt"],
    message: "Media rights expiry must be later than verification.",
  });
});

export type EditorialMedia = z.infer<typeof editorialMediaSchema>;

export function eligibleEditorialMedia(
  input: unknown,
  sourceIds: readonly string[],
  observedAt: string,
): EditorialMedia | null {
  const parsed = editorialMediaSchema.safeParse(input);
  if (!parsed.success) return null;
  const media = parsed.data;
  const now = Date.parse(observedAt);
  if (media.state !== "approved" || !Number.isFinite(now) || now < Date.parse(media.verifiedAt)) return null;
  if (media.expiresAt && now >= Date.parse(media.expiresAt)) return null;
  if (!sourceIds.includes(media.sourceEvidenceId)) return null;
  return media;
}
