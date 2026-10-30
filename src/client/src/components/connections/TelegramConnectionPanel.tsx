import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useProjectChats, useProjects } from "@/lib/useProjects";
import { buildTelegramConnectRequest, type TelegramConnectForm } from "@/lib/telegramConnectionForm";
import type { TelegramAutoRunPolicy } from "@shared/telegramConnection";

interface TelegramConnectionSummary {
  connectionId: number;
  name: string;
  enabled: boolean;
  projectId: number;
  chatId: number;
  allowedConversationIds: string[];
  retentionDays: number;
  allowAiTransmission: boolean;
  allowOutbound: boolean;
  autoRun: TelegramAutoRunPolicy | null;
  autoRunConsentActive: boolean;
  autoRunCounts: { claimedLastHour: number; claimedLastDay: number; unsettled: number };
  consentActive: boolean;
  credentialPresent: boolean;
  nextOffset: number;
  polling: { state: string; consecutiveFailures: number; lastFailure: string | null; lastAdoptedAt: string | null } | null;
}

const QUERY_KEY = ["/api/setup/telegram-connections"];
const EMPTY: TelegramConnectForm = {
  name: "", botToken: "", projectId: null, chatId: null, conversationIds: "", retentionDays: "30",
  allowAiTransmission: false, consent: false, allowOutbound: false, outboundConsent: false,
  autoRunEnabled: false, autoRunSenderRefs: "", autoRunMaxRunsPerHour: "2", autoRunMaxRunsPerDay: "10",
  autoRunMaxAiCalls: "2", autoRunMaxSteps: "4", autoRunMaxDurationSeconds: "60", autoRunConsent: false,
};
const field = "mt-1 block min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

function state(connection: TelegramConnectionSummary): { label: string; tone: string } {
  if (!connection.enabled) return { label: "Disconnected", tone: "text-muted-foreground" };
  if (!connection.consentActive || !connection.credentialPresent) return { label: "Needs attention", tone: "text-amber-300" };
  if (connection.polling?.lastFailure === "namespace_reconnect_required") return {
    label: "Stopped — the bot identity cannot safely reuse this message history. Disconnect and create a new named connection; existing imported messages remain.",
    tone: "text-rose-300",
  };
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
      setNotice({ ok: true, text: "Saved. Home imports allowed messages shortly. Incoming AI work runs only with its separate opt-in and limits. Sending still requires approval for the exact message in Chat." });
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      // Never display arbitrary transport/provider errors: they may contain submitted credential material.
      setNotice({ ok: false, text: "The Telegram connection could not be saved. Check the input and protected credential store, then retry." });
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
      setNotice({ ok: true, text: "Disconnected. Polling stopped, import, incoming execution and outbound consent were revoked, and the bot token was deleted. Imported messages stay in your Chat." });
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
                <div><dt className="inline">Replies to Telegram: </dt><dd className="inline text-foreground">{connection.allowOutbound ? "Exact message approval required in this Project Chat" : "Off"}</dd></div>
                <div><dt className="inline">Automatic incoming AI work: </dt><dd className="inline text-foreground">{connection.autoRun?.enabled ? (connection.enabled && connection.consentActive && connection.autoRunConsentActive && connection.credentialPresent ? "Opted in — current authority and limits still checked per message" : "Opted in, unavailable until current authority/consent is restored") : "Off (default)"}</dd></div>
                {connection.autoRun?.enabled && <>
                  <div><dt className="inline">Allowed actors: </dt><dd className="inline text-foreground">{connection.autoRun.allowedSenderRefs.join(", ")}</dd></div>
                  <div><dt className="inline">Incoming limits: </dt><dd className="inline text-foreground">{connection.autoRun.maxRunsPerHour}/rolling hour · {connection.autoRun.maxRunsPerDay}/rolling day · {connection.autoRun.maxAiCalls} AI calls · {connection.autoRun.maxSteps} steps · {connection.autoRun.maxDurationMs / 1_000}s/run</dd></div>
                  <div><dt className="inline">Admitted/claimed attempts: </dt><dd className="inline text-foreground">{connection.autoRunCounts.claimedLastHour} this rolling hour · {connection.autoRunCounts.claimedLastDay} this rolling day · {connection.autoRunCounts.unsettled} unsettled (may be interrupted; not proof of live AI or a result)</dd></div>
                </>}
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
        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 font-ui text-sm font-medium text-foreground">Automatic incoming AI work — off by default</legend>
          <p className="font-ui text-sm text-muted-foreground">Importing, AI execution and sending are separate permissions. Eligible new original messages from explicit actors can start bounded work in this Project Chat. This uses your configured AI provider and may incur provider usage charges; limits are not a currency quote. Consequential tools and external sends still need exact approval. Edits do not start new work; claimed or interrupted messages are not automatically replayed.</p>
          <p className="font-ui text-sm text-muted-foreground">Default limits if enabled: 2 runs per rolling hour, 10 per rolling day, 2 AI calls, 4 steps and 60 seconds per run. No actors are allowed until you explicitly enter them.</p>
          <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-muted-foreground">
            <input type="checkbox" className="mt-1" checked={form.autoRunEnabled} onChange={event => update({ autoRunEnabled: event.target.checked, autoRunConsent: false })} />
            <span>Enable automatic incoming AI work for this connection.</span></label>
          {form.autoRunEnabled && <>
            <label className="block"><span className="font-ui text-sm text-muted-foreground">Explicit allowed actors (comma separated: user:123 or chat:-456)</span>
              <input className={field} value={form.autoRunSenderRefs} maxLength={3_000} onChange={event => update({ autoRunSenderRefs: event.target.value })} /></label>
            <p className="font-ui text-sm text-muted-foreground">user: matches that sender; chat: matches a sending chat/channel identity, not every participant in that conversation. The message must also pass the connection’s allowed chat IDs.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block"><span className="font-ui text-sm text-muted-foreground">Runs per rolling hour (1–12)</span><input type="number" min={1} max={12} step={1} className={field} value={form.autoRunMaxRunsPerHour} onChange={event => update({ autoRunMaxRunsPerHour: event.target.value })} /></label>
              <label className="block"><span className="font-ui text-sm text-muted-foreground">Runs per rolling day (1–100)</span><input type="number" min={1} max={100} step={1} className={field} value={form.autoRunMaxRunsPerDay} onChange={event => update({ autoRunMaxRunsPerDay: event.target.value })} /></label>
              <label className="block"><span className="font-ui text-sm text-muted-foreground">AI calls per run (1–4)</span><input type="number" min={1} max={4} step={1} className={field} value={form.autoRunMaxAiCalls} onChange={event => update({ autoRunMaxAiCalls: event.target.value })} /></label>
              <label className="block"><span className="font-ui text-sm text-muted-foreground">Steps per run (1–8)</span><input type="number" min={1} max={8} step={1} className={field} value={form.autoRunMaxSteps} onChange={event => update({ autoRunMaxSteps: event.target.value })} /></label>
              <label className="block"><span className="font-ui text-sm text-muted-foreground">Duration per run, seconds (1–120)</span><input type="number" min={1} max={120} step={1} className={field} value={form.autoRunMaxDurationSeconds} onChange={event => update({ autoRunMaxDurationSeconds: event.target.value })} /></label>
            </div>
            <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-foreground">
              <input type="checkbox" className="mt-1" checked={form.autoRunConsent} onChange={event => update({ autoRunConsent: event.target.checked })} />
              <span>I separately consent to incoming AI execution for these actors under these limits, including sending eligible text to my configured AI provider and its usage charges. This does not consent to automatic replies, external sends or consequential tools. Disconnecting revokes incoming execution permission.</span></label>
          </>}
        </fieldset>
        <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-muted-foreground">
          <input type="checkbox" className="mt-1" checked={form.allowOutbound} onChange={event => update({ allowOutbound: event.target.checked, outboundConsent: false })} />
          <span>Allow reviewed text messages to these Telegram chat IDs from this Project Chat. Each exact recipient, text and reply/topic still requires approval; no automatic responses.</span></label>
        {form.allowOutbound && <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={form.outboundConsent} onChange={event => update({ outboundConsent: event.target.checked })} />
          <span>I have permission to contact these recipients and share the reviewed text. I consent to explicit approved sending under Telegram’s terms, and to sharing these connection names/target IDs with my permitted AI provider when planning channel actions. Disconnecting revokes this permission; it cannot recall a message already accepted by Telegram.</span></label>}
        <label className="flex min-h-11 items-start gap-2 font-ui text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={form.consent} onChange={event => update({ consent: event.target.checked })} />
          <span>I consent to LiOS importing messages from the chat IDs above into this Project Chat. Telegram’s bot terms apply to my bot and its data. Import permission alone never authorizes sending.</span></label>
        {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded border px-3 py-2 font-ui text-sm ${notice.ok ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-300"}`}>{notice.text}</p>}
        <button type="submit" disabled={busy} className="min-h-11 rounded-md border border-primary/60 bg-primary/10 px-4 font-ui text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">{busy ? "Saving…" : "Connect Telegram"}</button>
      </form>
    </section>
  );
}
