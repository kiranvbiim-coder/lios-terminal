import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { CommonsCandidate } from "@shared/commonsMedia";
import { CommonsContextIllustration } from "../panels/NewsImageDiscovery";
import { automaticContextSearchTerm, chooseAutomaticContextImage } from "@/lib/newsAutomaticContext";

/**
 * Opt-in only: recorded Wave D cards may contain private research. Nothing
 * reaches Wikimedia Commons until the person deliberately requests imagery.
 * This does not convert a Commons CC0 preview to an editorial rights grant.
 */
export function RecordedContextPicture({ title, hasPublicEvidence }: {
  title: string;
  hasPublicEvidence: boolean;
}) {
  const [image, setImage] = useState<CommonsCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const term = hasPublicEvidence ? automaticContextSearchTerm(title) : null;
  useEffect(() => {
    abortRef.current?.abort();
    setImage(null);
    setOpen(false);
    setLoading(false);
    setError(null);
    return () => abortRef.current?.abort();
  }, [title, hasPublicEvidence]);

  if (!term) return null;
  const load = async () => {
    if (loading) return;
    if (open) { setOpen(false); return; }
    if (image) { setOpen(true); return; }
    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/media/commons/cc0?q=" + encodeURIComponent(term), {
        credentials: "same-origin", signal: abort.signal,
      });
      if (!response.ok) throw new Error("Commons lookup unavailable.");
      const payload: unknown = await response.json();
      if (abort.signal.aborted) return;
      const choice = chooseAutomaticContextImage(payload, term);
      if (!choice) { setError("No matching CC0 context image was found."); return; }
      setImage(choice);
      setOpen(true);
    } catch {
      if (!abort.signal.aborted) setError("Commons image preview unavailable.");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  };
  return <section data-testid="recorded-context-picture" className="min-w-0">
    <button type="button" onClick={() => void load()} disabled={loading}
      aria-expanded={open}
      className="min-h-10 rounded-lg border border-border/60 px-3 py-2 font-ui text-xs text-amber-100 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber-300">
      {loading ? "Checking CC0 source…" : open ? "Hide context picture" : "Find context picture"}
    </button>
    {!open && <p className="mt-1 font-ui text-xs text-muted-foreground">
      Optional: sends only this recorded headline to Wikimedia Commons after your click.
    </p>}
    {error && <p role="status" className="mt-2 font-ui text-xs text-muted-foreground">{error}</p>}
    {open && image && <div className="mt-3">
      <CommonsContextIllustration candidate={image} showSource />
    </div>}
  </section>;
}
