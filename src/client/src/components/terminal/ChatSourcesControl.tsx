import * as React from "react";
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SourceRegistry } from "@shared/sourceRegistry";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import { apiRequest } from "@/lib/queryClient";
import { P1_SOURCE_SCOPES } from "@/lib/p1Shell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterSourceCatalogue } from "@/lib/filterSourceCatalogue";
import { SourceCatalogueSearch } from "./SourceCatalogueSearch";
import { sourceAvailability, SOURCE_AVAILABILITY_COPY } from "@/lib/composerAvailability";
import { sourceCataloguePresentation } from "@/lib/sourceCataloguePresentation";

interface Props {
  scope: ConversationSourceScope;
  onScopeChange: (scope: ConversationSourceScope) => void;
  onOpenConnections: () => void;
  disabled?: boolean;
  projectAvailable: boolean; // true for a regular Quick or Project Chat; false for Temporary
}

/** A view over Connection Center's catalogue, never a separate source authority. */
export default function ChatSourcesControl({ scope, onScopeChange, onOpenConnections, disabled = false, projectAvailable }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [connectedOnly, setConnectedOnly] = useState(false);
  const catalogueId = useId();
  const registry = useQuery<SourceRegistry>({
    queryKey: ["/api/setup/source-registry"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-registry")).json(),
    enabled: open,
    staleTime: 30_000,
  });
  const matches = useMemo(() => filterSourceCatalogue(registry.data?.groups ?? [], search, connectedOnly), [registry.data, search, connectedOnly]);
  const presentation = sourceCataloguePresentation({
    hasData: Boolean(registry.data),
    failed: registry.isError,
    fetching: registry.isFetching,
    matchingCount: matches.length,
  });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} aria-controls={catalogueId} className="min-h-11 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}</button></PopoverTrigger>
    <PopoverContent side="top" align="start" id={catalogueId} aria-label="Chat sources" className="z-[100] max-h-[min(85dvh,32rem)] w-96 max-w-[90vw] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
      <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 font-medium">Source scope</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block min-h-11 rounded-lg border border-border/50 px-3 py-2 hover:bg-accent/30"><input type="radio" name={`${catalogueId}-scope`} value={item.id} checked={scope === item.id} disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")} onChange={() => onScopeChange(item.id)} className="mr-2 accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" /><span className="font-medium">{item.label}</span><span className="block pl-5 text-xs leading-5 text-muted-foreground">{item.description}</span></label>)}
      </fieldset>
      <p className="my-3 text-sm text-muted-foreground">Connection state is not permission to send data to AI, export it, or use it outside its licence. Choosing a scope does not grant access or start retrieval. Provider prices and quotas are not verified here; review terms before using a paid source.</p>
      <SourceCatalogueSearch value={search} disabled={disabled} onChange={setSearch} onClear={() => setSearch("")} placeholder="Search registered sources…" hint="Catalog availability is not a connection or authorization." />
      <label className="my-2 flex min-h-11 items-center gap-2 rounded-lg px-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"><input type="checkbox" disabled={disabled} checked={connectedOnly} onChange={event => setConnectedOnly(event.target.checked)} />Saved connections only</label>
      {registry.isLoading && <p role="status">Loading your source catalogue…</p>}
      {registry.isError && <div role="alert" className="my-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">Source catalogue refresh failed. {registry.data ? "Showing previously loaded records, not current availability." : "Source availability is unverified."}</p>
        <button type="button" disabled={registry.isFetching} aria-busy={registry.isFetching}
          onClick={() => void registry.refetch()}
          className="mt-2 min-h-11 rounded-lg border border-border px-3 py-2 font-ui text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
          {registry.isFetching ? "Retrying catalogue…" : "Retry read-only catalogue"}
        </button>
      </div>}
      {!registry.data && presentation.healthLabel && <p role="status" className="my-2 text-sm text-muted-foreground">{presentation.healthLabel}</p>}
      {registry.data && <>
        <h3 className="font-medium">{presentation.heading}</h3>
        <p role="status" aria-live="polite" className="my-2 text-sm text-muted-foreground">{presentation.countLabel}</p>
        <ul className="my-2 space-y-2" aria-label="Matching sources">{matches.map(item => <li key={item.id} className="rounded border border-border/60 p-2">
          <span className="font-medium">{item.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">{SOURCE_AVAILABILITY_COPY[sourceAvailability(item)]}</span>
          <p className="text-sm text-muted-foreground">{item.detail}</p>
          <p className="text-sm text-muted-foreground">Recorded status: {item.state.replaceAll("_", " ")}{item.lastCheckedAt ? ` · checked ${item.lastCheckedAt}` : " · not checked"}</p>
          {item.licenseCaveat && <p className="text-sm text-amber-200">{item.licenseCaveat}</p>}
        </li>)}</ul>
        {!matches.length && <p role="status">{presentation.emptyLabel}</p>}
        {presentation.healthLabel && <p className="text-sm text-muted-foreground">{presentation.healthLabel}</p>}
        {registry.data.summary.connectionCount === 0 && <p className="text-sm text-muted-foreground">{projectAvailable ? "No saved connections. Explicitly attached files remain governed by this Chat's selected policy." : "Temporary Chat does not retain uploaded files or Project context."}</p>}
      </>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setOpen(false); onOpenConnections(); }} className="min-h-11 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Manage sources in Connection Center</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Close</button>
      </div>
    </PopoverContent>
  </Popover>;
}
