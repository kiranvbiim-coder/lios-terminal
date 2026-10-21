import * as React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SourceRegistry } from "@shared/sourceRegistry";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import { apiRequest } from "@/lib/queryClient";
import { P1_SOURCE_SCOPES } from "@/lib/p1Shell";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  scope: ConversationSourceScope;
  onScopeChange: (scope: ConversationSourceScope) => void;
  onOpenConnections: () => void;
  disabled?: boolean;
  projectAvailable: boolean;
}

/** A view over Connection Center's catalogue, never a separate source authority. */
export default function ChatSourcesControl({ scope, onScopeChange, onOpenConnections, disabled = false, projectAvailable }: Props) {
  const [open, setOpen] = useState(false);
  const registry = useQuery<SourceRegistry>({
    queryKey: ["/api/setup/source-registry"],
    queryFn: async () => (await apiRequest("GET", "/api/setup/source-registry")).json(),
    enabled: open,
    staleTime: 30_000,
  });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} aria-controls="chat-source-catalogue" className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Sources · {P1_SOURCE_SCOPES.find(item => item.id === scope)?.label}</button></PopoverTrigger>
    <PopoverContent side="top" align="start" id="chat-source-catalogue" aria-label="Chat sources" className="z-[100] max-h-96 w-80 max-w-[85vw] overflow-auto rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
      <fieldset disabled={disabled} className="space-y-2"><legend className="mb-2 font-medium">Source scope</legend>
        {P1_SOURCE_SCOPES.map(item => <label key={item.id} className="block"><input type="radio" name="chat-source-scope" value={item.id} checked={scope === item.id} disabled={!projectAvailable && (item.id === "my_data" || item.id === "files")} onChange={() => onScopeChange(item.id)} className="mr-2" />{item.label}<span className="block pl-5 text-xs text-muted-foreground">{item.description}</span></label>)}
      </fieldset>
      <p className="my-3 text-xs text-muted-foreground">Connection state is not permission to send data to AI, export it, or use it outside its licence. Current account and source restrictions still apply.</p>
      {registry.isLoading && <p role="status">Loading your source catalogue…</p>}
      {registry.isError && <p role="alert">Source catalogue unavailable. <button type="button" className="underline" onClick={() => void registry.refetch()}>Retry</button></p>}
      {registry.data && <><h3 className="font-medium">Connected sources</h3><ul className="my-2 space-y-2">{registry.data.groups.flatMap(group => group.items).filter(item => item.connected).map(item => <li key={item.id}><span>{item.name}</span><span className="ml-2 text-xs text-muted-foreground">{item.state.replaceAll("_", " ")}</span><p className="text-xs text-muted-foreground">{item.detail}</p>{item.licenseCaveat && <p className="text-xs text-amber-200">{item.licenseCaveat}</p>}</li>)}</ul>{registry.data.summary.connectionCount === 0 && <p className="text-xs text-muted-foreground">No sources connected. Supplied inputs remain usable; missing evidence stays explicit.</p>}</>}
      <button type="button" onClick={() => { setOpen(false); onOpenConnections(); }} className="mt-2 rounded border border-border px-2 py-1 text-xs">Manage sources in Connection Center</button>
      <button type="button" onClick={() => setOpen(false)} className="ml-2 px-2 py-1 text-xs">Close</button>
    </PopoverContent>
  </Popover>;
}
