import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ChatExtensionCatalog } from "@shared/chatExtensionCatalog";
import ChatMcpConnectForm from "./ChatMcpConnectForm";
import { canInspectMcpInChat } from "@/lib/chatMcpProjectEligibility";

const GovernedExtensionsPanel = lazy(() => import("@/components/GovernedExtensionsPanel"));

/**
 * Contextual Chat surface; the Home owner's existing P13 installer and GM
 * governed MCP dispatch stay authoritative. Browsing never installs or
 * executes an extension.
 */
export default function ChatExtensionsDialog({
  open,
  onOpenChange,
  projectAvailable,
  projectId,
  onStagePrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectAvailable: boolean;
  projectId: number | null;
  onStagePrompt: (prompt: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [manage, setManage] = useState(false);
  const [connectMcp, setConnectMcp] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verificationNotice, setVerificationNotice] = useState("");
  const queryClient = useQueryClient();
  const catalog = useQuery<ChatExtensionCatalog>({
    queryKey: ["/api/extensions/chat-catalog"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => (await apiRequest("GET", "/api/extensions/chat-catalog")).json(),
  });
  async function verifyMcp(connectionId: number) {
    if (verifyingId !== null) return;
    setVerifyingId(connectionId); setVerificationNotice("");
    try {
      const response = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId });
      const result = await response.json() as { status: string; detail: string };
      setVerificationNotice(result.status === "healthy"
        ? "Live MCP connection verified. No remote tools were executed."
        : "MCP verification did not succeed. Check its endpoint or saved credential.");
      await queryClient.invalidateQueries({ queryKey: ["/api/extensions/chat-catalog"] });
    } catch {
      setVerificationNotice("Unable to verify this MCP connection. No healthy result was recorded.");
    } finally {
      setVerifyingId(null);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return {
      plugins: (catalog.data?.plugins ?? []).filter(p => !needle || p.name.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle)),
      mcp: (catalog.data?.mcpConnections ?? []).filter(m => !needle || m.name.toLowerCase().includes(needle)),
    };
  }, [catalog.data, query]);

  return <Dialog open={open} onOpenChange={next => { onOpenChange(next); if (!next) { setManage(false); setConnectMcp(false); setQuery(""); } }}>
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
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">MCP connections</h3>
              {projectAvailable && projectId && <button type="button" className="min-h-9 rounded-md border border-border px-2 text-xs" onClick={() => setConnectMcp(value => !value)}>
                {connectMcp ? "Hide setup" : "Connect MCP"}
              </button>}
            </div>
            {connectMcp && projectAvailable && projectId && <ChatMcpConnectForm projectId={projectId} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["/api/extensions/chat-catalog"] }); }} onCancel={() => setConnectMcp(false)} />}
            {verificationNotice && <p role="status" className="mb-2 text-xs">{verificationNotice}</p>}
            {visible.mcp.length ? <ul className="space-y-1.5">{visible.mcp.map(mcp => <li key={mcp.id} className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
              <span className="truncate text-sm font-medium">{mcp.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{mcp.status === "healthy" ? "Verified" : "Needs verification"}</span>
              {projectAvailable && canInspectMcpInChat(projectId, mcp) && <button type="button" disabled={verifyingId !== null} className="shrink-0 rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50" onClick={() => void verifyMcp(mcp.id)}>{verifyingId === mcp.id ? "Verifying…" : "Verify"}</button>}
              {projectAvailable && projectId !== mcp.projectId && <span className="shrink-0 text-xs text-muted-foreground">Another Project</span>}
              {projectAvailable && canInspectMcpInChat(projectId, mcp) && <button
                type="button"
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs"
                onClick={() => {
                  onStagePrompt(`Show the locally allowed tool IDs for my MCP connection ${mcp.id}. Do not call the remote server.`);
                  setManage(false);
                  setConnectMcp(false);
                  setQuery("");
                  onOpenChange(false);
                }}
              >Inspect in Chat</button>}
            </li>)}</ul> : <p className="text-xs text-muted-foreground">No matching MCP connections.</p>}
            <p className="mt-2 text-xs text-muted-foreground">MCP tool calls remain Project-scoped and require an exact user-approved operation. Connection status does not grant execution permission.</p>
          </section>
        </>}
        {manage && <section aria-label="Owner plugin management" className="border-t border-border pt-3">
          <Suspense fallback={<p role="status" className="text-sm">Loading package management…</p>}>
            <GovernedExtensionsPanel onCatalogChanged={() => { void queryClient.invalidateQueries({ queryKey: ["/api/extensions/chat-catalog"] }); }} />
          </Suspense>
        </section>}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
        {catalog.data?.managementAvailable ? <button type="button" className="min-h-10 rounded-md border border-border px-3 text-sm" onClick={() => setManage(current => !current)}>
          {manage ? "Hide management" : "Manage installed plugins"}
        </button> : <p className="text-xs text-muted-foreground">Installation is managed by the Home owner.</p>}
        <button type="button" className="min-h-10 rounded-md px-3 text-sm" onClick={() => { setManage(false); setConnectMcp(false); setQuery(""); onOpenChange(false); }}>Done</button>
      </div>
    </DialogContent>
  </Dialog>;
}
