import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ChatExtensionCatalog } from "@shared/chatExtensionCatalog";

const GovernedExtensionsPanel = lazy(() => import("@/components/GovernedExtensionsPanel"));

/**
 * Contextual Chat surface; the Home owner's existing P13 installer and GM
 * governed MCP dispatch stay authoritative. Browsing never installs or
 * executes an extension.
 */
export default function ChatExtensionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [manage, setManage] = useState(false);
  const catalog = useQuery<ChatExtensionCatalog>({
    queryKey: ["/api/extensions/chat-catalog"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => (await apiRequest("GET", "/api/extensions/chat-catalog")).json(),
  });
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return {
      plugins: (catalog.data?.plugins ?? []).filter(p => !needle || p.name.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle)),
      mcp: (catalog.data?.mcpConnections ?? []).filter(m => !needle || m.name.toLowerCase().includes(needle)),
    };
  }, [catalog.data, query]);

  return <Dialog open={open} onOpenChange={next => { onOpenChange(next); if (!next) { setManage(false); setQuery(""); } }}>
    <DialogContent className="flex max-h-[min(88dvh,820px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-3 overflow-hidden border-border bg-background p-4">
      <DialogTitle>Plugins & tools</DialogTitle>
      <DialogDescription>
        Installed capabilities and your MCP connections. Tool execution still requires the appropriate LiOS approval.
      </DialogDescription>
      <label className="sr-only" htmlFor="lios-chat-extension-search">Search plugins and MCP connections</label>
      <input
        id="lios-chat-extension-search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Search tools…"
        className="min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-label="Chat plugin catalog">
        {catalog.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading installed capabilities…</p>}
        {catalog.isError && <div role="alert" className="text-sm">Plugin catalog unavailable. <button type="button" className="underline" onClick={() => void catalog.refetch()}>Retry</button></div>}
        {catalog.data && <>
          <section aria-label="Installed plugins">
            <h3 className="mb-2 text-sm font-semibold">Installed plugins</h3>
            {visible.plugins.length ? <ul className="space-y-1.5">{visible.plugins.map(plugin => <li key={plugin.id} className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <div className="min-w-0"><div className="truncate text-sm font-medium">{plugin.name}</div>
                <div className="text-xs text-muted-foreground">{plugin.skillCount} skills · {plugin.artifactCount} artifact types · v{plugin.version}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{plugin.trusted && plugin.registered ? "Registered" : "Not active"}</span>
            </li>)}</ul> : <p className="text-xs text-muted-foreground">No matching installed plugins.</p>}
            <p className="mt-2 text-xs text-muted-foreground">Registered plugins are not automatically callable in Chat; their skills and tools require explicit runtime integration and permissions.</p>
          </section>
          <section aria-label="MCP connections">
            <h3 className="mb-2 text-sm font-semibold">MCP connections</h3>
            {visible.mcp.length ? <ul className="space-y-1.5">{visible.mcp.map(mcp => <li key={mcp.id} className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <span className="truncate text-sm font-medium">{mcp.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{mcp.status === "healthy" ? "Verified" : "Needs verification"}</span>
            </li>)}</ul> : <p className="text-xs text-muted-foreground">No matching MCP connections.</p>}
            <p className="mt-2 text-xs text-muted-foreground">MCP tool calls remain Project-scoped and require an exact user-approved operation. Connection status does not grant execution permission.</p>
          </section>
        </>}
        {manage && <section aria-label="Owner plugin management" className="border-t border-border pt-3">
          <Suspense fallback={<p role="status" className="text-sm">Loading package management…</p>}>
            <GovernedExtensionsPanel />
          </Suspense>
        </section>}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
        {catalog.data?.managementAvailable ? <button type="button" className="min-h-10 rounded-md border border-border px-3 text-sm" onClick={() => setManage(current => !current)}>
          {manage ? "Hide management" : "Manage installed plugins"}
        </button> : <p className="text-xs text-muted-foreground">Installation is managed by the Home owner.</p>}
        <button type="button" className="min-h-10 rounded-md px-3 text-sm" onClick={() => { setManage(false); setQuery(""); onOpenChange(false); }}>Done</button>
      </div>
    </DialogContent>
  </Dialog>;
}
