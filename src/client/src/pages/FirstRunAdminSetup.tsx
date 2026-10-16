import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Lock, Mail, ShieldCheck, User, UserPlus } from "lucide-react";
import ReferenceBrand from "@/components/terminal/ReferenceBrand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { checkPasswordPolicy } from "@shared/passwordPolicy";
import type { SessionData } from "@/App";
import { restoreSession } from "@/lib/sessionLifecycle";

interface FirstRunAdminSetupProps {
  onComplete: (session: SessionData) => void;
  requiresToken: boolean;
}

export default function FirstRunAdminSetup({ onComplete, requiresToken }: FirstRunAdminSetupProps) {
  const [setupToken, setSetupToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const policy = useMemo(
    () => checkPasswordPolicy(password, { email: email.trim(), name: name.trim() }),
    [password, email, name],
  );

  const handleCreate = async () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (requiresToken && !setupToken.trim()) {
      setErrorMsg("Enter the one-time token shown on your LiOS Home server or in its private data root.");
      return;
    }
    if (cleanName.length < 2) {
      setErrorMsg("Enter the administrator's full name.");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMsg("Enter a valid administrator email address.");
      return;
    }
    if (!policy.valid) {
      setErrorMsg(policy.errors.join(" "));
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    try {
      const response = await fetch("/api/auth/bootstrap/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName, email: cleanEmail, password, ...(requiresToken ? { setupToken: setupToken.trim() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMsg(data.error ?? "Administrator setup could not be completed.");
        return;
      }

      const session = await restoreSession<SessionData>("/api/auth/me");
      if (!session?.authState?.principal) {
        setErrorMsg("Administrator created, but its session could not be verified. Sign in again.");
        return;
      }
      onComplete(session);
    } catch {
      setErrorMsg("The local LiOS server could not complete administrator setup.");
    } finally {
      setLoading(false);
    }
  };

  const strengthLabel = password.length === 0
    ? "Enter a password"
    : policy.valid
      ? policy.score >= 4 ? "Strong" : "Policy compliant"
      : "Does not meet policy";

  return (
    <div className="lios-reference-login min-h-screen w-screen flex items-center justify-center p-4">

      <Card className="lios-reference-login-card w-full max-w-md bg-[#070707] border-border text-foreground font-ui relative overflow-hidden shadow-[0_0_20px_rgba(38,38,38,0.15)]">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary" />
        <CardHeader className="text-center pt-8 pb-4">
          <div className="flex justify-center mb-4"><ReferenceBrand /></div>
          <CardTitle className="font-display text-2xl font-bold text-foreground">
            Secure First-Run Setup
          </CardTitle>
          <CardDescription className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1.5">
            Create the administrator for this LiOS installation
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="p-3 border border-border bg-[#0b0b0b] text-[9px] leading-relaxed text-muted-foreground">
            {requiresToken
              ? "The first owner of this user-operated LiOS Home must enter the one-time token from the server console or its private owner-setup.token file. Use HTTPS, or connect directly on the server’s loopback address."
              : "No default administrator password is shipped with LiOS. This one-time screen is available only on the local desktop installation and closes after the first administrator is created."}
          </div>
          {requiresToken && (
            <Field label="One-time Home Setup Token" icon={<Lock className="w-3.5 h-3.5" />}>
              <Input
                type="password"
                autoComplete="off"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                placeholder="Paste the token from your LiOS Home server"
                className="w-full bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
              />
            </Field>
          )}
          <Field label="Administrator Name" icon={<User className="w-3.5 h-3.5" />}>
            <Input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Full name"
              className="w-full bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
            />
          </Field>

          <Field label="Administrator Email" icon={<Mail className="w-3.5 h-3.5" />}>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="w-full bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
            />
          </Field>

          <Field label="Password" icon={<Lock className="w-3.5 h-3.5" />}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="12+ characters"
              className="w-full bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
            />
          </Field>

          <div className="text-[8.5px] text-muted-foreground -mt-2">
            {strengthLabel}. Use at least 12 characters and at least 3 of lowercase, uppercase, number, and symbol.
          </div>

          <Field label="Confirm Password" icon={<Lock className="w-3.5 h-3.5" />}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !loading) void handleCreate(); }}
              placeholder="Repeat password"
              className="w-full bg-[#0d0d0d] border-border text-xs rounded-none pl-9 h-9"
            />
          </Field>

          {errorMsg && (
            <div className="p-3 bg-red-950/20 border border-red-900/60 text-red-500 text-[10px] font-bold flex gap-2 items-start leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 h-9 bg-primary hover:bg-primary/90 disabled:opacity-50 text-black text-[10px] font-bold uppercase tracking-wider transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {loading ? "Creating Secure Administrator..." : "Create Administrator"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] text-muted-foreground uppercase tracking-widest block">{label}</label>
      <div className="relative">
        {children}
        <span className="absolute left-3 top-3 text-muted-foreground">{icon}</span>
      </div>
    </div>
  );
}

