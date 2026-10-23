import { useEffect, useId, useState } from "react";
import { Shield, KeyRound, AlertTriangle, Lock, UserPlus, Building2, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authEntryErrorMessage, authEntryFetch, safeSsoVerificationUrl, verifiedEntrySession } from "@/lib/authEntryState";
import type { SessionData } from "@/App";
import FirstRunAdminSetup from "./FirstRunAdminSetup";
import ReferenceBrand from "@/components/terminal/ReferenceBrand";
import "@/reference-entry.css";

interface LoginProps {
  onLoginSuccess: (session: SessionData) => void;
  initialMode?: "signin" | "register";
}

async function openExternalUrl(url: string): Promise<void> {
  const desktop = (window as Window & {
    limuriaDesktop?: { openExternal?: (url: string) => Promise<unknown> };
  }).limuriaDesktop;
  if (desktop?.openExternal) {
    await desktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function Login({ onLoginSuccess, initialMode = "signin" }: LoginProps) {
  const formId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clientMode, setClientMode] = useState<"signin" | "register">(initialMode);
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const authPending = useRef(false);
  const [bootstrapStatus, setBootstrapStatus] = useState<{
    setupRequired: boolean;
    setupAllowed: boolean;
    mode: "server_token" | "create" | "rotate_legacy" | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/bootstrap/status", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("bootstrap status unavailable");
        return response.json() as Promise<{ setupRequired?: boolean; setupAllowed?: boolean; mode?: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setBootstrapStatus({
            setupRequired: data.setupRequired === true,
            setupAllowed: data.setupAllowed === true,
            mode: data.mode === "server_token" || data.mode === "create" || data.mode === "rotate_legacy" ? data.mode : null,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBootstrapStatus({ setupRequired: false, setupAllowed: false, mode: null });
          setErrorMsg("Unable to verify first-run administrator status. Restart LiOS if this is a new installation.");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleLogin = async () => {
    if (authPending.current) return;
    if (!email || !email.includes("@")) {
      setErrorMsg("A valid email address is required.");
      return;
    }
    if (!password) {
      setErrorMsg("Password is required.");
      return;
    }
    authPending.current = true;
    setErrorMsg("");
    setLoading(true);
    setStatusText(["Contacting the secure sign-in service…"]);
    try {
      const response = await authEntryFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { reason?: unknown } | null;
        setErrorMsg(authEntryErrorMessage("signin", response.status, body?.reason));
        return;
      }
      setStatusText(["Credentials accepted. Verifying your saved session…"]);
      const session = await verifiedEntrySession<SessionData>();
      onLoginSuccess(session);
    } catch {
      setErrorMsg("LiOS could not verify your sign-in. Check your connection and retry.");
    } finally {
      authPending.current = false;
      setLoading(false);
    }
  };

  const handleEnterpriseSso = async () => {
    if (authPending.current) return;
    if (!email || !email.includes("@")) {
      setErrorMsg("Enter your work email before starting enterprise SSO.");
      return;
    }
    authPending.current = true;
    setErrorMsg("");
    setLoading(true);
    setStatusText(["Requesting organization sign-in approval…"]);
    try {
      const startResponse = await authEntryFetch("/api/client/auth/sso/device/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const authorization = await startResponse.json().catch(() => null) as {
        requestId?: string;
        verifier?: string;
        verificationUrl?: string;
        expiresAt?: string;
        reason?: string;
      } | null;
      if (!startResponse.ok) {
        setErrorMsg(authEntryErrorMessage("sso", startResponse.status, authorization?.reason));
        return;
      }
      const verificationUrl = safeSsoVerificationUrl(authorization?.verificationUrl);
      if (!authorization?.requestId || !authorization.verifier || !verificationUrl || !authorization.expiresAt) {
        setErrorMsg("Organization SSO could not provide a valid approval request. Try again.");
        return;
      }
      setStatusText(["Opening your organization's secure approval page…"]);
      await openExternalUrl(verificationUrl);
      const expiresAt = Date.parse(authorization.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        setErrorMsg("Organization approval expired. Start sign-in again.");
        return;
      }
      setStatusText(["Waiting for approval in the organization sign-in page…"]);
      while (Date.now() < expiresAt) {
        await delay(1_500);
        const pollResponse = await authEntryFetch("/api/client/auth/sso/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: authorization.requestId, verifier: authorization.verifier }),
        });
        const poll = await pollResponse.json().catch(() => null) as { status?: string; reason?: string } | null;
        if (pollResponse.status === 202 && poll?.status === "pending") continue;
        if (!pollResponse.ok) {
          setErrorMsg(authEntryErrorMessage("sso", pollResponse.status, poll?.reason));
          return;
        }
        if (poll?.status !== "authenticated") {
          setErrorMsg("Your organization did not confirm the approval. Start sign-in again.");
          return;
        }
        setStatusText(["Organization approval confirmed. Verifying your session…"]);
        const session = await verifiedEntrySession<SessionData>();
        onLoginSuccess(session);
        return;
      }
      setErrorMsg("Organization sign-in approval expired. Start sign-in again.");
    } catch {
      setErrorMsg("LiOS could not complete organization SSO. Check your connection and retry.");
    } finally {
      authPending.current = false;
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (authPending.current) return;
    if (name.trim().length < 2) { setErrorMsg("Your name is required."); return; }
    if (!email || !email.includes("@")) { setErrorMsg("A valid email address is required."); return; }
    if (password.length < 8) { setErrorMsg("Choose a stronger password with at least 8 characters."); return; }
    if (password !== confirmPassword) { setErrorMsg("Passwords do not match."); return; }
    authPending.current = true;
    setErrorMsg("");
    setLoading(true);
    setStatusText(["Requesting an account from the LiOS service…"]);
    try {
      const response = await authEntryFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim(),
          ...(organizationName.trim() ? { organizationName: organizationName.trim() } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { reason?: unknown } | null;
        setErrorMsg(authEntryErrorMessage("register", response.status, body?.reason));
        return;
      }
      setStatusText(["Account request accepted. Verifying your session…"]);
      const session = await verifiedEntrySession<SessionData>();
      onLoginSuccess(session);
    } catch {
      setErrorMsg("LiOS could not verify your new account session. Check your connection and retry.");
    } finally {
      authPending.current = false;
      setLoading(false);
    }
  };

  if (bootstrapStatus === null) {
    return (
      <div className="min-h-screen w-screen bg-[#030303] flex items-center justify-center">
        <span className="font-terminal text-[10px] tracking-widest text-muted-foreground animate-pulse">
          VERIFYING FIRST-RUN SECURITY...
        </span>
      </div>
    );
  }

  if (bootstrapStatus?.setupRequired) {
    return <div className="lios-reference-entry lios-reference-login"><FirstRunAdminSetup onComplete={onLoginSuccess} requiresToken={bootstrapStatus.mode === "server_token"} /></div>;
  }

  return (
    <div className="lios-reference-login relative isolate min-h-screen w-screen overflow-hidden flex items-center justify-center p-4">

      <Card className="lios-reference-login-card relative z-10 w-full max-w-md overflow-hidden text-foreground font-ui">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-300/75 to-transparent" />

        <CardHeader className="text-center pt-9 pb-5">
          <div className="flex justify-center"><ReferenceBrand /></div>
          <div className="mt-2 font-terminal text-[7px] uppercase tracking-[0.28em] text-white/35">Discover · Decode · Decide · Deliver</div>
          <CardTitle className="mt-7 font-display text-2xl font-semibold tracking-[-0.035em] text-white">
            {clientMode === "register" ? "Create your workspace" : "Welcome back"}
          </CardTitle>
          <CardDescription className="mx-auto mt-2 max-w-xs font-ui text-sm normal-case leading-5 tracking-normal text-muted-foreground">
            {clientMode === "register"
              ? "Create your LiOS account. Your plan and executable capabilities are resolved securely after sign-in."
              : "Sign in and continue directly where your work left off."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {!loading ? (
            <div className="space-y-4">
              {clientMode === "register" && (
                <>
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-name`} className="font-ui text-xs font-medium text-muted-foreground block">Your Name</label>
                    <div className="relative">
                      <Input
                        type="text"
                        id={`${formId}-name`}
                        autoComplete="name"
                        placeholder="Your full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-[#0d0d0d] border-border text-sm focus-visible:ring-2 focus-visible:ring-[hsl(38,95%,50%)] font-ui placeholder-muted-foreground text-foreground rounded-md pl-9 h-11"
                      />
                      <User className="w-3.5 h-3.5 absolute left-3 top-[15px] text-muted-foreground" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor={`${formId}-organization`} className="font-ui text-xs font-medium text-muted-foreground block">Organization <span className="normal-case text-muted-foreground/60">(optional)</span></label>
                    <div className="relative">
                      <Input
                        type="text"
                        id={`${formId}-organization`}
                        autoComplete="organization"
                        placeholder="Company or workspace name"
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        className="w-full bg-[#0d0d0d] border-border text-sm focus-visible:ring-2 focus-visible:ring-[hsl(38,95%,50%)] font-ui placeholder-muted-foreground text-foreground rounded-md pl-9 h-11"
                      />
                      <Building2 className="w-3.5 h-3.5 absolute left-3 top-[15px] text-muted-foreground" />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label htmlFor={`${formId}-email`} className="font-ui text-xs font-medium text-muted-foreground block">
                  Email
                </label>
                <div className="relative">
                  <Input
                    type="email"
                    id={`${formId}-email`}
                    autoComplete="email"
                    placeholder="name@limuria.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#0d0d0d] border-border text-sm focus-visible:ring-2 focus-visible:ring-[hsl(38,95%,50%)] font-ui placeholder-muted-foreground text-foreground rounded-md pl-9 h-11"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (clientMode === "register") void handleRegister();
                        else void handleLogin();
                      }
                    }}
                  />
                  <Shield className="w-3.5 h-3.5 absolute left-3 top-[15px] text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor={`${formId}-password`} className="font-ui text-xs font-medium text-muted-foreground block">
                  Password
                </label>
                <div className="relative">
                  <Input
                    type="password"
                    placeholder="••••••••"
                    id={`${formId}-password`}
                    autoComplete={clientMode === "register" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0d0d0d] border-border text-sm focus-visible:ring-2 focus-visible:ring-[hsl(38,95%,50%)] font-ui placeholder-muted-foreground text-foreground rounded-md pl-9 h-11"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (clientMode === "register") void handleRegister();
                        else void handleLogin();
                      }
                    }}
                  />
                  <Lock className="w-3.5 h-3.5 absolute left-3 top-[15px] text-muted-foreground" />
                </div>
              </div>

              {clientMode === "register" && (
                <div className="space-y-2">
                  <label htmlFor={`${formId}-confirm`} className="font-ui text-xs font-medium text-muted-foreground block">Confirm Password</label>
                  <div className="relative">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      id={`${formId}-confirm`}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-[#0d0d0d] border-border text-sm focus-visible:ring-2 focus-visible:ring-[hsl(38,95%,50%)] font-ui placeholder-muted-foreground text-foreground rounded-md pl-9 h-11"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRegister();
                      }}
                    />
                    <Lock className="w-3.5 h-3.5 absolute left-3 top-[15px] text-muted-foreground" />
                  </div>
                </div>
              )}

              {errorMsg && (
                <div id={`${formId}-error`} role="alert" className="p-3 bg-red-950/20 border border-red-900/60 text-red-300 text-sm font-ui flex gap-2 items-start leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
                  <div>
                    <span className="block font-ui font-semibold normal-case tracking-normal">Sign-in couldn’t continue</span>
                    <span className="mt-1 block font-ui font-normal normal-case tracking-normal">{errorMsg}</span>
                  </div>
                </div>
              )}

              <button
                onClick={clientMode === "register" ? handleRegister : handleLogin}
                className="w-full flex min-h-11 items-center justify-center gap-1.5 bg-primary hover:bg-primary/90 text-black text-sm font-semibold rounded-md transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {clientMode === "register" ? <UserPlus className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                {clientMode === "register" ? "Start free trial" : "Sign In"}
              </button>

              {clientMode === "signin" && (
                <button
                  type="button"
                  onClick={() => void handleEnterpriseSso()}
                  className="w-full min-h-11 rounded-md border border-[hsl(38,95%,50%)/35%] px-2 text-sm font-medium text-[hsl(38,95%,60%)] hover:text-[hsl(38,95%,70%)] hover:border-[hsl(38,95%,50%)/65%] transition-colors flex items-center justify-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Sign in with organization SSO
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setClientMode((mode) => mode === "signin" ? "register" : "signin");
                  setErrorMsg("");
                }}
                className="w-full min-h-11 rounded-md border border-border px-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/40%] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {clientMode === "signin" ? "New to LiOS? Start your trial" : "Already have LiOS? Sign in"}
              </button>

              <div className="text-xs leading-5 text-muted-foreground text-center space-y-1 mt-4">
                <p>• Your plan and trial eligibility are controlled by the secure LiOS service, not your device clock.</p>
                <p>• Your connected data and BYOAI credentials remain on this desktop.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 py-4">
              <div role="status" aria-live="polite" className="text-sm text-amber-200">Verifying your request with LiOS…</div>

              <div className="min-h-28 rounded-lg border border-white/[0.07] bg-black/20 p-4">
                <div className="font-terminal text-[7px] uppercase tracking-[0.18em] text-amber-200/70">Secure sign-in</div>
                <div className="mt-3 space-y-2">
                  {statusText.slice(-3).map((text, idx) => (
                    <div key={idx} className="flex items-start gap-2 font-ui text-[10px] leading-5 text-muted-foreground">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber-300/65" />
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-center font-ui text-[10px] text-amber-200/80">
                Your session opens only after LiOS verifies your account.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

