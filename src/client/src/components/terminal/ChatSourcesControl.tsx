import * as React from "react";
import { useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SourceRegistry } from "@shared/sourceRegistry";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import { apiRequest } from "@/lib/queryClient";
import { P1_SOURCE_SCOPES } from "@/lib/p1Shell";
import { filterSourceCatalogue } from "@/lib/filterSourceCatalogue";
import { sourceCatalogueCoverage, sourceCatalogueStatus } from "@/lib/sourceCatalogueStatus";
import { SourceCatalogueSearch } from "./SourceCatalogueSearch";

interface Props {
  scope: ConversationSourceScope;
  onScopeChange: (scope: ConversationSourceScope) => void;
  onOpenConnections: () => void;
  disabled?: boolean;
  projectAvailable: boolean; // false for Temporary Chat
}

/**
 * Read-only catalogue + the existing P1 scope selector.
 * Individual rows never select an execution source, create a permission grant
 * or override P5 entitlement/AI transmission policy.
 */
export default function ChatSourcesControl({ scope, onScopeChange, onOpenConnections, disabled = false, projectAvailable }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [connectedOnly, setConnectedOnly] = useState(false);
  const catalogueId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dismiss = () => { setOpen(false); triggerRef.current?.focus(); };
  const registry = useQuery<SourceRegistry>({
    queryKey: ["/api/setup/source-registry"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-registry")).json(),
    enabled: open,
    staleTime: 30_000,
  });
  const matches = useMemo(
    () => filterSourceCatalogue(registry.data?.groups ?? [], search, connectedOnly),
    [registry.data, search, connectedOnly],
  );
  const total = registry.data?.groups.reduce((count, group) => count + group.items.length, 0) ?? 0;
  const groupTitles = useMemo(() => new Map((registry.data?.groups ?? []).map(group => [group.id, group.title])), [registry.data]);
  const unavailableTemporaryScope = !projectAvailable && (scope === "my_data" || scope === "files");

  return <div className="relative">
    <button
      type="button"
      ref={triggerRef}
      disabled={disabled}
      aria-expanded={open}
      aria-controls={catalogueId}
      onClick={() => setOpen(value => !value)}
      className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}
    </button>
    {open && <section
      id={catalogueId}
      aria-label="Chat sources"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}
      className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(85vh,32rem)] w-96 max-w-[90vw] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg"
    >
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 font-medium">Source scope</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block">
          <input
            type="radio"
            name={`chat-source-scope-${catalogueId}`}
            value={item.id}
            checked={scope === item.id}
            disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")}
            onChange={() => onScopeChange(item.id)}
            className="mr-2"
          />
          {item.label}
          <span className="block pl-5 text-xs text-muted-foreground">{item.description}</span>
        </label>)}
      </fieldset>
      {unavailableTemporaryScope && <p role="alert" className="mt-2 text-xs text-amber-200">
        My Data and Files are unavailable in Temporary Chat. Select Auto or Web before sending.
      </p>}
      <p className="my-3 text-xs text-muted-foreground">
        Auto is a governed routing preference, not permission to use every listed provider.
        A saved connection, a successful health check and legal rights to send data to AI or export it are separate.
      </p>
      <div className="space-y-2 border-t border-border/60 pt-3">
        <h3 className="font-ui text-sm font-medium">Source catalogue</h3>
        <SourceCatalogueSearch
          autoFocus
          value={search}
          disabled={disabled}
          onChange={setSearch}
          onClear={() => setSearch("")}
          placeholder="Search registered sources…"
          hint="Search names, groups, capabilities, coverage or status."
        />
        <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground">
          <input
            type="checkbox"
            disabled={disabled}
            checked={connectedOnly}
            onChange={event => setConnectedOnly(event.target.checked)}
          />
          Saved connections only (including unverified or unhealthy)
        </label>
      </div>
      {registry.isLoading && <p role="status" className="mt-3 text-xs">Loading your source catalogue…</p>}
      {registry.isError && <p role="alert" className="mt-3 text-xs">
        Source catalogue unavailable. No connection or entitlement state can be confirmed.
        <button type="button" className="ml-1 underline" onClick={() => void registry.refetch()}>Retry</button>
      </p>}
      {registry.isSuccess && registry.data && <div className="mt-3">
        <p role="status" aria-live="polite" className="mb-2 text-xs text-muted-foreground">
          {matches.length} of {total} registered source{total === 1 ? "" : "s"} shown
        </p>
        {matches.length ? <ul className="space-y-2" aria-label="Matching sources">
          {matches.map(item => {
            const status = sourceCatalogueStatus(item);
            const coverage = sourceCatalogueCoverage(item);
            return <li key={item.id} className="rounded-md border border-border/60 p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-ui text-sm font-medium">{item.name}</span>
                <span className={`shrink-0 font-ui text-[11px] ${status.requiresAttention ? "text-amber-200" : "text-muted-foreground"}`}>{status.runtime}</span>
              </div>
              <p className="mt-1 font-ui text-[11px] text-muted-foreground">{groupTitles.get(item.group) ?? item.group} · {status.connection}</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p>
              {coverage && <p className="mt-1 break-words text-xs text-muted-foreground">Registered coverage: {coverage}</p>}
              {item.lastCheckedAt && <p className="mt-1 text-[11px] text-muted-foreground">Last recorded check: {item.lastCheckedAt.slice(0, 10)} (not a live availability guarantee)</p>}
              {item.licenseCaveat && <p className="mt-1 break-words text-xs text-amber-200">Rights note: {item.licenseCaveat}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">{status.advisory}</p>
            </li>;
          })}
        </ul> : <p role="status" className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
          {search.trim() ? "No matching registered sources. Clear the search or manage connections."
            : connectedOnly ? "No saved connections. Manage connections to add one."
              : "No sources in the registered catalogue."}
        </p>}
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        <button
          type="button"
          onClick={() => { setOpen(false); onOpenConnections(); }}
          className="min-h-9 rounded border border-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >Manage sources in Connection Center</button>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-9 rounded border border-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >Close</button>
      </div>
    </section>}
  </div>;
}
