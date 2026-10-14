import { useState } from "react";
import { Lock, KeyRound, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH } from "@shared/passwordPolicy";

interface Props {
  /** Called after the password is successfully changed on the server. */
  onSuccess: () => void;
  /** Omit to render without a cancel option (the forced first-login flow). */
  onCancel?: () => void;
}

const STRENGTH_LABEL = ["Very weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["bg-red-600", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-green-500"];

export default function ChangePasswordForm({ onSuccess, onCancel }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const policy = checkPasswordPolicy(newPassword);
  const showMeter = newPassword.length > 0;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const canSubmit = currentPassword.length > 0 && policy.valid && confirmPassword === newPassword && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setErrorMsg("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to change password.");
        setLoading(false);
        return;
      }
      onSuccess();
    } catch {
      setErrorMsg("Network error -- could not reach the server.");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-[10px] text-muted-foreground uppercase tracking-widest block">Current Password</label>
        <div className="relative">
          <Input
            type="password"
            placeholder="••••••••"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full bg-[#0d0d0d] border-border text-xs focus-visible:ring-1 focus-visible:ring-[hsl(38,95%,50%)] font-terminal placeholder-muted-foreground text-foreground rounded-none pl-9 h-9"
          />
          <Lock className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-muted-foreground uppercase tracking-widest block">New Password</label>
        <div className="relative">
          <Input
            type="password"
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-[#0d0d0d] border-border text-xs focus-visible:ring-1 focus-visible:ring-[hsl(38,95%,50%)] font-terminal placeholder-muted-foreground text-foreground rounded-none pl-9 h-9"
          />
          <KeyRound className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
        </div>

        {showMeter && (
          <div className="space-y-1.5">
            <div className="flex gap-1 h-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`flex-1 rounded-full ${i < policy.score ? STRENGTH_COLOR[policy.score] : "bg-[#1a1a1a]"}`} />
              ))}
            </div>
            <div className="text-[8.5px] uppercase tracking-widest text-muted-foreground">
              {STRENGTH_LABEL[policy.score]}
            </div>
            {policy.errors.length > 0 && (
              <ul className="text-[8.5px] text-muted-foreground space-y-0.5">
                {policy.errors.map((e, i) => (
                  <li key={i} className="flex gap-1.5"><span className="text-red-500">•</span>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-muted-foreground uppercase tracking-widest block">Confirm New Password</label>
        <div className="relative">
          <Input
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            className="w-full bg-[#0d0d0d] border-border text-xs focus-visible:ring-1 focus-visible:ring-[hsl(38,95%,50%)] font-terminal placeholder-muted-foreground text-foreground rounded-none pl-9 h-9"
          />
          {confirmPassword.length > 0 && !confirmMismatch
            ? <CheckCircle2 className="w-3.5 h-3.5 absolute left-3 top-3 text-green-500" />
            : <Lock className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />}
        </div>
        {confirmMismatch && <div className="text-[8.5px] text-red-500">Passwords don't match.</div>}
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-950/20 border border-red-900/60 text-red-500 text-[10px] uppercase font-bold flex gap-2 items-start leading-relaxed">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          <div>{errorMsg}</div>
        </div>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-9 border border-border text-muted-foreground hover:text-foreground text-[10px] font-bold uppercase tracking-wider transition-colors duration-150"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 bg-[hsl(38,95%,50%)] hover:bg-[hsl(38,95%,45%)] disabled:opacity-40 disabled:cursor-not-allowed text-black text-[10px] font-bold uppercase tracking-wider transition-colors duration-150"
        >
          <KeyRound className="w-3.5 h-3.5" />
          {loading ? "Updating..." : "Set Password"}
        </button>
      </div>
    </div>
  );
}
