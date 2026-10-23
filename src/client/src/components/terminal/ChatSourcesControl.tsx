import * as React from "react";
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SourceRegistry } from "@shared/sourceRegistry";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import { apiRequest } from "@/lib/queryClient";
import { P1_SOURCE_SCOPES } from "@/lib/p1Shell";
import { filterSourceCatalogue } from "@/lib/filterSourceCatalogue";
import { SourceCatalogueSearch } from "./SourceCatalogueSearch";

interface Props {
  scope: ConversationSourceScope;
  onScopeChange: (scope: ConversationSourceScope) => void;
  onOpenConnections: () => void;
  disabled?: boolean;
  projectAvailable: boolean; // true for regular Quick and Project Chat; false for Temporary
}

/** A searchable *view* of the P1 source catalogue. It never grants source rights. */
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
  return <div className="relative">
    <button type="button" disabled={disabled} aria-expanded={open} aria-controls={catalogueId} onClick={() => setOpen(value => !value)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}</button>
    {open && <section id={catalogueId} aria-label="Chat sources" className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(85vh,32rem)] w-96 max-w-[90vw] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
      <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 font-medium">Source scope</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block"><input type="radio" name="chat-source-scope" value={item.id} checked={scope === item.id} disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")} onChange={() => onScopeChange(item.id)} className="mr-2"/>{item.label}<span className="block pl-5 text-xs text-muted-foreground">{item.description}</span></label>)}
      </fieldset>
      <p className="my-3 text-xs text-muted-foreground">Connection state is not permission to send data to AI, export it, or use it outside its licence. Current account and source restrictions still apply.</p>
      <div className="space-y-2 border-t border-border/60 pt-3">
        <h3 className="font-ui text-sm font-medium">Source catalogue</h3>
        <SourceCatalogueSearch value={search} disabled={disabled} onChange={setSearch} onClear={() => setSearch("")} placeholder="Search registered sources…" hint="Search by source name, data type, group or status."/>
        <label className="flex items-center gap-2 font-ui text-xs text-muted-foreground"><input type="checkbox" disabled={disabled} checked={connectedOnly} onChange={event => setConnectedOnly(event.target.checked)}/>Connected only</label>
      </div>
      {registry.isLoading && <p role="status" className="mt-3 text-xs">Loading your source catalogue…</p>}
      {registry.isError && <p role="alert" className="mt-3 text-xs">Source catalogue unavailable. <button type="button" className="underline" onClick={() => void registry.refetch()}>Retry</button></p>}
      {registry.data && <div className="mt-3">
        <p role="status" aria-live="polite" className="mb-2 text-xs text-muted-foreground">{matches.length} matching registered source{matches.length === 1 ? "" : "s"}</p>
        {matches.length ? <ul className="space-y-2" aria-label="Matching sources">{matches.map(item => <li key={item.id} className="rounded-md border border-border/60 p-2">
          <div className="flex items-start justify-between gap-2"><span className="font-ui text-sm font-medium">{item.name}</span><span className="shrink-0 font-ui text-xs text-muted-foreground">{item.connected ? (item.operational ? "Connected" : "Connected · check status") : "Not connected"}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          <p className="mt-1 text-xs text-muted-foreground">Status: {item.state.replaceAll("_", " ")}</p>
          {item.licenseCaveat && <p className="mt-1 text-xs text-amber-200">{item.licenseCaveat}</p>}
        </li>)}</ul> : <p role="status" className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">{search.trim() ? "No matching sources. Clear the search or manage connections." : connectedOnly ? "No connected sources. Manage connections to add one." : "No sources in the registered catalogue."}</p>}
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        <button type="button" onClick={() => { setOpen(false); onOpenConnections(); }} className="rounded border border-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Manage sources</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-border px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Close</button>
      </div>
    </section>}
  </div>;
}
