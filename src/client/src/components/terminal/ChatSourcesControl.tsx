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
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} aria-controls={catalogueId} className="min-h-10 rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}</button></PopoverTrigger>
    <PopoverContent side="top" align="start" id={catalogueId} aria-label="Chat sources" className="z-[100] max-h-[min(85dvh,32rem)] w-96 max-w-[90vw] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
      <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 font-medium">Source scope</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block"><input type="radio" name={`${catalogueId}-scope`} value={item.id} checked={scope === item.id} disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")} onChange={() => onScopeChange(item.id)} className="mr-2" />{item.label}<span className="block pl-5 text-xs text-muted-foreground">{item.description}</span></label>)}
      </fieldset>
      <p className="my-3 text-sm text-muted-foreground">Connection state is not permission to send data to AI, export it, or use it outside its licence. Choosing a scope does not grant access or start retrieval. Provider prices and quotas are not verified here; review terms before using a paid source.</p>
      <SourceCatalogueSearch value={search} disabled={disabled} onChange={setSearch} onClear={() => setSearch("")} placeholder="Search registered sources…" hint="Catalog availability is not a connection or authorization." />
      <label className="my-2 flex min-h-10 items-center gap-2"><input type="checkbox" disabled={disabled} checked={connectedOnly} onChange={event => setConnectedOnly(event.target.checked)} />Saved connections only</label>
      {registry.isLoading && <p role="status">Loading your source catalogue…</p>}
      {registry.isError && <p role="alert">Source catalogue unavailable. <button type="button" className="underline" onClick={() => void registry.refetch()}>Retry</button></p>}
      {registry.data && <>
        <h3 className="font-medium">Registered source catalogue</h3>
        <p role="status" aria-live="polite" className="my-2 text-sm text-muted-foreground">{matches.length} matching registered source{matches.length === 1 ? "" : "s"}</p>
        <ul className="my-2 space-y-2" aria-label="Matching sources">{matches.map(item => <li key={item.id} className="rounded border border-border/60 p-2">
          <span className="font-medium">{item.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">{SOURCE_AVAILABILITY_COPY[sourceAvailability(item)]}</span>
          <p className="text-sm text-muted-foreground">{item.detail}</p>
          <p className="text-sm text-muted-foreground">Recorded status: {item.state.replaceAll("_", " ")}{item.lastCheckedAt ? ` · checked ${item.lastCheckedAt}` : " · not checked"}</p>
          {item.licenseCaveat && <p className="text-sm text-amber-200">{item.licenseCaveat}</p>}
        </li>)}</ul>
        {!matches.length && <p role="status">No matching sources. Clear the search or manage connections.</p>}
        {registry.isError && <p className="text-sm text-amber-200">Showing the last loaded catalogue; current availability could not be refreshed.</p>}
        {registry.data.summary.connectionCount === 0 && <p className="text-sm text-muted-foreground">{projectAvailable ? "No saved connections. Explicitly attached files remain governed by this Chat's selected policy." : "Temporary Chat does not retain uploaded files or Project context."}</p>}
      </>}
      <button type="button" onClick={() => { setOpen(false); onOpenConnections(); }} className="mt-2 rounded border border-border px-2 py-1 text-xs">Manage sources in Connection Center</button>
      <button type="button" onClick={() => setOpen(false)} className="ml-2 px-2 py-1 text-xs">Close</button>
    </PopoverContent>
  </Popover>;
}
