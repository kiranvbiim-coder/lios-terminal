import { GatewayProvider } from "@/lib/gateway/GatewayProvider";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Router, Switch, Route } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { P9DesktopNotificationBridge } from "@/components/terminal/P9DesktopNotificationBridge";
import Terminal from "./pages/Terminal";
import PublicProductPreview from "./pages/PublicProductPreview";
import DomainPicker from "./pages/DomainPicker";
import ForcedChangePassword from "./pages/ForcedChangePassword";

import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import NotFound from "./pages/not-found";
import { LAST_DOMAIN_STORAGE_KEY, FALLBACK_FINANCE_DOMAIN, pickDefaultDomain, type DomainInfo, type DomainSlug } from "@/lib/domains";
import { setAudienceFromRole, useAudience } from "@/lib/audience";
import { clearTerminalTabs } from "@/lib/terminalTabs";
import { clearTerminalLinkedContextState } from "@/lib/terminalLinkedContextStore";
import { clearActiveWorkspace } from "@/lib/terminalWorkspace";
import { clearSessionMemory, setSessionMemoryOwner } from "@/lib/terminalSessionMemory";
import {
  clearNotificationReadOutbox,
  replayNotificationReads,
  setNotificationReadOutboxOwner,
} from "@/lib/p9NotificationReadOutbox";
import { clearP9ManualRunDrafts, setP9ManualRunDraftOwner } from "@/lib/p9ManualRunDrafts";
import { clearP9ManualRunAttempts, setP9ManualRunAttemptOwner } from "@/lib/p9ManualRunAttemptLedger";
import { setP9DesktopNotificationOwner } from "@/lib/p9DesktopNotifications";
import { clearResearchTray } from "@/lib/terminalResearchTray";
import { clearTerminalPersonalization } from "@/lib/terminalPersonalization";
import { restoreSession, signOutSession } from "./lib/sessionLifecycle";
import { subscribeOpenEnvironmentCenter, subscribeOpenPluginCenter } from "@/lib/appShellEvents";
import type { AuthSessionState, EffectiveAccessSnapshot } from "@shared/identityContracts";

// Chat-first: connection and plugin management must not inflate the initial Chat bundle.
const DataConnectionCenter = lazy(() => import("./pages/DataConnectionCenter"));
const GovernedExtensionsPanel = lazy(() => import("@/components/GovernedExtensionsPanel"));

export interface SessionData {
  email: string;
  role: string;
  name: string;
  mustChangePassword: boolean;
  lifecycleStage?: "trial" | "client" | "churned" | null;
  licenseStatus?: string | null;
  licenseReason?: string | null;
  licenseGraceEndsAt?: string | null;
  offline?: boolean;
  authState?: AuthSessionState;
  access?: EffectiveAccessSnapshot | null;
}

function AppRouter({
  session, onLogout, domain, onSwitchDomain, onOpenEnvironment,
}: {
  session: SessionData;
  onLogout: () => void;
  domain: DomainSlug;
  onSwitchDomain: () => void;
  onOpenEnvironment: () => void;
}) {
  const terminal = <Terminal session={session} onLogout={onLogout} onOpenEnvironment={onOpenEnvironment} domain={domain} onSwitchDomain={onSwitchDomain} />;
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/">{terminal}</Route>
        <Route path="">{terminal}</Route>
        {/* LiOS addresses (shared/liosAddress.ts): the Terminal reads the selection from the hash itself. */}
        <Route path="/p/*">{terminal}</Route>
        <Route path="/c/*">{terminal}</Route>
        <Route component={NotFound} />
      </Switch>
    </Router>
  );
}

function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutPending = useRef(false);
  const [activeDomain, setActiveDomain] = useState<DomainInfo | null>(null);
  const [managementView, setManagementView] = useState<"connections" | "plugins" | null>(null);
  // The workspace stays mounted while Connections is open. Capture the actual
  // initiating control (not a route string) and restore it after the overlay
  // unmounts, so the user's Chat draft and keyboard context survive.
  const environmentReturnFocus = useRef<HTMLElement | null>(null);
  const [domainPickerOpen, setDomainPickerOpen] = useState(false);
  const audience = useAudience();

  const acceptSession = (data: SessionData | null) => {
    // The server-restored principal, not editable browser storage or display
    // email, determines which recent analytical history is visible.
    setSessionMemoryOwner(data?.authState ?? null);
    setNotificationReadOutboxOwner(data?.authState ?? null);
    setP9ManualRunDraftOwner(data?.authState ?? null);
    setP9ManualRunAttemptOwner(data?.authState ?? null);
    setP9DesktopNotificationOwner(data?.authState ?? null);
    setAudienceFromRole(data ? String(data.role) : null);
    setSession(data);
    if (data) setActiveDomain((current) => current ?? FALLBACK_FINANCE_DOMAIN);
    return true;
  };

  useEffect(() => {
    const controller = new AbortController();
    setCheckingSession(true);
    setSessionError(null);
    restoreSession<SessionData>("/api/auth/me", { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) acceptSession(data); })
      .catch(() => {
        if (!controller.signal.aborted) setSessionError("LiOS couldn't restore your session. Check your connection and retry.");
      })
      .finally(() => { if (!controller.signal.aborted) setCheckingSession(false); });
    return () => controller.abort();
  }, [restoreAttempt]);

  useEffect(() => {
    if (!session) return;
    let storedSlug: string | null = null;
    try { storedSlug = localStorage.getItem(LAST_DOMAIN_STORAGE_KEY); } catch { /* Use the default when device storage is unavailable. */ }
    fetch(audience === "client" ? "/api/client/dashboard/domains" : "/api/admin/domains")
      .then((res) => (res.ok ? res.json() : []))
      .then((domains: DomainInfo[]) => {
        const match = pickDefaultDomain(Array.isArray(domains) ? domains : [], storedSlug);
        if (match) {
          try { localStorage.setItem(LAST_DOMAIN_STORAGE_KEY, match.slug); } catch { /* The active domain still works in memory. */ }
          setActiveDomain(match);
          return;
        }
        setActiveDomain(FALLBACK_FINANCE_DOMAIN);
      })
      .catch(() => setActiveDomain(FALLBACK_FINANCE_DOMAIN));

    if (audience === "client" && session.lifecycleStage === "trial") {
      fetch("/api/client/trial/status").catch(() => {});
    }
  }, [session]);

  // Replay only the safe notification-read receipts. Each reconnect obtains a
  // fresh server session and the P9 endpoint rechecks ownership before update.
  useEffect(() => {
    if (!session || session.authState?.state !== "authenticated_online") return;
    const flush = () => {
      void replayNotificationReads().then((result) => {
        if (result.confirmed > 0) {
          void queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
        }
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [session?.authState?.principal?.userId, session?.authState?.principal?.organizationId, session?.authState?.state]);

  const captureManagementOpener = useCallback(() => {
    const active = document.activeElement;
    environmentReturnFocus.current = active instanceof HTMLElement && active.closest("[data-lios-workspace]") ? active : null;
  }, []);
  const openEnvironmentSetup = useCallback(() => {
    if (!managementView) captureManagementOpener();
    setManagementView("connections");
  }, [managementView, captureManagementOpener]);
  const openPluginSetup = useCallback(() => {
    if (!managementView) captureManagementOpener();
    setManagementView("plugins");
  }, [managementView, captureManagementOpener]);

  useEffect(() => subscribeOpenEnvironmentCenter(openEnvironmentSetup), [openEnvironmentSetup]);
  useEffect(() => subscribeOpenPluginCenter(openPluginSetup), [openPluginSetup]);
  useEffect(() => {
    if (managementView || domainPickerOpen || !session) return;
    const opener = environmentReturnFocus.current;
    if (!opener) return;
    environmentReturnFocus.current = null;
    if (opener.isConnected && !opener.matches(":disabled,[aria-disabled=true]") && !opener.closest("[hidden]")) {
      opener.focus();
    } else {
      document.querySelector<HTMLElement>('[data-lios-workspace] button:not(:disabled)')?.focus();
    }
  }, [managementView, domainPickerOpen, session]);

  const handleLogout = async () => {
    if (signOutPending.current) return;
    signOutPending.current = true;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOutSession("/api/auth/logout");
    } catch {
      setSignOutError("Sign-out wasn't confirmed. Retry before leaving this device.");
      signOutPending.current = false;
      setSigningOut(false);
      return;
    }
    // Server acknowledgement ends this session even if optional device storage is unavailable.
    setSession(null);
    setAudienceFromRole(null);
    setActiveDomain(null);
    setDomainPickerOpen(false);
    setManagementView(null);
    environmentReturnFocus.current = null;
    try {
      queryClient.clear();
      for (const clear of [clearTerminalTabs, clearTerminalLinkedContextState, clearActiveWorkspace, clearSessionMemory, clearNotificationReadOutbox, clearP9ManualRunDrafts, clearP9ManualRunAttempts, clearResearchTray, clearTerminalPersonalization]) {
        try { clear(); } catch { /* Continue clearing the remaining account-scoped state. */ }
      }
      try { localStorage.removeItem(LAST_DOMAIN_STORAGE_KEY); } catch { /* Storage can be disabled. */ }
    } finally {
      // Cleanup is attempted while the prior verified principal is still
      // selected; always disarm the memory owner after server sign-out.
      setSessionMemoryOwner(null);
      setNotificationReadOutboxOwner(null);
      setP9ManualRunDraftOwner(null);
      setP9ManualRunAttemptOwner(null);
      setP9DesktopNotificationOwner(null);
      signOutPending.current = false;
      setSigningOut(false);
    }
  };

  const handleChooseDomain = (domain: DomainInfo) => {
    try { localStorage.setItem(LAST_DOMAIN_STORAGE_KEY, domain.slug); } catch { /* Keep the selection in memory. */ }
    setActiveDomain(domain);
    setDomainPickerOpen(false);
  };

  if (checkingSession) {
    return (
      <div className="dark min-h-screen bg-[#030303] flex items-center justify-center">
        <span role="status" className="font-terminal text-[10px] tracking-widest text-muted-foreground animate-pulse">
          OPENING LIOS...
        </span>
      </div>
    );
  }

  if (sessionError) {
    return (
      <main className="dark min-h-screen bg-[#030303] flex items-center justify-center p-6 text-foreground">
        <section className="w-full max-w-md rounded-xl border border-border bg-background p-6">
          <h1 className="font-ui text-lg font-semibold">Your work is waiting</h1>
          <p role="alert" className="mt-3 font-ui text-sm text-muted-foreground">{sessionError}</p>
          <button type="button" onClick={() => setRestoreAttempt((attempt) => attempt + 1)} className="mt-5 rounded border border-primary/40 px-4 py-2 text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Retry opening LiOS</button>
        </section>
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <P9DesktopNotificationBridge enabled={Boolean(
        session && !session.mustChangePassword
        && session.authState?.state === "authenticated_online"
        && typeof window !== "undefined" && (window as any).limuriaDesktop?.isElectron
      )} />
      <GatewayProvider enabled={!!session && !session.mustChangePassword}>
      <div className="dark min-h-screen bg-[#030303]">
        {session && session.mustChangePassword ? (
          <ForcedChangePassword email={session.email} onDone={() => setSession({ ...session, mustChangePassword: false })} />
        ) : session ? (
          <>
            {/* Preserve the conversation, staged inputs and workspace while contextual setup is open. */}
            <div data-lios-workspace hidden={domainPickerOpen}>
              <AppRouter
                session={session}
                onLogout={handleLogout}
                domain={(activeDomain ?? FALLBACK_FINANCE_DOMAIN).slug as DomainSlug}
                onSwitchDomain={() => { setManagementView(null); setDomainPickerOpen(true); }}
                onOpenEnvironment={openEnvironmentSetup}
              />
            </div>
            {/* Workspace remains visible and mounted behind a modal drawer, never replaced by setup. */}
            <Sheet open={managementView !== null && !domainPickerOpen} onOpenChange={(open) => { if (!open) setManagementView(null); }}>
              <SheetContent
                side="right"
                data-testid="chat-management-drawer"
                className="flex h-[100dvh] w-[min(100vw,72rem)] max-w-none flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 sm:max-w-none"
                onCloseAutoFocus={(event) => { event.preventDefault(); }}
              >
                <div className="shrink-0 border-b border-border px-4 py-4 pr-14 sm:px-6">
                  <SheetTitle>{managementView === "plugins" ? "Plugins" : "Connections"}</SheetTitle>
                  <SheetDescription className="sr-only">
                    {managementView === "plugins" ? "Manage governed LiOS extensions without leaving the conversation." : "Manage data and AI connections without leaving the conversation."}
                  </SheetDescription>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="chat-management-content">
                  <Suspense fallback={<div role="status" className="p-6 font-ui text-sm text-muted-foreground">Opening {managementView === "plugins" ? "Plugins" : "Connections"}…</div>}>
                    {managementView === "connections" && session && <DataConnectionCenter embedded session={session} onComplete={() => setManagementView(null)} onLogout={handleLogout} />}
                    {managementView === "plugins" && <div className="mx-auto w-full max-w-5xl p-4 sm:p-6"><GovernedExtensionsPanel /></div>}
                  </Suspense>
                </div>
              </SheetContent>
            </Sheet>
            {session && domainPickerOpen && managementView === null && (
              <DomainPicker session={session} onChoose={handleChooseDomain} onCancel={() => setDomainPickerOpen(false)} onLogout={handleLogout} />
            )}
          </>
        ) : (
          <PublicProductPreview onLoginSuccess={(nextSession) => { acceptSession(nextSession); }} />
        )}
        {signingOut && <div role="status" className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 font-ui text-sm text-foreground">Signing out…</div>}
        {signOutError && (
          <div role="alert" className="fixed inset-x-4 bottom-4 z-[1000] mx-auto max-w-xl rounded-xl border border-border bg-background p-4 text-foreground shadow-xl">
            <p className="font-ui text-sm">{signOutError}</p>
            <div className="mt-3 flex gap-4 text-sm">
              <button type="button" onClick={() => void handleLogout()} className="text-primary">Retry sign-out</button>
              <button type="button" onClick={() => setSignOutError(null)} className="text-muted-foreground">Stay in LiOS</button>
            </div>
          </div>
        )}
        <Toaster />
      </div>
      </GatewayProvider>
    </QueryClientProvider>
  );
}

export default App;
