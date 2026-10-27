/**
 * Source-verified picture discovery over the existing News feed.
 * Never turns RSS imageCandidate metadata into a display licence.
 * The server still owns disk hash/grant validation before providing media.
 */
import { eligibleEditorialMedia } from "@shared/editorialMedia";

export interface NewsMediaRecord {
  url: string;
  media?: unknown;
}

/** Preserve feed order and the exact source identity for rights checks. */
export function newsWithApprovedPhotos<T extends NewsMediaRecord>(
  items: readonly T[], asOf: string,
): T[] {
  return items.filter(item => eligibleEditorialMedia(item.media, [item.url], asOf) !== null);
}

export function approvedPhotoCount(items: readonly NewsMediaRecord[], asOf: string): number {
  return newsWithApprovedPhotos(items, asOf).length;
}
