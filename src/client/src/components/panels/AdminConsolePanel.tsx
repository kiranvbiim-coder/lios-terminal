import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Activity, Building2, Users, Briefcase, Plus, ShieldAlert, Layers, X, Radar, Ban, PlayCircle, FileSpreadsheet, ChevronDown, ChevronRight, Inbox, ShieldCheck } from "lucide-react";
import EnterpriseGovernancePanel from "./EnterpriseGovernancePanel";
import OperationalReadinessPanel from "./OperationalReadinessPanel";

interface Props {
  role: string;
}

interface Organization {
  id: number;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

interface AdminUser {
  id: number;
  email: string;
  role: string;
  organizationId: number | null;
  name: string;
  active: boolean;
  lastLoginAt: string | null;
}

interface Portfolio {
  id: number;
  organizationId: number;
  name: string;
  createdAt: string;
}

interface Position {
  id: number;
  portfolioId: number;
  symbol: string;
  shares: number;
  avgCost: number;
}

interface DomainInfo {
  id: number;
  slug: string;
  name: string;
  active: boolean;
}

type Tab = "organizations" | "users" | "portfolios" | "domains" | "control" | "enterprise" | "readiness" | "pipeline" | "datasets" | "leads";

interface LeadRow {
  id: number;
  name: string;
  email: string;
  company: string | null;
  message: string | null;
  source: string;
  createdAt: string;
}

interface PipelineRow {
  id: number;
  name: string;
  slug: string;
  status: string;
  trialCreditsGrantedAt: string | null;
  lastActivityAt: string | null;
  selectedTiers: Array<{ id: number; model: string; status: string }>;
  pipelineStatus: "hot" | "active" | "stalled";
}

interface ControlPlaneSnapshot {
  organization: Organization;
  license: {
    id: number;
    status: "active" | "grace" | "billing_hold" | "suspended" | "security_locked" | "terminated";
    planId: number | null;
    seatsPurchased: number;
    billingState: string;
    graceEndsAt: string | null;
    offlineLeaseExpiresAt: string | null;
  } | null;
  plan: { id: number; code: string; name: string; tier: string } | null;
  entitlements: Array<{ id: number; featureKey: string; entitlementType: string; active: boolean; expiresAt: string | null }>;
  devices: Array<{ id: number; deviceLabel: string; status: "authorized" | "pending" | "revoked" | string; leaseExpiresAt: string | null; revokedAt: string | null }>;
  sessionControls: Array<{ id: number; controlType: string; scope: string; reason: string; createdAt: string; active: boolean }>;
}

interface PlatformPlan {
  id: number;
  code: string;
  name: string;
  tier: string;
  active: boolean;
}

const CLIENT_ROLES = ["client_admin", "client_user"];

export default function AdminConsolePanel({ role }: Props) {
  const [tab, setTab] = useState<Tab>("organizations");
  const isAdmin = role === "internal_admin";
  const qc = useQueryClient();

  const { data: orgs = [] } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/organizations")).json(),
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#050505]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#070707] shrink-0">
        <ShieldAlert className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">ADMIN CONSOLE</span>
        {!isAdmin && (
          <span className="font-terminal text-[9px] text-muted-foreground ml-2">READ-ONLY — internal_admin required for write actions</span>
        )}
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-[#070707] shrink-0">
        {([
          ["pipeline", "PIPELINE", Radar],
          ["organizations", "ORGANIZATIONS", Building2],
          ["users", "USERS", Users],
          ["portfolios", "PORTFOLIOS", Briefcase],
          ["domains", "DOMAINS", Layers],
          ["control", "CONTROL", ShieldAlert],
          ["enterprise", "ENTERPRISE", ShieldCheck],
          ["readiness", "READINESS", Activity],
          ["datasets", "DATASETS", FileSpreadsheet],
          ["leads", "LEADS", Inbox],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 font-terminal text-[9px] tracking-widest border ${
              tab === id ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/5" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "pipeline" && <PipelineTab isAdmin={isAdmin} />}
        {tab === "organizations" && <OrganizationsTab orgs={orgs} isAdmin={isAdmin} qc={qc} />}
        {tab === "users" && <UsersTab orgs={orgs} isAdmin={isAdmin} qc={qc} />}
        {tab === "portfolios" && <PortfoliosTab orgs={orgs} isAdmin={isAdmin} />}
        {tab === "domains" && <DomainsTab orgs={orgs} isAdmin={isAdmin} />}
        {tab === "control" && <ControlPlaneTab orgs={orgs} isAdmin={isAdmin} />}
        {tab === "enterprise" && <EnterpriseGovernancePanel orgs={orgs} isAdmin={isAdmin} />}
        {tab === "readiness" && <OperationalReadinessPanel />}
        {tab === "datasets" && <DatasetsTab orgs={orgs} />}
        {tab === "leads" && <LeadsTab />}
      </div>
    </div>
  );
}

function ControlPlaneTab({ orgs, isAdmin }: { orgs: Organization[]; isAdmin: boolean }) {
  const [orgId, setOrgId] = useState<string>("");
  const [licenseStatus, setLicenseStatus] = useState("active");
  const [seatsPurchased, setSeatsPurchased] = useState("1");
  const [billingState, setBillingState] = useState("current");
  const [featureKey, setFeatureKey] = useState("");
  const [entitlementType, setEntitlementType] = useState("engine");
  const [deviceFingerprintHash, setDeviceFingerprintHash] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [sessionReason, setSessionReason] = useState("");
  const qc = useQueryClient();

  const { data: plans = [] } = useQuery<PlatformPlan[]>({
    queryKey: ["/api/admin/plans"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/plans")).json(),
  });

  const { data: control } = useQuery<ControlPlaneSnapshot>({
    queryKey: ["/api/admin/organizations", orgId, "control-plane"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/organizations/${orgId}/control-plane`)).json(),
    enabled: !!orgId,
  });

  useEffect(() => {
    setLicenseStatus(control?.license?.status ?? "active");
    setSeatsPurchased(control?.license?.seatsPurchased?.toString() ?? "1");
    setBillingState(control?.license?.billingState ?? "current");
  }, [control?.license?.status, control?.license?.seatsPurchased, control?.license?.billingState, orgId]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/admin/organizations", orgId, "control-plane"] });

  const licenseMut = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/admin/organizations/${orgId}/license`, {
      status: licenseStatus,
      seatsPurchased: Number(seatsPurchased),
      billingState,
    })).json(),
    onSuccess: invalidate,
  });

  const entitlementMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/organizations/${orgId}/entitlements`, {
      featureKey,
      entitlementType,
      active: true,
    })).json(),
    onSuccess: () => {
      setFeatureKey("");
      invalidate();
    },
  });

  const deviceMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/organizations/${orgId}/devices`, {
      deviceFingerprintHash,
      deviceLabel,
      status: "authorized",
    })).json(),
    onSuccess: () => {
      setDeviceFingerprintHash("");
      setDeviceLabel("");
      invalidate();
    },
  });
  const deviceStatusMut = useMutation({
    mutationFn: async ({ deviceId, status }: { deviceId: number; status: "authorized" | "revoked" }) =>
      (await apiRequest("PATCH", `/api/admin/devices/${deviceId}`, { status })).json(),
    onSuccess: invalidate,
  });

  const forceLogoutMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/session-controls", {
      controlType: "force_logout",
      scope: "organization",
      organizationId: Number(orgId),
      reason: sessionReason,
    })).json(),
    onSuccess: () => {
      setSessionReason("");
      invalidate();
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-1 max-w-xs">
        <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Organization</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}
          className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </div>

      {!orgId && <p className="font-terminal text-[10px] text-muted-foreground">Select an organization to manage licenses, entitlements, devices, and session controls.</p>}

      {orgId && control && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 border border-border bg-[#070707]">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">License</div>
              <div className="font-terminal text-lg text-foreground uppercase">{control.license?.status ?? "not configured"}</div>
            </div>
            <div className="p-3 border border-border bg-[#070707]">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">Plan</div>
              <div className="font-terminal text-lg text-foreground">{control.plan?.name ?? "None"}</div>
            </div>
            <div className="p-3 border border-border bg-[#070707]">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">Entitlements</div>
              <div className="font-terminal text-lg text-foreground">{control.entitlements.length}</div>
            </div>
            <div className="p-3 border border-border bg-[#070707]">
              <div className="font-terminal text-[8px] text-muted-foreground uppercase tracking-widest">Devices</div>
              <div className="font-terminal text-lg text-foreground">{control.devices.length}</div>
            </div>
          </div>

          {isAdmin && (
            <form onSubmit={(e) => { e.preventDefault(); licenseMut.mutate(); }} className="flex flex-wrap items-end gap-2 p-3 border border-border bg-[#070707]">
              <div className="flex flex-col gap-1">
                <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Status</label>
                <select value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)}
                  className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
                  {["active", "grace", "billing_hold", "suspended", "security_locked", "terminated"].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Seats</label>
                <input value={seatsPurchased} onChange={(e) => setSeatsPurchased(e.target.value)} type="number" min="1"
                  className="w-20 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Billing state</label>
                <input value={billingState} onChange={(e) => setBillingState(e.target.value)}
                  className="w-40 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
              </div>
              <button type="submit" disabled={licenseMut.isPending}
                className="h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
                Save License
              </button>
              {!!plans.length && <span className="font-terminal text-[8.5px] text-muted-foreground">Plans available: {plans.map((plan) => plan.code).join(", ")}</span>}
            </form>
          )}

          {isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <form onSubmit={(e) => { e.preventDefault(); if (featureKey) entitlementMut.mutate(); }} className="space-y-2 p-3 border border-border bg-[#070707]">
                <div className="font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">Grant entitlement</div>
                <input value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} placeholder="valuation.dcf or *"
                  className="w-full bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                <select value={entitlementType} onChange={(e) => setEntitlementType(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
                  {["domain", "data_source", "engine", "export", "ai", "connector", "support", "admin"].map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <button type="submit" disabled={entitlementMut.isPending}
                  className="px-3 py-1 border border-border font-terminal text-[9px] uppercase text-muted-foreground hover:text-foreground">
                  Grant
                </button>
              </form>

              <form onSubmit={(e) => { e.preventDefault(); if (deviceFingerprintHash && deviceLabel) deviceMut.mutate(); }} className="space-y-2 p-3 border border-border bg-[#070707]">
                <div className="font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">Authorize device</div>
                <input value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} placeholder="Kiran MacBook"
                  className="w-full bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                <input value={deviceFingerprintHash} onChange={(e) => setDeviceFingerprintHash(e.target.value)} placeholder="fingerprint hash"
                  className="w-full bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                <button type="submit" disabled={deviceMut.isPending}
                  className="px-3 py-1 border border-border font-terminal text-[9px] uppercase text-muted-foreground hover:text-foreground">
                  Authorize
                </button>
              </form>
            </div>
          )}

          {isAdmin && (
            <form onSubmit={(e) => { e.preventDefault(); if (sessionReason) forceLogoutMut.mutate(); }} className="flex items-end gap-2 p-3 border border-rose-500/30 bg-rose-500/5">
              <div className="flex flex-col gap-1 flex-1">
                <label className="font-terminal text-[8.5px] text-rose-300 uppercase">Force logout organization</label>
                <input value={sessionReason} onChange={(e) => setSessionReason(e.target.value)} placeholder="Security incident / license suspension"
                  className="w-full bg-[#0d0d0d] border border-rose-500/30 px-2 py-1 font-terminal text-[10px] focus:outline-none" />
              </div>
              <button type="submit" disabled={forceLogoutMut.isPending}
                className="h-[26px] px-3 border border-rose-500/50 text-rose-300 font-terminal text-[9px] font-bold uppercase tracking-wider">
                Force Logout
              </button>
            </form>
          )}

          <div className="grid grid-cols-3 gap-3 font-terminal text-[10px]">
            <div className="border border-border bg-[#070707] p-3">
              <div className="text-muted-foreground uppercase tracking-widest mb-2">Entitlements</div>
              {control.entitlements.map((entitlement) => (
                <div key={entitlement.id} className="flex justify-between py-1 border-b border-border/30">
                  <span>{entitlement.featureKey}</span><span className={entitlement.active ? "text-emerald-400" : "text-rose-400"}>{entitlement.entitlementType}</span>
                </div>
              ))}
              {!control.entitlements.length && <div className="text-muted-foreground">No entitlements.</div>}
            </div>
            <div className="border border-border bg-[#070707] p-3">
              {control.devices.map((device) => (
                <div key={device.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/30">
                  <span>{device.deviceLabel}</span>
                  <span className={device.status === "authorized" ? "text-emerald-400" : device.status === "pending" ? "text-amber-300" : "text-rose-400"}>{device.status}</span>
                  {isAdmin && device.status === "pending" && (
                    <button type="button" onClick={() => deviceStatusMut.mutate({ deviceId: device.id, status: "authorized" })} className="text-[9px] uppercase text-emerald-300">
                      Approve
                    </button>
                  )}
                  {isAdmin && device.status === "authorized" && (
                    <button type="button" onClick={() => deviceStatusMut.mutate({ deviceId: device.id, status: "revoked" })} className="text-[9px] uppercase text-rose-300">
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              {!control.devices.length && <div className="text-muted-foreground">No devices.</div>}
            </div>
            <div className="border border-border bg-[#070707] p-3">
              <div className="text-muted-foreground uppercase tracking-widest mb-2">Session controls</div>
              {control.sessionControls.map((controlRow) => (
                <div key={controlRow.id} className="py-1 border-b border-border/30">
                  <div className="text-foreground">{controlRow.controlType} / {controlRow.scope}</div>
                  <div className="text-muted-foreground">{controlRow.reason}</div>
                </div>
              ))}
              {!control.sessionControls.length && <div className="text-muted-foreground">No session controls.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const PIPELINE_STATUS_LABEL: Record<PipelineRow["pipelineStatus"], string> = {
  hot: "Hot",
  active: "Active",
  stalled: "Stalled",
};

const PIPELINE_STATUS_CLASS: Record<PipelineRow["pipelineStatus"], string> = {
  hot: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  active: "text-[hsl(38,95%,55%)] border-[hsl(38,95%,50%)]/40 bg-[hsl(38,95%,50%)]/10",
  stalled: "text-muted-foreground border-border bg-transparent",
};

function daysAgo(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Trial-to-Contract Phase C.5: which trial orgs are hot, which are stalled,
// what they've selected, and a per-org kill switch -- staff need this
// visible as soon as trial activity exists, not once the whole funnel
// (agreement, payment) is built. See BUILD_PLAN.
function LeadsTab() {
  const { data: rows = [], isLoading } = useQuery<LeadRow[]>({
    queryKey: ["/api/admin/leads"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/leads")).json(),
    refetchInterval: 30_000,
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4 font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">
        <span>{rows.length} lead{rows.length === 1 ? "" : "s"} from the Experience Center</span>
      </div>

      {isLoading ? (
        <div className="p-4 text-center font-terminal text-[10px] text-muted-foreground">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-center font-terminal text-[10px] text-muted-foreground">No leads captured yet.</div>
      ) : (
        <table className="w-full font-terminal text-[10px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-1.5 font-normal uppercase tracking-widest">Name</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Email</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Company</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Message</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Source</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/40 align-top">
                <td className="py-1.5 text-foreground">{row.name}</td>
                <td className="py-1.5 text-[hsl(186,80%,55%)]">
                  <a href={`mailto:${row.email}`} className="hover:underline">{row.email}</a>
                </td>
                <td className="py-1.5 text-muted-foreground">{row.company || "—"}</td>
                <td className="py-1.5 text-muted-foreground max-w-[320px]">{row.message || "—"}</td>
                <td className="py-1.5 text-muted-foreground uppercase tracking-wider">{row.source}</td>
                <td className="py-1.5 text-muted-foreground">{daysAgo(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PipelineTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery<PipelineRow[]>({
    queryKey: ["/api/admin/pipeline"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/pipeline")).json(),
    refetchInterval: 30_000,
  });

  const toggleStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "active" | "inactive" }) => {
      await apiRequest("PATCH", `/api/admin/organizations/${id}`, { status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/pipeline"] }),
  });

  const sorted = [...rows].sort((a, b) => {
    const order = { hot: 0, active: 1, stalled: 2 };
    return order[a.pipelineStatus] - order[b.pipelineStatus];
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4 font-terminal text-[9px] text-muted-foreground uppercase tracking-widest">
        <span>{rows.length} trial org{rows.length === 1 ? "" : "s"}</span>
        <span className="text-rose-400">{rows.filter((r) => r.pipelineStatus === "hot").length} hot</span>
        <span>{rows.filter((r) => r.pipelineStatus === "stalled").length} stalled</span>
      </div>

      {isLoading ? (
        <div className="p-4 text-center font-terminal text-[10px] text-muted-foreground">Loading...</div>
      ) : (
        <table className="w-full font-terminal text-[10px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-1.5 font-normal uppercase tracking-widest">Org</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Status</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Trial started</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Selected tiers</th>
              <th className="py-1.5 font-normal uppercase tracking-widest">Last activity</th>
              <th className="py-1.5 font-normal uppercase tracking-widest"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="border-b border-border/40">
                <td className="py-1.5 text-foreground">
                  {row.name}
                  {row.status === "inactive" && (
                    <span className="ml-2 font-terminal text-[8px] text-red-500 uppercase tracking-wider border border-red-500/40 px-1 py-0.5">Suspended</span>
                  )}
                </td>
                <td className="py-1.5">
                  <span className={`px-1.5 py-0.5 border uppercase tracking-wider ${PIPELINE_STATUS_CLASS[row.pipelineStatus]}`}>
                    {PIPELINE_STATUS_LABEL[row.pipelineStatus]}
                  </span>
                </td>
                <td className="py-1.5 text-muted-foreground">{daysAgo(row.trialCreditsGrantedAt)}</td>
                <td className="py-1.5 text-[hsl(186,80%,55%)]">
                  {row.selectedTiers.length ? row.selectedTiers.map((t) => t.model).join(", ") : <span className="text-muted-foreground">None yet</span>}
                </td>
                <td className="py-1.5 text-muted-foreground">{daysAgo(row.lastActivityAt)}</td>
                <td className="py-1.5 text-right">
                  {isAdmin && (
                    row.status === "active" ? (
                      <button
                        type="button"
                        disabled={toggleStatusMut.isPending}
                        onClick={() => { if (confirm(`Suspend trial access for ${row.name}? They will immediately lose access to the trial terminal.`)) toggleStatusMut.mutate({ id: row.id, status: "inactive" }); }}
                        className="flex items-center gap-1 ml-auto font-terminal text-[8.5px] uppercase tracking-wider text-muted-foreground hover:text-red-500 border border-border hover:border-red-500/50 px-2 py-1"
                      >
                        <Ban className="w-3 h-3" /> Suspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={toggleStatusMut.isPending}
                        onClick={() => toggleStatusMut.mutate({ id: row.id, status: "active" })}
                        className="flex items-center gap-1 ml-auto font-terminal text-[8.5px] uppercase tracking-wider text-muted-foreground hover:text-[hsl(38,95%,55%)] border border-border hover:border-[hsl(38,95%,50%)]/50 px-2 py-1"
                      >
                        <PlayCircle className="w-3 h-3" /> Reactivate
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
            {!sorted.length && (
              <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">No trial organizations yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DomainsTab({ orgs, isAdmin }: { orgs: Organization[]; isAdmin: boolean }) {
  const [orgId, setOrgId] = useState<string>("");
  const qc = useQueryClient();

  const { data: allDomains = [] } = useQuery<DomainInfo[]>({
    queryKey: ["/api/admin/domains"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/domains")).json(),
  });

  const { data: orgDomains = [] } = useQuery<DomainInfo[]>({
    queryKey: ["/api/admin/organizations", orgId, "domains"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/organizations/${orgId}/domains`)).json(),
    enabled: !!orgId,
  });

  const grantMut = useMutation({
    mutationFn: async (domainId: number) => {
      await apiRequest("POST", `/api/admin/organizations/${orgId}/domains`, { domainId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/organizations", orgId, "domains"] }),
  });

  const revokeMut = useMutation({
    mutationFn: async (domainId: number) => {
      await apiRequest("DELETE", `/api/admin/organizations/${orgId}/domains/${domainId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/organizations", orgId, "domains"] }),
  });

  const grantedIds = new Set(orgDomains.map((d) => d.id));

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-1 max-w-xs">
        <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Organization</label>
        <select value={orgId} onChange={(e) => setOrgId(e.target.value)}
          className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </div>

      {orgId && (
        <div className="space-y-2">
          <div className="font-terminal text-[8.5px] text-muted-foreground uppercase">
            Domains this org can switch between on their dashboard
          </div>
          <div className="flex flex-wrap gap-2">
            {allDomains.map((d) => {
              const granted = grantedIds.has(d.id);
              return (
                <div
                  key={d.id}
                  className={`flex items-center gap-2 px-3 py-1.5 font-terminal text-[9px] border ${
                    granted ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/5" : "border-border text-muted-foreground"
                  } ${!d.active ? "opacity-40" : ""}`}
                >
                  {d.name}
                  {!d.active && <span className="text-[8px]">(inactive)</span>}
                  {isAdmin && d.active && (
                    granted ? (
                      <button onClick={() => revokeMut.mutate(d.id)} title="Revoke access" className="hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    ) : (
                      <button onClick={() => grantMut.mutate(d.id)} title="Grant access" className="hover:text-[hsl(38,95%,55%)]">
                        <Plus className="w-3 h-3" />
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function OrganizationsTab({ orgs, isAdmin, qc }: { orgs: Organization[]; isAdmin: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/organizations", { name, slug });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      setName(""); setSlug(""); setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to create organization."),
  });

  return (
    <div className="p-4 space-y-4">
      {isAdmin && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name && slug) createMut.mutate(); }}
          className="flex items-end gap-2 p-3 border border-border bg-[#070707]"
        >
          <div className="flex flex-col gap-1">
            <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meridian Capital"
              className="w-48 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="meridian-capital"
              className="w-48 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
          </div>
          <button type="submit" disabled={createMut.isPending}
            className="flex items-center gap-1.5 h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
            <Plus className="w-3 h-3" /> Create
          </button>
          {error && <span className="font-terminal text-[9px] text-red-500 self-center">{error}</span>}
        </form>
      )}

      <table className="w-full font-terminal text-[10px]">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="py-1.5 font-normal uppercase tracking-widest">Name</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Slug</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Status</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Created</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} className="border-b border-border/40">
              <td className="py-1.5 text-foreground">{org.name}</td>
              <td className="py-1.5 text-muted-foreground">{org.slug}</td>
              <td className="py-1.5">
                <span className={org.status === "active" ? "text-green-500" : "text-muted-foreground"}>{org.status.toUpperCase()}</span>
              </td>
              <td className="py-1.5 text-muted-foreground">{new Date(org.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
          {!orgs.length && (
            <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No organizations yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function UsersTab({ orgs, isAdmin, qc }: { orgs: Organization[]; isAdmin: boolean; qc: ReturnType<typeof useQueryClient> }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [userRole, setUserRole] = useState("client_user");
  const [organizationId, setOrganizationId] = useState<string>("");
  const [lastCreated, setLastCreated] = useState<{ email: string; temporaryPassword?: string } | null>(null);
  const [lastReset, setLastReset] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [error, setError] = useState("");

  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/users")).json(),
    enabled: isAdmin,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/users", {
        email, name, role: userRole,
        organizationId: CLIENT_ROLES.includes(userRole) ? Number(organizationId) : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setLastCreated({ email: data.email, temporaryPassword: data.temporaryPassword });
      setEmail(""); setName(""); setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to create user."),
  });

  const resetMut = useMutation({
    mutationFn: async (userId: number) => (await apiRequest("POST", `/api/admin/users/${userId}/reset-password`)).json(),
    onSuccess: (data) => {
      setLastReset({ email: data.email, temporaryPassword: data.temporaryPassword });
      setLastCreated(null);
      setError("");
    },
    onError: (err: any) => setError(err.message || "Failed to reset password."),
  });

  if (!isAdmin) {
    return <div className="p-4 font-terminal text-[10px] text-muted-foreground">User management requires internal_admin.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (email && name && (!CLIENT_ROLES.includes(userRole) || organizationId)) createMut.mutate(); }}
        className="flex flex-wrap items-end gap-2 p-3 border border-border bg-[#070707]"
      >
        <div className="flex flex-col gap-1">
          <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@org.com"
            className="w-44 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="w-36 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Role</label>
          <select value={userRole} onChange={(e) => setUserRole(e.target.value)}
            className="w-40 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
            <option value="client_user">client_user</option>
            <option value="client_admin">client_admin</option>
            <option value="internal_analyst">internal_analyst</option>
            <option value="internal_compliance">internal_compliance</option>
            <option value="internal_admin">internal_admin</option>
          </select>
        </div>
        {CLIENT_ROLES.includes(userRole) && (
          <div className="flex flex-col gap-1">
            <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Organization</label>
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}
              className="w-40 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
              <option value="">Select org...</option>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </div>
        )}
        <button type="submit" disabled={createMut.isPending}
          className="flex items-center gap-1.5 h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
          <Plus className="w-3 h-3" /> Create
        </button>
      </form>

      {error && <div className="font-terminal text-[9px] text-red-500">{error}</div>}
      {lastCreated?.temporaryPassword && (
        <div className="p-3 border border-amber-800/60 bg-amber-950/20 font-terminal text-[9.5px] text-amber-400">
          Account created for <span className="text-foreground font-bold">{lastCreated.email}</span>. Temporary password (shown once): <span className="text-foreground font-bold">{lastCreated.temporaryPassword}</span>
        </div>
      )}
      {lastReset && (
        <div className="p-3 border border-amber-800/60 bg-amber-950/20 font-terminal text-[9.5px] text-amber-400">
          Password reset for <span className="text-foreground font-bold">{lastReset.email}</span>. New temporary password (shown once, copy it now): <span className="text-foreground font-bold">{lastReset.temporaryPassword}</span>
        </div>
      )}

      <table className="w-full font-terminal text-[10px]">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="py-1.5 font-normal uppercase tracking-widest">Email</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Name</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Role</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Org</th>
            <th className="py-1.5 font-normal uppercase tracking-widest">Last Login</th>
            <th className="py-1.5 font-normal uppercase tracking-widest"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border/40">
              <td className="py-1.5 text-foreground">{u.email}</td>
              <td className="py-1.5 text-muted-foreground">{u.name}</td>
              <td className="py-1.5 text-[hsl(186,80%,55%)]">{u.role}</td>
              <td className="py-1.5 text-muted-foreground">{orgs.find((o) => o.id === u.organizationId)?.name ?? "—"}</td>
              <td className="py-1.5 text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  disabled={resetMut.isPending}
                  onClick={() => { if (confirm(`Reset the password for ${u.email}? Their current password will stop working immediately.`)) resetMut.mutate(u.id); }}
                  className="font-terminal text-[8.5px] uppercase tracking-wider text-muted-foreground hover:text-[hsl(38,95%,55%)] border border-border hover:border-[hsl(38,95%,50%)]/50 px-2 py-1"
                >
                  Reset Password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortfoliosTab({ orgs, isAdmin }: { orgs: Organization[]; isAdmin: boolean }) {
  const [orgId, setOrgId] = useState<string>("");
  const [portfolioName, setPortfolioName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null);
  const qc = useQueryClient();

  const { data: portfolios = [] } = useQuery<Portfolio[]>({
    queryKey: ["/api/admin/organizations", orgId, "portfolios"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/organizations/${orgId}/portfolios`)).json(),
    enabled: !!orgId,
  });

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ["/api/admin/portfolios", selectedPortfolioId, "positions"],
    queryFn: async () => (await apiRequest("GET", `/api/admin/portfolios/${selectedPortfolioId}/positions`)).json(),
    enabled: !!selectedPortfolioId,
  });

  const createPortfolioMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/organizations/${orgId}/portfolios`, { name: portfolioName });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/organizations", orgId, "portfolios"] });
      setPortfolioName("");
    },
  });

  const addPositionMut = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/admin/portfolios/${selectedPortfolioId}/positions`, {
        symbol: symbol.toUpperCase(), shares: Number(shares), avgCost: Number(avgCost),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/portfolios", selectedPortfolioId, "positions"] });
      setSymbol(""); setShares(""); setAvgCost("");
    },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-1 max-w-xs">
        <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Organization</label>
        <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setSelectedPortfolioId(null); }}
          className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </div>

      {orgId && (
        <>
          {isAdmin && (
            <form onSubmit={(e) => { e.preventDefault(); if (portfolioName) createPortfolioMut.mutate(); }}
              className="flex items-end gap-2 p-3 border border-border bg-[#070707]">
              <div className="flex flex-col gap-1">
                <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">New portfolio name</label>
                <input value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} placeholder="Growth Portfolio"
                  className="w-56 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none focus:border-[hsl(38,95%,50%)]/50" />
              </div>
              <button type="submit" className="flex items-center gap-1.5 h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
                <Plus className="w-3 h-3" /> Create
              </button>
            </form>
          )}

          <div className="flex gap-2 flex-wrap">
            {portfolios.map((p) => (
              <button key={p.id} onClick={() => setSelectedPortfolioId(p.id)}
                className={`px-3 py-1.5 font-terminal text-[9px] border ${selectedPortfolioId === p.id ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground"}`}>
                {p.name}
              </button>
            ))}
          </div>

          {selectedPortfolioId && (
            <div className="space-y-3">
              {isAdmin && (
                <form onSubmit={(e) => { e.preventDefault(); if (symbol && shares && avgCost) addPositionMut.mutate(); }}
                  className="flex items-end gap-2 p-3 border border-border bg-[#070707]">
                  <div className="flex flex-col gap-1">
                    <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Symbol</label>
                    <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL"
                      className="w-20 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Shares</label>
                    <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="100" type="number"
                      className="w-24 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Avg cost</label>
                    <input value={avgCost} onChange={(e) => setAvgCost(e.target.value)} placeholder="150.50" type="number" step="0.01"
                      className="w-24 bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none" />
                  </div>
                  <button type="submit" className="flex items-center gap-1.5 h-[26px] px-3 bg-[hsl(38,95%,50%)] text-black font-terminal text-[9px] font-bold uppercase tracking-wider">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </form>
              )}

              <table className="w-full font-terminal text-[10px]">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1.5 font-normal uppercase tracking-widest">Symbol</th>
                    <th className="py-1.5 font-normal uppercase tracking-widest">Shares</th>
                    <th className="py-1.5 font-normal uppercase tracking-widest">Avg cost</th>
                    <th className="py-1.5 font-normal uppercase tracking-widest">Market value</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <tr key={pos.id} className="border-b border-border/40">
                      <td className="py-1.5 text-[hsl(38,95%,55%)]">{pos.symbol}</td>
                      <td className="py-1.5 text-foreground">{pos.shares.toLocaleString()}</td>
                      <td className="py-1.5 text-foreground">${pos.avgCost.toFixed(2)}</td>
                      <td className="py-1.5 text-muted-foreground">${(pos.shares * pos.avgCost).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                  {!positions.length && (
                    <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No positions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// BYOD, consultant-facing side (Major Bet, Roadmap Rev.3) -- "reaches the
// client only through the consultant." Read-only mirror of ClientDataPanel.
// tsx's view: pick an org, see what they've uploaded, drill into the same
// deterministic column profile the client themselves sees. Staff never
// uploads here -- that stays a client-initiated action.
interface DatasetListItem {
  id: number;
  fileName: string;
  fileExt: string;
  sheetCount: number;
  totalRows: number;
  createdAt: string;
  uploadedByName: string;
}
interface DatasetColumnProfile {
  name: string;
  inferredType: string;
  totalCount: number;
  nullCount: number;
  uniqueCount: number;
  isLikelyKey: boolean;
  sampleValues: string[];
}
interface DatasetSheetProfile {
  sheetName: string;
  shape: "tabular" | "layout" | "empty";
  tabular: { rowCount: number; columnCount: number; columns: DatasetColumnProfile[] } | null;
  layout: { rowCount: number; columnCount: number; formulaCount: number; detectedModelType: string | null } | null;
}
interface DatasetDetail extends DatasetListItem {
  profile: { sheetNames: string[]; sheets: DatasetSheetProfile[] };
}

function DatasetsTab({ orgs }: { orgs: Organization[] }) {
  const [orgId, setOrgId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);

  const { data: datasets = [] } = useQuery<DatasetListItem[]>({
    queryKey: ["/api/admin/datasets", orgId],
    queryFn: async () => (await apiRequest("GET", `/api/admin/datasets?organizationId=${orgId}`)).json(),
    enabled: !!orgId,
  });

  const toggleExpand = async (item: DatasetListItem) => {
    if (expandedId === item.id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(item.id);
    setActiveSheet(0);
    const res = await apiRequest("GET", `/api/admin/datasets/${item.id}`);
    if (res.ok) setDetail(await res.json());
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-1 max-w-xs">
        <label className="font-terminal text-[8.5px] text-muted-foreground uppercase">Organization</label>
        <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setExpandedId(null); setDetail(null); }}
          className="bg-[#0d0d0d] border border-border px-2 py-1 font-terminal text-[10px] focus:outline-none">
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
        </select>
      </div>

      {orgId && datasets.length === 0 && (
        <div className="p-6 text-center font-terminal text-xs text-muted-foreground border border-dashed border-border">No datasets uploaded by this org yet.</div>
      )}

      {orgId && datasets.length > 0 && (
        <div className="space-y-2">
          {datasets.map((d) => {
            const isExpanded = expandedId === d.id;
            return (
              <div key={d.id} className="border border-border bg-[#070707]">
                <div className="p-3 flex items-center justify-between gap-3 cursor-pointer" onClick={() => toggleExpand(d)}>
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[hsl(38,95%,55%)] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-foreground font-semibold truncate">{d.fileName}</div>
                      <div className="font-terminal text-[9px] text-muted-foreground">{d.sheetCount} sheet{d.sheetCount !== 1 ? "s" : ""} · {d.totalRows.toLocaleString("en-US")} rows · uploaded by {d.uploadedByName} · {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                    </div>
                  </div>
                </div>
                {isExpanded && detail && detail.id === d.id && (
                  <div className="border-t border-border px-3 pb-3">
                    {detail.profile.sheetNames.length > 1 && (
                      <div className="flex gap-1 pt-2 flex-wrap">
                        {detail.profile.sheetNames.map((name, i) => (
                          <button key={name} onClick={() => setActiveSheet(i)}
                            className={`px-2 py-1 font-terminal text-[9px] uppercase border ${activeSheet === i ? "border-[hsl(38,95%,50%)] text-[hsl(38,95%,55%)]" : "border-border text-muted-foreground"}`}>
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                    {(() => {
                      const sheet = detail.profile.sheets[activeSheet];
                      if (!sheet) return null;
                      if (sheet.shape === "empty") return <p className="font-terminal text-[9px] text-muted-foreground py-2">Empty sheet.</p>;
                      if (sheet.shape === "layout" && sheet.layout) {
                        return (
                          <p className="font-terminal text-[10px] text-muted-foreground py-2">
                            Modeling sheet (labels + formulas) — {sheet.layout.rowCount} rows × {sheet.layout.columnCount} columns, {sheet.layout.formulaCount} formulas.
                            {sheet.layout.detectedModelType && <> Likely: <span className="text-foreground">{sheet.layout.detectedModelType}</span></>}
                          </p>
                        );
                      }
                      if (!sheet.tabular) return null;
                      return (
                        <div className="py-2 overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="font-terminal uppercase tracking-wider text-muted-foreground border-b border-border">
                                <th className="text-left px-2 py-1 font-medium">Column</th>
                                <th className="text-left px-2 py-1 font-medium">Type</th>
                                <th className="text-right px-2 py-1 font-medium">Filled</th>
                                <th className="text-right px-2 py-1 font-medium">Unique</th>
                                <th className="text-left px-2 py-1 font-medium">Sample Values</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.tabular.columns.map((c) => (
                                <tr key={c.name} className="border-b border-border/40 last:border-0">
                                  <td className="px-2 py-1.5 text-foreground font-semibold whitespace-nowrap">{c.name}{c.isLikelyKey && <span className="text-[hsl(38,95%,55%)]"> (key)</span>}</td>
                                  <td className="px-2 py-1.5 text-muted-foreground uppercase">{c.inferredType}</td>
                                  <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{c.totalCount - c.nullCount}/{c.totalCount}</td>
                                  <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{c.uniqueCount}</td>
                                  <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[240px]">{c.sampleValues.slice(0, 3).join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
