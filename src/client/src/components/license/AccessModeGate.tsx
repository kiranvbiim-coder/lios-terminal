import * as React from "react";
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { serverErrorText } from "@/lib/apiErrorText";
import { LICENSE_ACCESS_KEY, needsFirstRunChoice, readOnlyBannerText, useLicenseAccess, type LicenseAccess } from "@/lib/licenseAccess";
import { useAiConnectionGate } from "@/lib/aiConnection";
import { useMarketDataStepGate } from "@/lib/marketDataStep";
import LicenseKeyEntry from "./LicenseKeyEntry";
import ConnectAiStep from "./ConnectAiStep";
import MarketDataStep from "./MarketDataStep";

/** First run after enrollment: start the trial; only the Home owner may also import a license key. */
export function FirstRunLicenseChoice({ canImportLicense = true }: { canImportLicense?: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const startTrial = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/license/trial/start")).json(),
    onSuccess: async () => { setError(null); await queryClient.invalidateQueries({ queryKey: LICENSE_ACCESS_KEY }); },
    onError: (failure) => setError(serverErrorText(failure)),
  });

  return (
    <main className="min-h-screen w-screen bg-[#030303] flex items-center justify-center p-4 text-foreground" data-testid="first-run-license-choice">
      <section className="w-full max-w-md space-y-4 border border-border bg-[#070707] p-6 font-terminal" aria-labelledby="first-run-license-title">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[hsl(38,95%,55%)]" aria-hidden="true" />
          <h1 id="first-run-license-title" className="text-sm font-bold uppercase tracking-widest">Get started with LiOS</h1>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {canImportLicense
            ? "Your account is ready. Try everything free for 7 days, or enter a license key if you already have one."
            : "Your account is ready. Start your organization's free 7-day trial. License keys are managed by this Home's owner."}
          {" "}Your work stays in your Home and you can export it at any time.
        </p>
        <button
          type="button"
          disabled={startTrial.isPending}
          onClick={() => startTrial.mutate()}
          className="w-full border border-[hsl(38,95%,50%)]/60 px-3 py-2 text-[10px] uppercase tracking-wider hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {startTrial.isPending ? "Starting trial…" : "Start 7-day trial"}
        </button>
        {error && <p role="alert" className="text-[9px] text-rose-300">{error}</p>}
        {canImportLicense && (showKey ? (
          <LicenseKeyEntry />
        ) : (
          <button
            type="button"
            onClick={() => setShowKey(true)}
            className="w-full border border-border px-3 py-2 text-[10px] uppercase tracking-wider hover:border-[hsl(38,95%,50%)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Enter license key
          </button>
        ))}
      </section>
    </main>
  );
}

/** Persistent notice while new work is refused; the same key entry opens from it (owner only). */
export function ReadOnlyBanner({ access }: { access: LicenseAccess }) {
  const [open, setOpen] = useState(false);
  const text = readOnlyBannerText(access);
  if (!text) return null;
  return (
    <>
      <div
        role="status"
        data-testid="read-only-banner"
        className="fixed inset-x-4 bottom-4 z-[900] mx-auto flex max-w-2xl flex-wrap items-center gap-3 border border-[hsl(38,95%,50%)]/50 bg-[#0b0b0b] p-3 font-terminal text-[10px] text-foreground shadow-xl"
      >
        <Lock className="h-3.5 w-3.5 shrink-0 text-[hsl(38,95%,55%)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {text} You can still open and export your work.
          {!access.isOwner && " Ask the owner of this installation to enter a license key."}
        </span>
        {access.isOwner && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="border border-[hsl(38,95%,50%)]/60 px-3 py-1 uppercase tracking-wider hover:bg-[hsl(38,95%,50%)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Enter license key
          </button>
        )}
      </div>
      {access.isOwner && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="dark max-w-md border-border bg-[#070707] text-foreground">
            <DialogHeader>
              <DialogTitle className="font-terminal text-sm uppercase tracking-widest">Enter license key</DialogTitle>
              <DialogDescription className="font-terminal text-[10px] text-muted-foreground">
                Paste the key you received. New work resumes as soon as it is accepted.
              </DialogDescription>
            </DialogHeader>
            <LicenseKeyEntry onActivated={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function StartupCheck({ text }: { text: string }) {
  return (
    <main className="flex min-h-screen w-screen items-center justify-center bg-[#030303] p-4 text-foreground" data-testid="startup-check">
      <p role="status" className="flex items-center gap-2 font-ui text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {text}
      </p>
    </main>
  );
}

/**
 * First-run order: license choice, then Connect your AI, then the workspace. Once the workspace has
 * opened in this session it is never torn down for AI changes; Chat asks to reconnect inline instead.
 */
export default function AccessModeGate({ enabled, onLogout, children }: { enabled: boolean; onLogout: () => void | Promise<void>; children: ReactNode }) {
  const license = useLicenseAccess(enabled);
  const access = license.data;
  const ai = useAiConnectionGate(access?.mode === "full");
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  // Once the Connect step has been shown, verifying saves the provider (gate becomes "reconnect");
  // only the user's Continue, which also turns AI on for Chat, may close it.
  const [connectStarted, setConnectStarted] = useState(false);
  if (ai.gate === "connect" && !connectStarted && !workspaceOpened) setConnectStarted(true);
  const firstRunChoice = needsFirstRunChoice(access);
  const aiSettled = !firstRunChoice && (ai.gate === "ready" || (ai.gate === "reconnect" && !connectStarted) || (ai.gate === "not_required" && !(enabled && license.isPending)));
  // After AI, ask once for a market-data source. A person who defers is not asked again.
  const market = useMarketDataStepGate(access?.mode === "full" && aiSettled && !workspaceOpened);
  const [marketDone, setMarketDone] = useState(false);
  const marketSettled = marketDone || market.gate === "skip";
  if (aiSettled && marketSettled && !workspaceOpened) setWorkspaceOpened(true);

  if (access && firstRunChoice) return <FirstRunLicenseChoice canImportLicense={access.isOwner} />;
  if (!workspaceOpened && !aiSettled) {
    if (connectStarted || ai.gate === "connect") return <ConnectAiStep setup={ai.setup} onConnected={() => setConnectStarted(false)} onLogout={onLogout} />;
    return <StartupCheck text={ai.gate === "checking" ? "Checking your AI connection…" : "Getting LiOS ready…"} />;
  }
  if (!workspaceOpened && aiSettled) {
    if (market.gate === "show") return <MarketDataStep setup={market.setup} userId={market.userId} onDone={() => setMarketDone(true)} />;
    return <StartupCheck text="Getting LiOS ready…" />;
  }
  return (
    <>
      {children}
      {access && <ReadOnlyBanner access={access} />}
    </>
  );
}
