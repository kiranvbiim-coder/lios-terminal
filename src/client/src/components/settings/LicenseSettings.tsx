import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { serverErrorText } from "@/lib/apiErrorText";

interface LicenseStatus {
  deviceFingerprintHash: string;
  state: string;
  bound?: boolean | null;
  planCode?: string | null;
  seats?: number | null;
  expiresAt?: string | null;
}

const LICENSE_STATUS_KEY = ["/api/license/status"];
const ADMIN_ROLES: Record<string, true> = { internal_admin: true, client_admin: true };

const STATE_TEXT: Record<string, string> = {
  none: "No licence imported",
  offline_lease_expired: "Expired",
  offline_lease_untrusted_key: "Not issued by LiOS",
  offline_lease_invalid: "Not issued by LiOS",
  offline_lease_wrong_device: "Issued for a different installation",
};

function describeState(status: LicenseStatus): string {
  if (status.state === "valid") {
    const until = status.expiresAt ? new Date(status.expiresAt) : null;
    return until && !Number.isNaN(until.getTime()) ? `Valid until ${until.toLocaleDateString()}` : "Valid";
  }
  return STATE_TEXT[status.state] ?? "Licence not usable";
}

export default function LicenseSettings({ role }: { role: string }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const isAdmin = ADMIN_ROLES[role] === true;

  const statusQuery = useQuery<LicenseStatus>({
    queryKey: LICENSE_STATUS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/license/status")).json(),
    enabled: isAdmin,
    staleTime: 5_000,
  });
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const license = await file.text();
      return (await apiRequest("POST", "/api/license/import", { license })).json() as Promise<LicenseStatus>;
    },
    onSuccess: (saved) => {
      setImportError(null);
      queryClient.setQueryData(LICENSE_STATUS_KEY, saved);
    },
    onError: (error) => setImportError(serverErrorText(error)),
  });

  if (!isAdmin) return null;
  const status = statusQuery.data;

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-license-settings">
      <div className="flex items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Licence</h3>
      </div>

      {statusQuery.isPending ? (
        <p className="font-terminal text-[8px] text-muted-foreground" role="status">Checking licence…</p>
      ) : !status ? (
        <p className="font-terminal text-[8px] text-rose-300" role="alert">Licence status is unavailable.</p>
      ) : (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 font-terminal text-[8px]">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-foreground" data-testid="license-state">{describeState(status)}</dd>
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="text-foreground">{status.planCode ?? "—"}</dd>
          <dt className="text-muted-foreground">Seats</dt>
          <dd className="text-foreground">{status.seats ?? "—"}</dd>
          <dt className="text-muted-foreground">Binding</dt>
          <dd className="text-foreground">{status.bound ? "Bound to this installation" : "Works on any installation"}</dd>
        </dl>
      )}

      {status && (
        <div className="space-y-1">
          <label htmlFor="license-installation-id" className="block font-terminal text-[8px] text-muted-foreground">Installation ID</label>
          <input
            id="license-installation-id"
            readOnly
            value={status.deviceFingerprintHash}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full border border-border bg-black/40 px-2 py-1 font-terminal text-[8px] text-foreground"
          />
          <p className="font-terminal text-[7px] text-muted-foreground">Send this ID to LiOS if you need a licence bound to this installation.</p>
        </div>
      )}

      <div className="space-y-1">
        <input
          ref={fileInput}
          type="file"
          accept=".lioslicense,.json"
          aria-label="Licence file"
          data-testid="license-file-input"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importMutation.mutate(file);
          }}
        />
        <button
          type="button"
          disabled={importMutation.isPending}
          onClick={() => fileInput.current?.click()}
          className="border border-border px-3 py-1 font-terminal text-[8px] uppercase tracking-wider text-foreground hover:border-[hsl(38,95%,50%)/40%] disabled:opacity-45"
        >
          {importMutation.isPending ? "Importing…" : "Import licence file"}
        </button>
        {importError && <p className="font-terminal text-[8px] text-rose-300" role="alert">{importError}</p>}
      </div>
    </section>
  );
}
