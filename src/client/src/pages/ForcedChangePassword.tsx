import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ChangePasswordForm from "@/components/ChangePasswordForm";

interface Props {
  email: string;
  onDone: () => void;
}

// Shown instead of the domain picker / terminal whenever the account still
// has an admin-generated password (new account or a reset) -- forces a
// real, self-chosen permanent password before anything else is reachable.
export default function ForcedChangePassword({ email, onDone }: Props) {
  return (
    <div className="min-h-screen w-screen bg-[#030303] bg-radial-gradient flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] pointer-events-none" />

      <Card className="w-full max-w-md bg-[#070707] border-border text-foreground font-terminal relative overflow-hidden shadow-[0_0_20px_rgba(38,38,38,0.15)] animate-in fade-in zoom-in duration-300">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-[hsl(38,95%,50%)]" />

        <CardHeader className="text-center pt-8 pb-4">
          <div className="mx-auto w-12 h-12 rounded-full border border-border flex items-center justify-center bg-[#0d0d0d] mb-3">
            <ShieldAlert className="w-6 h-6 text-[hsl(38,95%,50%)]" />
          </div>
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-[hsl(38,95%)]">
            Set a Permanent Password
          </CardTitle>
          <CardDescription className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1.5">
            {email} — Temporary password must be replaced before continuing
          </CardDescription>
        </CardHeader>

        <CardContent>
          <ChangePasswordForm onSuccess={onDone} />
        </CardContent>
      </Card>
    </div>
  );
}
