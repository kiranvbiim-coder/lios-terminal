import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useProjectChats, useProjects } from "@/lib/useProjects";
import { buildTelegramConnectRequest, type TelegramConnectForm } from "@/lib/telegramConnectionForm";

interface TelegramConnectionSummary {
  connectionId: number;
  name: string;
  enabled: boolean;
  projectId: number;
  chatId: number;
  allowedConversationIds: string[];
  retentionDays: number;
  allowAiTransmission: boolean;
  consentActive: boolean;
  credentialPresent: boolean;
  nextOffset: number;
  polling: { state: string; consecutiveFailures: number; lastFailure: string | null; lastAdoptedAt: string | null } | null;
}

const QUERY_KEY = ["/api/setup/telegram-connections"];
const EMPTY: TelegramConnectForm = {
  name: "", botToken: "", projectId: null, chatId: null, conversationIds: "", retentionDays: "30",
  allowAiTransmission: false, consent: false,
};
const field = "mt-1 block min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

function state(connection: TelegramConnectionSummary): { label: string; tone: string } {
  if (!connection.enabled) return { label: "Disconnected", tone: "text-muted-foreground" };
  if (!connection.consentActive || !connection.credentialPresent) return { label: "Needs attention", tone: "text-amber-300" };
  switch (connection.polling?.state) {
    case "polling": return { label: "Connected — importing", tone: "text-emerald-400" };
    case "backoff": return { label: "Connected — retrying after a temporary problem", tone: "text-amber-300" };
    case "refused": return { label: "Stopped — authority or consent changed; reconnect to resume", tone: "text-rose-300" };
    case "provider_blocked": return { label: "Stopped — Telegram rejected the bot token or another process is polling it; reconnect with a valid token", tone: "text-rose-300" };
    case "exhausted": return { label: "Stopped after repeated failures; disconnect and reconnect to retry", tone: "text-rose-300" };
    case "stopped": return { label: "Stopped", tone: "text-amber-300" };
    default: return { label: "Connected — starting", tone: "text-emerald-400" };
  }
}

/**
 * Owner-scoped Telegram channel setup. The bot token is held only in component state for one submit, is sent once to the
 * server vault and is cleared immediately; nothing here proves provider delivery, only the saved, consented connection.
 */
export default function TelegramConnectionPanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<TelegramConnectForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const projects = useProjects("active");
  const chats = useProjectChats(form.projectId, "active");
  const connections = useQuery<{ connections: TelegramConnectionSummary[] }>({
    queryKey: QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/setup/telegram-connections")).json(),
    staleTime: 15_000,
  });
  const update = (patch: Partial<TelegramConnectForm>) => setForm(current => ({ ...current, ...patch }));

  const submit = async () => {
    const built = buildTelegramConnectRequest(form);
    if ("error" in built) { setNotice({ ok: false, text: built.error }); return; }
    setBusy(true);
    setNotice(null);
    try {
      await apiRequest("POST", "/api/setup/telegram-connections", built.request);
      setForm(EMPTY);
      setNotice({ ok: true, text: "Saved. Home starts importing allowed messages shortly; nothing is sent back to Telegram." });
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (error) {
      // The server returns a sanitized sentence only; the token is never echoed.
      setNotice({ ok: false, text: error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "The Telegram connection could not be saved." });
    } finally {
      setForm(current => ({ ...current, botToken: "" }));
      setBusy(false);
    }
  };

  const disconnect = async (id: number) => {
    setBusy(true);
    setNotice(null);
    try {
      await apiRequest("DELETE", `/api/setup/telegram-connections/${id}`);
      setConfirmId(null);
      setNotice({ ok: true, text: "Disconnected. Polling stopped, consent was revoked and the bot token was deleted. Imported messages stay in your Chat." });
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      setNotice({ ok: false, text: "The connection could not be disconnected. It remains listed; retry." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-border bg-[#070707] p-4 space-y-4" aria-label="Telegram channel" data-testid="telegram-connection">
      <div className="border-b border-border/60 pb-2">
        <h2 className="font-terminal text-[10px] uppercase tracking-widest text-foreground">Telegram</h2>
        <p className="mt-1 font-ui text-sm text-muted-foreground">
          Import messages from chats you allow into one of your Project Chats. Your bot token stays in the protected vault on this device.
        </p>
      </div>

      {connections.isError ? <p role="alert" className="text-sm text-amber-200">Saved Telegram connections could not be loaded; their status is unknown.</p>
        : connections.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading Telegram connections…</p>
        : (connections.data?.connections ?? []).map(connection => {
          const status = state(connection);
          return (
            <div key={connection.connectionId} className="rounded-md border border-border p-3" data-testid="telegram-connection-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-ui text-sm font-medium text-foreground">{connection.name}</p>
                  <p className={`font-ui text-sm ${status.tone}`}>{status.label}</p>
                </div>
                {connection.enabled && (confirmId === connection.connectionId
                  ? <span className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => void disconnect(connection.connectionId)} className="min-h-11 rounded-md border border-rose-500/50 px-3 font-ui text-sm text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">Confirm disconnect</button>
                    <button type="button" onClick={() => setConfirmId(null)} className="min-h-11 rounded-md border border-border px-3 font-ui text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Keep</button>
                  </span>
                  : <button type="button" onClick={() => setConfirmId(connection.connectionId)} className="min-h-11 rounded-md border border-border px-3 font-ui text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Disconnect</button>)}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 font-ui text-sm text-muted-foreground sm:grid-cols-2">
                <div><dt className="inline">Allowed chat IDs: </dt><dd className="inline text-foreground">{connection.allowedConversationIds.join(", ")}</dd></div>
                <div><dt className="inline">Retention: </dt><dd className="inline text-foreground">imported messages older than {connection.retentionDays} days are removed hourly</dd></div>
                <div><dt className="inline">AI can read imported text: </dt><dd className="inline text-foreground">{connection.allowAiTransmission ? "Yes" : "No"}</dd></div>
                <div><dt className="inline">Replies to Telegram: </dt><dd className="inline text-foreground">Off</dd></div>
              </dl>
              {connection.enabled && (!connection.consentActive || !connection.credentialPresent) && (
                <p role="alert" className="mt-2 text-sm text-amber-200">This connection is not importing: {connection.consentActive ? "its bot token is missing" : "its data-use consent was revoked"}. Disconnect and reconnect to repair it.</p>
              )}
            </div>
          );
        })}

      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }} aria-label="Connect a Telegram bot" autoComplete="off">
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Connection name</span>
          <input className={field} value={form.name} maxLength={100} onChange={event => update({ name: event.target.value })} /></label>
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Bot token (from @BotFather)</span>
          <input className={field} type="password" autoComplete="off" spellCheck={false} value={form.botToken} onChange={event => update({ botToken: event.target.value })} /></label>
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Project</span>
          <select className={field} value={form.projectId ?? ""} onChange={event => update({ projectId: event.target.value ? Number(event.target.value) : null, chatId: null })}>
            <option value="">Choose a Project…</option>
            {(projects.data ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Project Chat that receives messages</span>
          <select className={field} value={form.chatId ?? ""} disabled={form.projectId === null} onChange={event => update({ chatId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Choose a Chat…</option>
            {(chats.data ?? []).map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
          </select></label>
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Allowed Telegram chat IDs (comma separated)</span>
          <input className={field} inputMode="numeric" value={form.conversationIds} onChange={event => update({ conversationIds: event.target.value })} /></label>
        <label className="block"><span className="font-ui text-sm font-medium text-muted-foreground">Retention policy (days)</span>
          <input className={field} inputMode="numeric" value={form.retentionDays} onChange={event => update({ retentionDays: event.target.value })} /></label>
        <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-muted-foreground">
          <input type="checkbox" className="mt-1" checked={form.allowAiTransmission} onChange={event => update({ allowAiTransmission: event.target.checked })} />
          <span>Let LiOS include imported messages in AI model context (off by default; sends text to your AI provider).</span></label>
        <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={form.consent} onChange={event => update({ consent: event.target.checked })} />
          <span>I consent to LiOS importing messages from the chat IDs above into this Project Chat. Telegram’s bot terms apply to my bot and its data. LiOS will not reply or post to Telegram.</span></label>
        {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded border px-3 py-2 font-ui text-sm ${notice.ok ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-300"}`}>{notice.text}</p>}
        <button type="submit" disabled={busy} className="min-h-11 rounded-md border border-primary/60 bg-primary/10 px-4 font-ui text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">{busy ? "Saving…" : "Connect Telegram"}</button>
      </form>
    </section>
  );
}
