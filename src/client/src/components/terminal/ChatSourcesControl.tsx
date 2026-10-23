import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SourceRegistry } from "@shared/sourceRegistry";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import { apiRequest } from "@/lib/queryClient";
import { P1_SOURCE_SCOPES } from "@/lib/p1Shell";
import { sourceAvailability, SOURCE_AVAILABILITY_COPY } from "@/lib/composerAvailability";

interface Props {
  scope: ConversationSourceScope;
  onScopeChange: (scope: ConversationSourceScope) => void;
  onOpenConnections: () => void;
  disabled?: boolean;
  projectAvailable: boolean; // regular Quick or Project Chat; false for Temporary
}

/** Source Registry is a read-only status view, not an authorization or connection mechanism. */
export default function ChatSourcesControl({ scope, onScopeChange, onOpenConnections, disabled = false, projectAvailable }: Props) {
  const [open, setOpen] = useState(false);
  const registry = useQuery<SourceRegistry>({
    queryKey: ["/api/setup/source-registry"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-registry")).json(),
    enabled: open,
    staleTime: 30_000,
  });
  return <div className="relative">
    <button type="button" disabled={disabled} aria-expanded={open} aria-controls="chat-source-catalogue"
      onClick={() => setOpen(value => !value)}
      className="min-h-10 rounded px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
    >Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}</button>
    {open && <section id="chat-source-catalogue" aria-label="Chat sources"
      className="absolute bottom-full left-0 z-30 mb-2 max-h-[min(24rem,70dvh)] w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
      <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 font-medium">Source scope for next request</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block">
          <input type="radio" name="chat-source-scope" value={item.id} checked={scope === item.id}
            disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")}
            onChange={() => onScopeChange(item.id)} className="mr-2" />
          {item.label}<span className="block pl-5 text-xs text-muted-foreground">{item.description}</span>
        </label>)}
      </fieldset>
      <p className="my-3 text-xs text-muted-foreground">Connection state is not permission to send data to AI, export it, or use it outside its licence. Choosing a scope does not grant access or start retrieval. Provider pricing and quotas are not exposed here; review terms before using a paid source.</p>
      {registry.isLoading && !registry.data && <p role="status">Checking source availability…</p>}
      {registry.isError && <p role="alert" className="text-amber-200">
        Source catalogue unavailable or stale. Cached connections do not prove current availability.
        <button type="button" className="ml-2 min-h-10 rounded underline focus-visible:outline focus-visible:outline-2" onClick={() => void registry.refetch()}>Retry status</button>
      </p>}
      {registry.data && <>
        <h3 className="font-medium">Connected sources · {registry.data.summary.operationalCount} operational / {registry.data.summary.connectionCount} configured</h3>
        <ul className="my-2 space-y-3">{registry.data.groups.flatMap(group => group.items).filter(item => item.connected).map(item => {
          const availability = sourceAvailability(item);
          return <li key={item.id} className="rounded-md border border-border/60 p-2">
            <span className="font-medium">{item.name}</span>
            <p data-source-availability={availability} className={availability === "needs_attention" ? "text-xs text-amber-200" : "text-xs text-muted-foreground"}>
              {SOURCE_AVAILABILITY_COPY[availability]}
            </p>
            <p className="text-xs text-muted-foreground">{item.detail}</p>
            {item.lastCheckedAt && <p className="text-xs text-muted-foreground">Last checked: <time dateTime={item.lastCheckedAt}>{item.lastCheckedAt}</time></p>}
            {item.licenseCaveat && <p className="text-xs text-amber-200">Licence restriction: {item.licenseCaveat}</p>}
          </li>;
        })}</ul>
        {registry.data.summary.connectionCount === 0 && <p className="text-xs text-muted-foreground">No sources connected. Explicit Chat attachments remain subject to source policy; missing evidence stays explicit.</p>}
      </>}
      <button type="button" onClick={() => { setOpen(false); onOpenConnections(); }}
        className="mt-2 min-h-10 rounded border border-border px-3 py-2 focus-visible:outline focus-visible:outline-2">Manage sources in Connection Center</button>
      <button type="button" onClick={() => setOpen(false)}
        className="ml-2 min-h-10 px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2">Close</button>
    </section>}
  </div>;
}
