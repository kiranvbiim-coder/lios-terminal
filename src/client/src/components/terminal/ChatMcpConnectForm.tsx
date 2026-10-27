import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/queryClient";

/** Chat-only presentation over the canonical Source Connection and MCP v2 Verify routes.
 * No second credential vault, trust store, tool executor or remote plugin host. */
export default function ChatMcpConnectForm({
  projectId,
  onSaved,
  onCancel,
}: {
  projectId: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [toolIds, setToolIds] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setStatus(""); setBusy(true);
    let savedId: number | null = null;
    let createdCredentialRef: string | null = null;
    let credentialWritten = false;
    try {
      const label = name.trim();
      const url = endpoint.trim();
      const allowlist = [...new Set(toolIds.split(",").map(t => t.trim()).filter(Boolean))];
      if (!label || label.length > 200) throw new Error("Enter a connection name, up to 200 characters.");
      if (!url || url.length > 2_000) throw new Error("Enter the MCP endpoint URL.");
      if (!allowlist.length || allowlist.some(id => id.length > 200)) {
        throw new Error("Enter the tool IDs you wish to allow, separated by commas.");
      }
      if (bearerToken.length > 10_000) throw new Error("Bearer token exceeds the vault input limit.");
      if (bearerToken.trim()) {
        // Unique opaque ref, never derived from a user label or endpoint. The
        // existing authenticated setup endpoint owns encryption and custody.
        createdCredentialRef = `mcp_${crypto.randomUUID().replaceAll("-", "")}`;
        await apiRequest("PUT", `/api/setup/credentials/${createdCredentialRef}`, {
          value: bearerToken.trim(), label: `MCP: ${label}`,
        });
        credentialWritten = true;
        setBearerToken("");
      }
      // Server independently checks current owner, endpoint/network policy,
      // explicit approval and exact Project. This form never runs MCP tools.
      const response = await apiRequest("PUT", "/api/setup/source-connections", {
        connectorId: "custom_mcp",
        name: label,
        sourceType: "mcp",
        config: {
          endpoint: url,
          projectId,
          allowedToolIds: allowlist.join(","),
          requireApprovalForTools: true,
        },
        credentialRef: createdCredentialRef,
      });
      const saved = await response.json() as { connection: { id: number } };
      savedId = saved.connection.id;
      onSaved();
      setStatus("Saved. Checking the MCP server…");
      const check = await apiRequest("POST", "/api/setup/source-connections/test", { connectionId: savedId });
      const checked = await check.json() as { status: string; detail: string };
      onSaved();
      setStatus(checked.status === "healthy"
        ? "Verified through live MCP initialize and tools/list. No MCP tool was executed."
        : "Saved but not verified. Review the endpoint and connection credentials.");
    } catch (cause) {
      // If the source wasn't confirmed saved, an orphaned vault entry should
      // not linger. A lost source-save response is also possible: verify the
      // connection and reenter credentials if the cleanup invalidated them.
      if (createdCredentialRef !== null && credentialWritten && savedId === null) {
        try {
          await apiRequest("DELETE", `/api/setup/credentials/${createdCredentialRef}`);
        } catch {
          setStatus("Connection save failed and the new credential could not be cleaned up. Review it in Connections.");
        }
      }
      if (savedId !== null) {
        onSaved();
        setStatus("Connection saved, but verification could not finish. It is not confirmed healthy.");
      }
      setError(cause instanceof Error ? cause.message : "Unable to save this MCP connection.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={event => void save(event)} aria-label="Connect MCP in Chat" className="space-y-3 rounded-md border border-border p-3">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">Connect MCP server</h3>
      <button type="button" disabled={busy} className="text-xs text-muted-foreground underline" onClick={onCancel}>Cancel</button>
    </div>
    <label className="block text-xs">
      Connection name
      <input value={name} onChange={event => setName(event.target.value)} required maxLength={200} autoComplete="off" placeholder="Research MCP" className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
    </label>
    <label className="block text-xs">
      Server URL
      <input value={endpoint} onChange={event => setEndpoint(event.target.value)} type="url" required maxLength={2_000} autoComplete="off" placeholder="https://example.com/mcp" className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
    </label>
    <label className="block text-xs">
      Bearer token (optional)
      <input
        type="password"
        value={bearerToken}
        onChange={event => setBearerToken(event.target.value)}
        maxLength={10_000}
        autoComplete="new-password"
        placeholder="Stored encrypted in your LiOS vault"
        className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
      />
    </label>
    <label className="block text-xs">
      Allowed tool IDs
      <input value={toolIds} onChange={event => setToolIds(event.target.value)} required autoComplete="off" placeholder="search.documents, read.record" className="mt-1 min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm" />
    </label>
    <p className="text-xs text-muted-foreground">Only for this Project. Verification contacts the saved MCP endpoint but does not call tools. Every later tool action needs its own approval. An optional bearer token is saved to the existing encrypted vault, not the connection record. OAuth and advanced authentication remain outside this first slice.</p>
    {status && <p role="status" className="text-xs">{status}</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <button type="submit" disabled={busy} className="min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50">
      {busy ? "Saving and verifying…" : "Save & verify"}
    </button>
  </form>;
}
