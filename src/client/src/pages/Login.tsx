import { useEffect, useId, useState } from "react";
import { Shield, KeyRound, AlertTriangle, Lock, UserPlus, Building2, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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

// A licence-blocked organisation gets a 403 from /api/auth/login whose
// `reason` names the state that blocks login outright. Distinguishing them
// matters -- "grace period expired" and "your account was suspended" call
// for a different next step than a generic "access denied".
// "license_billing_hold" never reaches here (it does not block login, only
// feature access -- see LicenseStatusBanner.tsx, which handles that state
// post-login instead).
function licenseBlockedMessage(reason: string | undefined): string | null {
  switch (reason) {
    case "license_grace_expired":
      return "Your organization's billing grace period has ended. Contact your account administrator to restore access.";
    case "license_suspended":
      return "This organization's access has been suspended. Contact your account administrator.";
    case "license_security_locked":
      return "This organization's access has been locked for security reasons. Contact your account administrator.";
    case "license_terminated":
      return "This organization's license has been terminated. Contact your account administrator.";
    default:
      return null;
  }
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
  const [progressVal, setProgressVal] = useState(0);
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

  const simulateHandshake = (targetText: string, delay: number): Promise<void> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        setStatusText((prev) => [...prev, targetText]);
        resolve();
      }, delay);
    });
  };

  const handleLogin = async () => {
    if (!email || !email.includes("@")) {
      setErrorMsg("A valid email address is required.");
      return;
    }
    if (!password) {
      setErrorMsg("Password is required.");
      return;
    }

    setErrorMsg("");
    setLoading(true);
    setProgressVal(10);
    setStatusText(["Connecting securely…"]);

    try {
      await simulateHandshake("Preparing secure sign-in…", 300);
      setProgressVal(30);

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      setProgressVal(60);
      await simulateHandshake("Verifying your credentials…", 400);

      const data = await response.json();
      setProgressVal(90);

      if (!response.ok) {
        await simulateHandshake("Sign-in could not be completed.", 300);
        setErrorMsg(licenseBlockedMessage(data.reason) ?? data.error ?? "System access denied.");
        setLoading(false);
        return;
      }

      await simulateHandshake("Restoring your LiOS workspace…", 400);
      setProgressVal(100);

      // The login response omits lifecycleStage and licence facts; App.tsx
      // needs the full session shape, so read it from /api/auth/me.
      const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const session: SessionData = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error("Your session could not be verified.");

      setTimeout(() => {
        onLoginSuccess(session);
      }, 500);

    } catch (err) {
      setErrorMsg("LiOS could not reach the secure sign-in service. Check your connection and try again.");
      setLoading(false);
    }
  };


  const handleEnterpriseSso = async () => {
    if (!email || !email.includes("@")) {
      setErrorMsg("Enter your work email before starting enterprise SSO.");
      return;
    }

    setErrorMsg("");
    setLoading(true);
    setProgressVal(15);
    setStatusText(["Finding your organization sign-in…"]);

    try {
      const startResponse = await fetch("/api/client/auth/sso/device/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const authorization = await startResponse.json() as {
        requestId?: string;
        verifier?: string;
        verificationUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!startResponse.ok || !authorization.requestId || !authorization.verifier || !authorization.verificationUrl || !authorization.expiresAt) {
        throw new Error(authorization.error ?? "Enterprise SSO is not available for this work email.");
      }

      setProgressVal(35);
      setStatusText((prev) => [...prev, "Opening your organization identity provider…"]);
      await openExternalUrl(authorization.verificationUrl);

      const expiresAt = Date.parse(authorization.expiresAt);
      if (!Number.isFinite(expiresAt)) throw new Error("Enterprise SSO authorization expiry is invalid.");
      setProgressVal(55);
      setStatusText((prev) => [...prev, "Waiting for secure browser approval…"]);

      while (Date.now() < expiresAt) {
        await delay(1_500);
        const pollResponse = await fetch("/api/client/auth/sso/device/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: authorization.requestId, verifier: authorization.verifier }),
        });
        const poll = await pollResponse.json() as { status?: string; error?: string };
        if (pollResponse.status === 202 && poll.status === "pending") continue;
        if (!pollResponse.ok || poll.status !== "authenticated") {
          throw new Error(poll.error ?? "Enterprise SSO authorization could not be completed.");
        }

        setProgressVal(90);
        setStatusText((prev) => [...prev, "Approval received. Restoring your LiOS workspace…"]);
        const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
        const sessionData = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(sessionData.error ?? "Enterprise session could not be verified.");
        setProgressVal(100);
        setStatusText((prev) => [...prev, "Organization sign-in complete."]);
        onLoginSuccess(sessionData as SessionData);
        return;
      }
      throw new Error("Enterprise SSO authorization expired. Start the sign-in again.");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Enterprise SSO could not be completed.");
      setLoading(false);
      setProgressVal(0);
    }
  };


  const handleRegister = async () => {
    if (name.trim().length < 2) {
      setErrorMsg("Your name is required.");
      return;
    }
    if (!email || !email.includes("@")) {
      setErrorMsg("A valid email address is required.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("Choose a stronger password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setErrorMsg("");
    setLoading(true);
    setProgressVal(15);
    setStatusText(["Creating your LiOS account…"]);

    try {
      await simulateHandshake("Creating your secure workspace…", 250);
      setProgressVal(45);
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: name.trim(),
          ...(organizationName.trim() ? { organizationName: organizationName.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMsg(data.error ?? "Trial account could not be created.");
        setLoading(false);
        return;
      }

      setProgressVal(75);
      await simulateHandshake("Activating your 7-day Pro trial…", 300);
      const sessionResponse = await fetch("/api/auth/me", { cache: "no-store" });
      const sessionData = await sessionResponse.json();
      if (!sessionResponse.ok) throw new Error(sessionData.error ?? "Trial session could not be verified.");

      setProgressVal(100);
      await simulateHandshake("Your trial is ready. Opening LiOS…", 250);
      onLoginSuccess(sessionData as SessionData);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "LiOS control plane is currently unreachable.");
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
                {clientMode === "register" ? "Start 7-Day Pro Trial" : "Sign In"}
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
                {clientMode === "signin" ? "New to LiOS? Start your 7-day Pro trial" : "Already have LiOS? Sign in"}
              </button>

              <div className="text-xs leading-5 text-muted-foreground text-center space-y-1 mt-4">
                <p>• Your 7-day Pro trial is controlled by the secure LiOS service, not your device clock.</p>
                <p>• Your connected data and BYOAI credentials remain on this desktop.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5 py-4">
              <Progress value={progressVal} className="h-1 bg-muted rounded-full [&>div]:bg-primary" />

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
                Protecting your session and restoring your workspace…
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

