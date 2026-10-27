import * as React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { eligibleEditorialMedia, type EditorialMedia } from "@shared/editorialMedia";

/**
 * Pure presentation. Only approved, source-linked, hash-named local assets
 * ever enter an <img> src. This component NEVER fetches a publisher preview.
 * Failed/missing media collapses to the original text-first editorial layout.
 */
export function LicensedEditorialImage({
  media, sourceIds, className = "", sizes, asOf, fallback,
}: {
  media: EditorialMedia | unknown;
  sourceIds: readonly string[];
  className?: string;
  sizes?: string;
  asOf?: string;
  fallback?: ReactNode;
}) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const eligible = eligibleEditorialMedia(media, sourceIds, asOf ?? new Date().toISOString());
  const asset = eligible?.assetPath ?? null;
  useEffect(() => { setFailedPath(null); }, [asset]);
  if (!eligible || !asset || failedPath === asset) return <>{fallback ?? null}</>;

  return <figure data-testid="licensed-editorial-image"
    className={`min-w-0 overflow-hidden rounded-lg border border-border/40 bg-background/40 ${className}`}>
    <img src={asset} alt={eligible.alt} decoding="async" loading="lazy"
      referrerPolicy="no-referrer" sizes={sizes}
      onError={() => setFailedPath(asset)}
      className="block h-40 w-full object-cover sm:h-48" />
    <figcaption className="space-y-0.5 px-3 py-2 font-ui text-xs leading-5 text-muted-foreground">
      {eligible.caption && <span className="block text-foreground/80">{eligible.caption}</span>}
      <span className="block">Image: {eligible.attribution} · {eligible.licenseName}</span>
    </figcaption>
  </figure>;
}
