import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDirectoryInstallStatus, useDirectoryStatus } from "@/lib/useFinance";

const ACTIVE_STATES: Record<string, true> = { fetching: true, extracting: true, verifying: true };

/**
 * Offers the opt-in FinanceDatabase reference universe when it is not yet on
 * this computer. Renders nothing once the catalog is loaded. After a load
 * finishes, directory and search data refresh in place (no restart).
 */
export default function ReferenceUniverseLoadPrompt({ onLoaded, compact = false }: { onLoaded?: () => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const { data: catalogStatus } = useDirectoryStatus();
  const { data: installStatus } = useDirectoryInstallStatus();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const seenCompletion = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (installStatus?.state !== "completed") return;
    if (seenCompletion.current === undefined) {
      seenCompletion.current = installStatus.completedAt;
      if (catalogStatus?.financeDatabase.imported) return;
    } else if (seenCompletion.current === installStatus.completedAt) return;
    seenCompletion.current = installStatus.completedAt;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/facets"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/regions"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/directory"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/finance/search"] }),
    ]).then(() => onLoadedRef.current?.());
  }, [installStatus?.state, installStatus?.completedAt, catalogStatus?.financeDatabase.imported, queryClient]);

  if (!catalogStatus || catalogStatus.financeDatabase.imported) return null;

  const loading = starting || (!!installStatus && !!ACTIVE_STATES[installStatus.state]);
  const failure = error ?? (installStatus?.state === "failed" ? installStatus.error || "Loading stopped. Try again." : null);

  const start = async () => {
    const confirmed = window.confirm(
      "Load global securities? This downloads about 170 MB of public reference data (FinanceDatabase, MIT licence) to this computer. " +
      "It lists symbols and names only — it does not include live prices."
    );
    if (!confirmed) return;
    setError(null);
    setStarting(true);
    try {
      const response = await fetch("/api/finance/directory/install", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSourceDownload: true }),
      });
      if (response.status === 403) {
        setError("An administrator must load global securities for this workspace.");
        return;
      }
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string };
        setError(detail.error || "Could not start loading. Try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/finance/directory/install/status"] });
    } catch {
      setError("Could not start loading. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  const progress = installStatus?.state === "verifying"
    ? "Checking the download…"
    : installStatus && installStatus.filesExtracted > 0
      ? `Loading… ${installStatus.filesExtracted.toLocaleString()} files unpacked`
      : "Downloading…";

  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? "p-3" : "p-6"}`} data-testid="reference-universe-load-prompt">
      <p className="text-[11px] text-muted-foreground">More than 300,000 global stocks, funds, ETFs and indices can be added for search.</p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={loading}
        className="rounded border border-[hsl(38,95%,55%)]/50 px-3 py-1 text-[11px] text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,55%)]/10 disabled:opacity-60"
      >
        {loading ? progress : "Load global securities (300k+, ~170 MB download from FinanceDatabase, MIT)"}
      </button>
      {failure && <p role="alert" className="text-[11px] text-red-400">{failure}</p>}
    </div>
  );
}
