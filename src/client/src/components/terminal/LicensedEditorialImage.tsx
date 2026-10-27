import * as React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { eligibleEditorialMedia, type EditorialMedia } from "@shared/editorialMedia";

/**
 * Pure presentation. Only approved, source-linked, hash-named local assets
 * ever enter an <img> src. This component NEVER fetches a publisher preview.
 * Failed/missing media collapses to the original text-first editorial layout.
 */
export function LicensedEditorialImage({
  media, sourceIds, className = "", sizes, asOf, fallback, variant = "featured", showSourceLink = true,
}: {
  media: EditorialMedia | unknown;
  sourceIds: readonly string[];
  className?: string;
  sizes?: string;
  asOf?: string;
  fallback?: ReactNode;
  variant?: "featured" | "compact";
  /** Disable nested image-source links when hosted inside an outer story button. */
  showSourceLink?: boolean;
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
      className={variant === "compact" ? "block h-20 w-full object-cover sm:h-24" : "block h-40 w-full object-cover sm:h-48"} />
    <figcaption className={variant === "compact" ? "space-y-0.5 px-2 py-1 font-ui text-[10px] leading-4 text-muted-foreground" : "space-y-0.5 px-3 py-2 font-ui text-xs leading-5 text-muted-foreground"}>
      {eligible.usageContext === "illustrative" && <span className="block font-semibold text-amber-200" data-testid="media-illustrative-label">Context illustration · not a photograph of this news event</span>}
      {eligible.caption && <span className="block text-foreground/80">{eligible.caption}</span>}
      <span className="block">Image: {eligible.attribution} · {eligible.licenseName}</span>
      {eligible.mediaSourcePage && showSourceLink && <a href={eligible.mediaSourcePage} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-block underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-amber-300">Image source and license</a>}
    </figcaption>
  </figure>;
}
