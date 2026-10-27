import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import qrcode from "qrcode-generator";
import type { DeviceNetworkSettings, DeviceNetworkStatus } from "@shared/deviceNetwork";
import type { DeviceRecord, PendingPairing } from "@shared/devicePairing";
import { apiRequest } from "@/lib/queryClient";
import { serverErrorText } from "@/lib/apiErrorText";
import { formatCountdown } from "@/lib/devicesSettingsFormat";
import { useGatewayState } from "@/lib/gateway/GatewayProvider";
import { pendingNotificationReadCount } from "@/lib/p9NotificationReadOutbox";
import {
  advertisedDeviceCapabilities, describeDeviceContinuity, deviceNetworkChangeReview,
  rememberedHomeChangeReview, pairedDeviceRevocationReview,
} from "@/lib/deviceContinuityTruth";
import { RemoteNodeCapabilities } from "./RemoteNodeCapabilities";
import { SystemDoctorDesk } from "./SystemDoctorDesk";
import {
  chooseActiveDeviceHome,
  forgetDeviceHome,
  readDeviceHomesState,
  rememberPairingInvitationUri,
} from "@/lib/gateway/deviceHomeStorage";

interface DevicesResponse {
  devices: DeviceRecord[];
  pending: PendingPairing[];
  canPair: boolean;
  network?: DeviceNetworkStatus;
}

interface PairingCode {
  pairingToken: string;
  expiresAt: string;
  pairingUri?: string;
}

const DEVICES_KEY = ["/api/devices"];
const buttonClass = "min-h-10 rounded border border-border px-3 py-2 font-ui text-xs font-medium tracking-wide text-foreground hover:border-[hsl(38,95%,50%)/40%] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-45";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function DevicesSettings() {
  const queryClient = useQueryClient();
  const gatewayState = useGatewayState();
  const [browserOnline, setBrowserOnline] = useState<boolean | null>(() => typeof navigator === "undefined" ? null : navigator.onLine);
  const [pendingReadCount, setPendingReadCount] = useState(() => pendingNotificationReadCount());
  const [networkReview, setNetworkReview] = useState<{ enabled: boolean; discoverable: boolean; name: string; desiredEnabled: boolean; desiredDiscoverable: boolean; homeId: string | null } | null>(null);
  const [homeReview, setHomeReview] = useState<string | null>(null);
  const [forgetReview, setForgetReview] = useState<string | null>(null);
  const [pairReview, setPairReview] = useState<string | null>(null);
  const [continuityNotice, setContinuityNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<"code" | "invitation" | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [savedHomes, setSavedHomes] = useState(() => readDeviceHomesState());
  const [invitationDraft, setInvitationDraft] = useState("");
  const [homeError, setHomeError] = useState<string | null>(null);

  const devicesQuery = useQuery<DevicesResponse>({
    queryKey: DEVICES_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/devices")).json(),
    staleTime: 5_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => { setBrowserOnline(navigator.onLine); setPendingReadCount(pendingNotificationReadCount()); };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const interval = window.setInterval(sync, 10_000);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); window.clearInterval(interval); };
  }, []);

  const onError = (cause: unknown) => setError(serverErrorText(cause));

  const pairMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/devices/pairing")).json() as Promise<PairingCode>,
    onSuccess: (created) => { setError(null); setCopied(null); setNow(Date.now()); setCode(created); },
    onError,
  });
  const decideMutation = useMutation({
    mutationFn: async ({ pairingId, action }: { pairingId: string; action: "approve" | "deny" }) =>
      (await apiRequest("POST", `/api/devices/pairing/${encodeURIComponent(pairingId)}/${action}`)).json(),
    onSuccess: (_, { pairingId, action }) => {
      setError(null); setPairReview(null);
      setContinuityNotice(action === "approve"
        ? `The server accepted the pairing approval for ${pairingId.slice(0, 8)}. Live capability and device reachability still require verification.`
        : "The server denied the pending pairing request. No device access was approved.");
      void refresh();
    },
    onError,
  });
  const removeMutation = useMutation({
    mutationFn: async (deviceId: string) => (await apiRequest("DELETE", `/api/devices/${encodeURIComponent(deviceId)}`)).json(),
    onSuccess: () => {
      setError(null); setConfirmRemove(null);
      setContinuityNotice("Paired device revoked by the Home and currently connected sessions disconnected. Offline copies are not notified; future access must be denied on reconnect. Already-run actions are not reversed.");
      void refresh();
    },
    onError,
  });
  const networkMutation = useMutation({
    mutationFn: async (settings: DeviceNetworkSettings): Promise<DeviceNetworkStatus> =>
      (await apiRequest("PUT", "/api/devices/network", settings)).json(),
    onMutate: async () => {
      setNetworkError(null);
      await queryClient.cancelQueries({ queryKey: DEVICES_KEY });
    },
    onSuccess: (network, settings) => {
      queryClient.setQueryData<DevicesResponse>(DEVICES_KEY, (current) => current && { ...current, network });
      // A listener restart can select a new port. Never redisplay an invitation for the previous listener.
      setCode(null);
      setCopied(null);
      setNetworkReview(null);
      setContinuityNotice(network.enabled
        ? "The Home reported the device listener enabled. Individual paired-device reachability still requires a fresh connection check."
        : "The Home reported the device listener disabled. Existing work and offline devices are not assumed cancelled or notified.");
      if (nameDraft?.trim() === settings.name) setNameDraft(null);
      void refresh();
    },
    onError: (cause: unknown) => {
      setNetworkError(serverErrorText(cause));
      void refresh();
    },
  });

  const expiresAtMs = code ? new Date(code.expiresAt).getTime() : 0;
  const remainingMs = code ? expiresAtMs - now : 0;
  const codeActive = code !== null && remainingMs > 0;

  useEffect(() => {
    if (!codeActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeActive]);

  const copyPairing = async (kind: "code" | "invitation") => {
    if (!code || !devicesQuery.data?.canPair || Date.parse(code.expiresAt) <= Date.now()) return;
    const value = kind === "code" ? code.pairingToken : devicesQuery.data.network?.enabled ? code.pairingUri : undefined;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setError(kind === "code"
        ? "Could not copy the code. Select it and copy it manually."
        : "Could not copy the invitation. Select it and copy it manually.");
    }
  };

  const deviceContinuity = describeDeviceContinuity(gatewayState, browserOnline);
  const data = devicesQuery.data;
  const pending = data?.pending ?? [];
  const devices = data?.devices ?? [];
  const network = data?.network;
  const networkEnabled = network?.enabled === true;
  const networkDiscoverable = network?.discoverable === true;
  const homeName = nameDraft ?? network?.name ?? "";
  const approveNetworkReview = () => {
    if (!network || !networkReview || networkMutation.isPending) return;
    if (network.name !== networkReview.name || network.homeId !== networkReview.homeId ||
      network.enabled !== networkReview.enabled || network.discoverable !== networkReview.discoverable) {
      setNetworkReview(null);
      setContinuityNotice("Device network status changed since you opened the review. Refresh and inspect before trying again.");
      return;
    }
    networkMutation.mutate({
      enabled: networkReview.desiredEnabled,
      discoverable: networkReview.desiredEnabled && networkReview.desiredDiscoverable,
      name: network.name,
    });
  };
  const requestNetworkReview = (desiredEnabled: boolean, desiredDiscoverable: boolean) => {
    if (!network || networkMutation.isPending) return;
    setContinuityNotice(null);
    setNetworkReview({ enabled: network.enabled, discoverable: network.discoverable, name: network.name,
      desiredEnabled, desiredDiscoverable, homeId: network.homeId });
  };
  const invitation = data?.canPair && codeActive && networkEnabled ? code?.pairingUri : undefined;
  const pairingQr = useMemo(() => {
    if (!invitation) return null;
    try {
      const qr = qrcode(0, "M");
      qr.addData(invitation);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
      return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, error: null };
    } catch {
      return { src: null, error: "This invitation could not be rendered as a QR code. Copy the pairing invitation instead." };
    }
  }, [invitation]);

  return (
    <section className="border border-border/60 bg-black/20 p-3 space-y-3" data-testid="connection-devices-settings">
      <section className="rounded-lg border border-border/55 p-3" aria-label="System diagnostics">
        <button type="button" aria-expanded={doctorOpen} onClick={() => setDoctorOpen(current => !current)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 font-ui text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">
          <span>System Doctor</span><span className="font-normal text-muted-foreground">{doctorOpen ? "Hide" : "Inspect"}</span>
        </button>
        {doctorOpen && <SystemDoctorDesk />}
      </section>
      <div className="flex items-center gap-2">
        <Smartphone className="h-3.5 w-3.5 text-[hsl(38,95%,55%)]" />
        <h3 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Devices</h3>
      </div>
      <p className="font-ui text-xs leading-5 text-muted-foreground">
        Paired devices authenticate as you within capped read/conversation scopes. Advertised features never grant permissions, live worker access, Home management, backup, licence or filesystem authority.
      </p>
      <section data-testid="device-home-continuity-status" aria-label="Home Gateway and offline continuation status" className="space-y-2 rounded border border-border/50 p-3 font-ui text-xs">
        <p role="status" className="font-semibold">{deviceContinuity.label}</p>
        <p className="text-muted-foreground">{deviceContinuity.consequence}</p>
        <p className="text-muted-foreground">Offline read-only navigation may use permitted retained state. No new approval, credential write, scheduled execution, remote-node operation or unverified action is replayed by this screen.</p>
        <p className="text-muted-foreground" data-testid="device-read-outbox-count">
          {pendingReadCount} locally staged notification-read acknowledgement{pendingReadCount === 1 ? "" : "s"} · not server-confirmed.
          Only this owner-scoped, ID-only read queue may be reconciled by the original verified-session P9 outbox, not by device pairing or an automatic action retry.
        </p>
        <button type="button" className={buttonClass} onClick={() => { setPendingReadCount(pendingNotificationReadCount()); void refresh(); }}
          disabled={devicesQuery.isFetching}>Refresh server device status</button>
      </section>
      {continuityNotice && <p role="status" className="font-ui text-xs text-amber-200">{continuityNotice}</p>}
      {data && <RemoteNodeCapabilities />}

      {data?.canPair && (
        <div className="space-y-3 border-t border-border/50 pt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-terminal text-[8px] text-foreground">Allow my devices</p>
              <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
                {networkEnabled
                  ? "Only paired devices can connect; this does not expose the web app or REST API."
                  : network
                    ? "Off by default. This Home does not expose a device listener on your network while this is off. Local pairing by code remains available."
                    : "Device network settings are unavailable. No network access can be enabled here until the Home reports its status."}

              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Allow my devices"
              aria-checked={networkEnabled}
              disabled={!network || networkMutation.isPending}
              onClick={() => requestNetworkReview(!networkEnabled, networkEnabled ? false : !!network?.discoverable)}
              className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${networkEnabled ? "border-emerald-400/70 bg-emerald-500/30" : "border-border bg-black/50"}`}
            >
              <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${networkEnabled ? "left-[18px] bg-emerald-300" : "left-0.5 bg-muted-foreground"}`} />
            </button>
          </div>
          <form
            className="space-y-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (network && homeName.trim()) {
                networkMutation.mutate({ enabled: network.enabled, discoverable: network.discoverable, name: homeName.trim() });
              }
            }}
          >
            <label className="block font-terminal text-[8px] text-foreground" htmlFor="device-home-name">Home name</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="device-home-name"
                type="text"
                required
                maxLength={80}
                value={homeName}
                disabled={!network || networkMutation.isPending}
                onChange={(event) => setNameDraft(event.target.value)}
                className="min-w-0 flex-1 border border-border bg-black/40 px-2 py-1 font-terminal text-[10px] text-foreground disabled:opacity-45"
              />
              <button type="submit" disabled={!network || networkMutation.isPending || !homeName.trim() || homeName.trim() === network.name} className={buttonClass}>
                Save name
              </button>
            </div>
          </form>
          {networkEnabled && network && (
            <div className="flex items-start justify-between gap-3 border-t border-border/40 pt-3">
              <div className="space-y-1">
                <p className="font-terminal text-[8px] text-foreground">Discover on local network</p>
                <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
                  Optional mDNS advertisement while devices are allowed. It publishes your Home name, TLS port and certificate fingerprint hash only—never pairing codes or secrets.
                </p>
                {network.discovering && (
                  <p className="font-terminal text-[8px] text-emerald-300" role="status">Advertising on the LAN.</p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Discover on local network"
                aria-checked={networkDiscoverable}
                disabled={networkMutation.isPending}
                onClick={() => requestNetworkReview(true, !networkDiscoverable)}
                className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${networkDiscoverable ? "border-cyan-400/70 bg-cyan-500/30" : "border-border bg-black/50"}`}
              >
                <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${networkDiscoverable ? "left-[18px] bg-cyan-200" : "left-0.5 bg-muted-foreground"}`} />
              </button>
            </div>
          )}
          {networkReview && network && <section aria-label="Review device network exposure change" data-testid="device-network-review" className="space-y-2 rounded border border-amber-300/30 p-3 font-ui text-xs">
            <p className="font-semibold">Review Home device network change · {networkReview.name}</p>
            <p>{deviceNetworkChangeReview(network, networkReview.desiredEnabled)}</p>
            <p>Requested LAN advertisement: {networkReview.desiredEnabled && networkReview.desiredDiscoverable ? "discoverable" : "not discoverable"}. No change applies until server success.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={networkMutation.isPending || network.enabled !== networkReview.enabled || network.discoverable !== networkReview.discoverable || network.name !== networkReview.name}
                className={buttonClass} onClick={approveNetworkReview}>Confirm network change</button>
              <button type="button" disabled={networkMutation.isPending} className={buttonClass} onClick={() => setNetworkReview(null)}>Cancel</button>
            </div>
          </section>}
          {networkMutation.isPending && <p className="font-terminal text-xs text-muted-foreground" role="status">Saving device network settings at Home; connectivity has not yet been confirmed…</p>}
          {networkError && <p className="font-terminal text-[8px] text-rose-300" role="alert">{networkError}</p>}
          {network?.error && network.error !== networkError && (
            <p className="font-terminal text-[8px] text-rose-300" role="alert">{network.error}</p>
          )}
          {networkEnabled && network && (
            <div className="space-y-2 font-terminal text-[8px] text-muted-foreground">
              <p>Device connections use TLS. If your firewall asks, allow LiOS on your trusted local network so your devices can reach this Home.</p>
              <div>
                <p className="text-foreground">Device listener addresses</p>
                {network.urls.length > 0 ? (
                  <ul className="space-y-1">
                    {network.urls.map((url) => <li key={url}><code className="break-all select-all">{url}</code></li>)}
                  </ul>
                ) : <p>No reachable network addresses are currently available.</p>}
              </div>
              <div>
                <p className="text-foreground">TLS certificate fingerprint (SHA-256)</p>
                <code className="block break-all select-all">{network.fingerprint ?? "Unavailable"}</code>
                <p>The pairing invitation pins this certificate so your device can trust this Home.</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        {data?.canPair && !codeActive && (
          <button type="button" disabled={pairMutation.isPending || networkMutation.isPending} onClick={() => pairMutation.mutate()} className={buttonClass}>
            {pairMutation.isPending ? "Creating code…" : "Pair a new device"}
          </button>
        )}
        {data?.canPair && code && codeActive && (
          <div className="space-y-1">
            {networkEnabled && !code.pairingUri && (
              <button type="button" disabled={pairMutation.isPending || networkMutation.isPending} onClick={() => pairMutation.mutate()} className={buttonClass}>
                {pairMutation.isPending ? "Creating invitation…" : "Create pairing invitation"}
              </button>
            )}
            {invitation && (
              <div className="space-y-2">
                <p className="font-terminal text-[8px] text-foreground">Scan this pairing invitation in the LiOS app on your device.</p>
                {pairingQr?.src ? (
                  <img
                    src={pairingQr.src}
                    alt="LiOS device pairing invitation QR code"
                    width={384}
                    height={384}
                    className="block h-auto max-w-full bg-white"
                  />
                ) : <p className="font-terminal text-[8px] text-rose-300" role="alert">{pairingQr?.error}</p>}
                <button type="button" onClick={() => void copyPairing("invitation")} className={buttonClass}>
                  {copied === "invitation" ? "Copied pairing invitation" : "Copy pairing invitation"}
                </button>
                <details className="font-terminal text-[8px] text-muted-foreground">
                  <summary className="cursor-pointer">Manual pairing invitation</summary>
                  <code className="block break-all select-all">{invitation}</code>
                </details>
              </div>
            )}
            <p className="font-terminal text-[8px] text-muted-foreground">Enter this code in the LiOS app on your device.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all border border-border bg-black/40 px-2 py-1 font-mono text-[10px] text-foreground select-all" data-testid="devices-pairing-code">
                {code.pairingToken}
              </code>
              <button type="button" onClick={() => void copyPairing("code")} aria-label="Copy pairing code" className={buttonClass}>
                {copied === "code" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="font-terminal text-[8px] text-muted-foreground" role="status">Expires in {formatCountdown(remainingMs)}</p>
            <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
              Keep the QR invitation and code private. The token is single-use and expires after five minutes. The Home owner must approve the device before it can connect.
            </p>
          </div>
        )}
        {data?.canPair && code && !codeActive && (
          <p className="font-terminal text-[8px] text-muted-foreground" role="status">Code expired</p>
        )}
        {data && !data.canPair && <p className="font-terminal text-[8px] text-muted-foreground">Ask the Home owner to pair a new device.</p>}
      </div>

      {error && <p className="font-terminal text-[8px] text-rose-300" role="alert">{error}</p>}

      {devicesQuery.isPending ? (
        <p className="font-terminal text-[8px] text-muted-foreground" role="status">Loading devices…</p>
      ) : !data ? (
        <p className="font-terminal text-[8px] text-rose-300" role="alert">Devices are unavailable.</p>
      ) : (
        <>
          <div
            className={pending.length > 0 ? "space-y-2 border border-[hsl(38,95%,50%)] bg-[hsl(38,95%,50%)/10%] p-2" : "space-y-2"}
            data-testid="devices-pending"
          >
            <h4 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Waiting for your approval</h4>
            {pending.length === 0 ? (
              <p className="font-terminal text-[8px] text-muted-foreground">No devices are waiting for approval.</p>
            ) : (
              <ul className="space-y-2">
                {pending.map((request) => (
                  <li key={request.pairingId} className="flex flex-wrap items-center justify-between gap-2 font-terminal text-[8px]">
                    <div className="space-y-0.5">
                      <div className="text-foreground">{request.deviceName}</div>
                      <div className="text-muted-foreground">
                        {request.platform} · {request.deviceId.slice(0, 8)} · requested {formatDate(request.requestedAt)} · approval pending, no live access
                      </div>
                      <div className="max-w-[42rem] break-words text-muted-foreground">
                        {advertisedDeviceCapabilities(request).label}
                        <p className="mt-1">{advertisedDeviceCapabilities(request).caveat}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!data.canPair || decideMutation.isPending}
                        aria-label={`Approve ${request.deviceName}`}
                        onClick={() => setPairReview(request.pairingId)}
                        className={buttonClass}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={!data.canPair || decideMutation.isPending}
                        aria-label={`Deny ${request.deviceName}`}
                        onClick={() => decideMutation.mutate({ pairingId: request.pairingId, action: "deny" })}
                        className={buttonClass}
                      >
                        Deny
                      </button>
                    </div>
                    {pairReview === request.pairingId && <div role="group" aria-label={`Review device pairing for ${request.deviceName}`} data-testid="device-pairing-review" className="w-full space-y-1 rounded border border-amber-300/30 p-2">
                      <p>Approve {request.deviceName} ({request.deviceId.slice(0, 8)}) for this Home owner? Requested capabilities and commands are self-advertised only; approval grants the server-capped device scopes, not these command rights.</p>
                      <button type="button" disabled={decideMutation.isPending} className={buttonClass}
                        onClick={() => decideMutation.mutate({ pairingId: request.pairingId, action: "approve" })}>Confirm pairing approval</button>
                      <button type="button" disabled={decideMutation.isPending} className={buttonClass} onClick={() => setPairReview(null)}>Cancel</button>
                    </div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border border-border/40 p-2" data-testid="devices-saved-homes">
            <h4 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Other Homes this device can use</h4>
            <p className="font-terminal text-[8px] leading-relaxed text-muted-foreground">
              Paste a pairing invitation from another LiOS Home to remember it here. Only its name, address and certificate fingerprint are saved, never the pairing code. One Home is active at a time.
            </p>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  setSavedHomes(rememberPairingInvitationUri(invitationDraft));
                  setInvitationDraft("");
                  setHomeError(null);
                } catch (cause) {
                  setHomeError(cause instanceof Error ? cause.message : "That invitation could not be read.");
                }
              }}
            >
              <input
                value={invitationDraft}
                onChange={(event) => setInvitationDraft(event.target.value)}
                aria-label="Pairing invitation from another Home"
                placeholder="Paste a LiOS pairing invitation"
                autoComplete="off"

                spellCheck={false}
                className="min-w-[16rem] flex-1 border border-border bg-black/40 px-2 py-1 font-terminal text-[8px] text-foreground"
              />
              <button type="submit" disabled={!invitationDraft.trim()} className={buttonClass}>Remember this Home</button>
            </form>
            {homeError && <p className="font-terminal text-[8px] text-rose-300" role="alert">{homeError}</p>}
            {savedHomes.homes.length === 0 ? (
              <p className="font-terminal text-[8px] text-muted-foreground">No other Homes saved.</p>
            ) : (
              <ul className="space-y-2">
                {savedHomes.homes.map((home) => (
                  <li key={home.homeId} className="flex flex-wrap items-center justify-between gap-2 font-terminal text-[8px]">
                    <div className="space-y-0.5">
                      <div className="text-foreground">
                        {home.name}
                        {savedHomes.activeHomeId === home.homeId && <span className="ml-2 text-cyan-200">(locally selected · connection unverified)</span>}
                      </div>
                      <div className="break-all text-muted-foreground">{home.urls[0]}</div>
                    </div>
                    <div className="flex gap-2">
                      {savedHomes.activeHomeId !== home.homeId && (
                        <button type="button" className={buttonClass} onClick={() => setHomeReview(home.homeId)}>Make active</button>
                      )}
                      <button type="button" className={buttonClass} onClick={() => { setHomeReview(null); setForgetReview(home.homeId); }}>Review forget</button>
                    </div>
                    {forgetReview === home.homeId && <div data-testid="device-home-forget-review" role="group" aria-label={`Review forgetting saved Home ${home.name}`} className="w-full space-y-1 rounded border border-amber-300/30 p-2">
                      <p>Forget local Home "{home.name}"? Only this device's saved address and pinned certificate are removed; the remote Home's pairing credential is not revoked. {savedHomes.activeHomeId === home.homeId
                        ? "This was your locally selected Home. The existing storage policy may select another saved Home, but no TLS connection, rights transfer or pending action is automatically attempted."
                        : "This is not the locally selected Home."}</p>
                      <button type="button" className={buttonClass} onClick={() => {
                        try {
                          setSavedHomes(forgetDeviceHome(home.homeId));
                          setContinuityNotice("Local Home record forgotten. This is not server-side pairing revocation or a verified connection change.");
                          setForgetReview(null);
                        } catch (cause) { setHomeError(serverErrorText(cause)); }
                      }}>Confirm forget local record</button>
                      <button type="button" className={buttonClass} onClick={() => setForgetReview(null)}>Cancel</button>
                    </div>}
                    {homeReview === home.homeId && <div data-testid="device-home-switch-review" role="group" aria-label={`Review locally selected Home ${home.name}`} className="w-full space-y-1 rounded border border-amber-300/30 p-2">
                      <p>{rememberedHomeChangeReview(home)}</p>
                      <button type="button" className={buttonClass} onClick={() => {
                        try {
                          setSavedHomes(chooseActiveDeviceHome(home.homeId));
                          setContinuityNotice("Locally selected Home updated. TLS connection and server capability not verified; no pending operation was retried.");
                          setHomeReview(null);
                        } catch (cause) { setHomeError(serverErrorText(cause)); }
                      }}>Confirm local Home selection</button>
                      <button type="button" className={buttonClass} onClick={() => setHomeReview(null)}>Cancel</button>
                    </div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2" data-testid="devices-paired">
            <h4 className="font-terminal text-[8px] uppercase tracking-widest text-foreground">Paired devices</h4>
            {devices.length === 0 ? (
              <p className="font-terminal text-[8px] text-muted-foreground">No devices are paired yet.</p>
            ) : (
              <ul className="space-y-2">
                {devices.map((device) => (
                  <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 font-terminal text-[8px]">
                    <div className="space-y-0.5">
                      <div className="text-foreground">{device.name}</div>
                      <div className="text-muted-foreground">
                        {device.platform} · paired {formatDate(device.createdAt)} · last seen {device.lastSeenAt ? formatDate(device.lastSeenAt) : "never"}
                      </div>
                      <div className="max-w-[42rem] break-words text-muted-foreground">
                        {advertisedDeviceCapabilities(device).label}
                        {device.advertisedAt ? ` · last advertised ${formatDate(device.advertisedAt)}` : ""}
                        <p className="mt-1">{advertisedDeviceCapabilities(device).caveat}</p>
                      </div>
                    </div>
                    {confirmRemove === device.id ? (
                      <div className="flex items-center gap-2" role="group" aria-label={`Confirm removing ${device.name}`}>
                        <span className="max-w-sm text-muted-foreground">{pairedDeviceRevocationReview(device)}</span>
                        <button
                          type="button"
                          disabled={removeMutation.isPending}
                          aria-label={`Confirm revoke ${device.name}`}
                          onClick={() => removeMutation.mutate(device.id)}
                          className={buttonClass}
                        >
                          {removeMutation.isPending ? "Revoking…" : "Revoke device"}
                        </button>
                        <button type="button" onClick={() => setConfirmRemove(null)} className={buttonClass}>Cancel</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${device.name}`}
                        onClick={() => setConfirmRemove(device.id)}
                        className={buttonClass}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}