import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, LockKeyhole, Save, ShieldCheck, Users, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { DECISION_PERMISSIONS, DECISION_ROLE_CEILINGS, type EnterprisePolicy, type EnterpriseRole } from "@shared/enterpriseContracts";

interface OrganizationOption { id: number; name: string; slug: string; status: string; }
interface Props { orgs: OrganizationOption[]; isAdmin: boolean; }
interface Overview {
  organization: OrganizationOption;
  policy: { policy: EnterprisePolicy; revision: number; updatedAt: string | null };
  users: Array<{ id: number; email: string; name: string; role: string; active: boolean; lastLoginAt: string | null }>;
  seatUsage: { active: number; total: number; configuredLimit: number | null; remaining: number | null };
  license: { status: string; planId: number | null; seatsPurchased: number } | null;
  devices: { total: number; authorized: number; pending: number; revoked: number };
  readiness: { localControlsReady: boolean; blockers: string[]; checks: Array<{ id: string; label: string; status: string; detail: string }> };
}

const inputClass = "w-full border border-border bg-black/40 px-2 py-1.5 font-terminal text-[9px] text-foreground focus:border-emerald-400/70 focus:outline-none";
const labelClass = "font-terminal text-[8px] uppercase tracking-widest text-muted-foreground";

function clonePolicy(policy: EnterprisePolicy): EnterprisePolicy {
  return JSON.parse(JSON.stringify(policy)) as EnterprisePolicy;
}

export default function EnterpriseGovernancePanel({ orgs, isAdmin }: Props) {
  const [orgId, setOrgId] = useState("");
  const [draft, setDraft] = useState<EnterprisePolicy | null>(null);
  const [message, setMessage] = useState("");
  const qc = useQueryClient();
  const selectedOrgId = orgId || String(orgs[0]?.id ?? "");
  const { data: overview, isLoading, isError } = useQuery<Overview>({
    queryKey: ["/api/enterprise/organizations", selectedOrgId],
    queryFn: async () => (await apiRequest("GET", `/api/enterprise/organizations/${selectedOrgId}`)).json(),
    enabled: Boolean(selectedOrgId),
  });

  useEffect(() => { setDraft(overview ? clonePolicy(overview.policy.policy) : null); }, [overview?.policy.revision]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Select an organization first.");
      return (await apiRequest("PUT", `/api/enterprise/organizations/${selectedOrgId}/policy`, draft)).json() as Promise<Overview["policy"]>;
    },
    onSuccess: (record) => { setMessage(`Saved policy revision ${record.revision}.`); qc.invalidateQueries({ queryKey: ["/api/enterprise/organizations", selectedOrgId] }); },
    onError: (error: Error) => setMessage(error.message || "Could not save policy."),
  });

  const roleSummary = useMemo(() => draft ? (Object.entries(draft.roles.grants) as Array<[EnterpriseRole, EnterprisePolicy["roles"]["grants"][EnterpriseRole]]>).map(([role, permissions]) => ({ role, permissions, count: permissions.length })) : [], [draft]);
  const patch = <K extends keyof EnterprisePolicy>(key: K, value: EnterprisePolicy[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const patchNested = <K extends keyof EnterprisePolicy, P extends keyof EnterprisePolicy[K]>(key: K, nested: P, value: EnterprisePolicy[K][P]) => setDraft((current) => current ? { ...current, [key]: { ...(current[key] as object), [nested]: value } } as EnterprisePolicy : current);
  const patchDecisionGrant = (role: EnterpriseRole, permission: typeof DECISION_PERMISSIONS[number], enabled: boolean) => {
    setDraft((current) => {
      if (!current || !DECISION_ROLE_CEILINGS[role].includes(permission)) return current;
      const grants = current.roles.grants[role].filter((grant) => grant !== permission);
      if (enabled) grants.push(permission);
      return { ...current, roles: { grants: { ...current.roles.grants, [role]: grants } } };
    });
  };

  if (!orgs.length) return <div className="p-5 font-terminal text-[10px] text-muted-foreground">Create an organization before configuring enterprise governance.</div>;

  return (
    <div className="h-full overflow-y-auto bg-[#050505] p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2 font-terminal text-[11px] tracking-[0.2em] text-emerald-300"><ShieldCheck className="h-4 w-4" /> ENTERPRISE GOVERNANCE</div>
          <p className="mt-1 max-w-3xl font-ui text-[10px] text-muted-foreground">Tenant-scoped organization, policy, sharing, retention, device, and deployment controls. SSO and private deployment show explicit readiness; they are never simulated.</p>
        </div>
        <select aria-label="Enterprise organization" value={selectedOrgId} onChange={(event) => setOrgId(event.target.value)} className="border border-border bg-black px-2 py-1.5 font-terminal text-[9px] text-foreground">
          {orgs.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.slug}</option>)}
        </select>
      </div>

      {isLoading && <div className="font-terminal text-[9px] text-muted-foreground">LOADING TENANT POLICY…</div>}
      {isError && <div className="font-terminal text-[9px] text-rose-300">POLICY READ FAILED — check internal access and tenant state.</div>}
      {overview && draft && <>
        <div className="mb-4 grid gap-2 md:grid-cols-4">
          <Metric icon={<Users className="h-3 w-3" />} label="ACTIVE SEATS" value={`${overview.seatUsage.active}${overview.seatUsage.configuredLimit === null ? "" : ` / ${overview.seatUsage.configuredLimit}`}`} />
          <Metric icon={<Building2 className="h-3 w-3" />} label="ORG STATUS" value={overview.organization.status.toUpperCase()} />
          <Metric icon={<LockKeyhole className="h-3 w-3" />} label="DEVICES" value={`${overview.devices.authorized} authorized · ${overview.devices.pending} pending`} />
          <Metric icon={overview.readiness.localControlsReady ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} label="LOCAL READINESS" value={overview.readiness.localControlsReady ? "READY" : `${overview.readiness.blockers.length} EXTERNAL GATES`} tone={overview.readiness.localControlsReady ? "text-emerald-300" : "text-amber-300"} />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <section className="border border-border bg-[#080808] p-3"><SectionTitle title="SEATS & ROLE POLICY" /><div className="grid gap-2 sm:grid-cols-2">
            <Field label="MAX SEATS"><input className={inputClass} type="number" min="1" value={draft.seats.maxSeats ?? ""} placeholder="license limit" onChange={(event) => patchNested("seats", "maxSeats", event.target.value ? Number(event.target.value) : null)} disabled={!isAdmin} /></Field>
            <Toggle label="SELF JOIN" value={draft.seats.allowSelfJoin} onChange={(value) => patchNested("seats", "allowSelfJoin", value)} disabled={!isAdmin} />
            <Toggle label="ADMIN APPROVAL" value={draft.seats.requireAdminApproval} onChange={(value) => patchNested("seats", "requireAdminApproval", value)} disabled={!isAdmin} />
            <Field label="ALLOWED EMAIL DOMAINS"><input className={inputClass} value={draft.seats.allowedEmailDomains.join(", ")} placeholder="example.com" onChange={(event) => patchNested("seats", "allowedEmailDomains", splitList(event.target.value))} disabled={!isAdmin} /></Field>
          </div><div className="mt-3 grid gap-1 sm:grid-cols-2">{roleSummary.map((row) => <div key={row.role} className="flex justify-between border border-border/60 px-2 py-1 font-terminal text-[8px]"><span>{row.role}</span><span className="text-emerald-300">{row.count} grants</span></div>)}</div></section>

          <section className="border border-border bg-[#080808] p-3"><SectionTitle title="DECISION SECURITY-ROLE GRANTS" />
            <p className="mb-3 font-ui text-[10px] text-muted-foreground">Organization policy may reduce, never widen, security-role authority. Read is also required for authoring and review. Personas do not grant access. Changes invalidate prior review bindings; review does not execute trades or accept Artifact proposals.</p>
            <div className="space-y-2">{roleSummary.map((row) => <div key={row.role} className="border border-border/60 p-2">
              <div className="mb-2 font-terminal text-[9px]">{row.role}</div>
              <div className="grid gap-2 sm:grid-cols-3">{DECISION_PERMISSIONS.map((permission) => <Toggle key={permission}
                label={`${permission.replace("_decisions", "").toUpperCase()}${DECISION_ROLE_CEILINGS[row.role].includes(permission) ? "" : " · ROLE DENIED"}`}
                value={DECISION_ROLE_CEILINGS[row.role].includes(permission) && row.permissions.includes(permission)}
                disabled={!isAdmin || !DECISION_ROLE_CEILINGS[row.role].includes(permission)}
                onChange={(enabled) => patchDecisionGrant(row.role, permission, enabled)} />)}</div>
            </div>)}</div>
          </section>
          <section className="border border-border bg-[#080808] p-3"><SectionTitle title="CONNECTOR & AI POLICY" /><div className="grid gap-2 sm:grid-cols-2">
            <Field label="ALLOWED CONNECTORS"><input className={inputClass} value={draft.connectors.allowedConnectorIds.join(", ")} placeholder="empty = none" onChange={(event) => patchNested("connectors", "allowedConnectorIds", splitList(event.target.value))} disabled={!isAdmin} /></Field>
            <Field label="ALLOWED AI PROVIDERS"><input className={inputClass} value={draft.ai.allowedProviders.join(", ")} placeholder="provider IDs" onChange={(event) => patchNested("ai", "allowedProviders", splitList(event.target.value))} disabled={!isAdmin} /></Field>
            <Toggle label="PRIVATE CONNECTORS" value={draft.connectors.allowPrivateConnections} onChange={(value) => patchNested("connectors", "allowPrivateConnections", value)} disabled={!isAdmin} />
            <Toggle label="AI EXTERNAL DATA" value={draft.ai.allowExternalData} onChange={(value) => patchNested("ai", "allowExternalData", value)} disabled={!isAdmin} />
            <Toggle label="CONNECTOR APPROVAL" value={draft.connectors.requireAdminApproval} onChange={(value) => patchNested("connectors", "requireAdminApproval", value)} disabled={!isAdmin} />
            <Toggle label="AI APPROVAL" value={draft.ai.requireApproval} onChange={(value) => patchNested("ai", "requireApproval", value)} disabled={!isAdmin} />
          </div></section>

          <section className="border border-border bg-[#080808] p-3"><SectionTitle title="WORKSPACE, NETWORK & EXPORT" /><div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="ORG WORKSPACE SHARING" value={draft.workspaces.allowOrganizationSharing} onChange={(value) => patchNested("workspaces", "allowOrganizationSharing", value)} disabled={!isAdmin} />
            <Toggle label="EXTERNAL WORKSPACE SHARING" value={draft.workspaces.allowExternalSharing} onChange={(value) => patchNested("workspaces", "allowExternalSharing", value)} disabled={!isAdmin} />
            <Toggle label="PUBLIC PROFILES" value={draft.network.allowPublicProfiles} onChange={(value) => patchNested("network", "allowPublicProfiles", value)} disabled={!isAdmin} />
            <Toggle label="PUBLIC POSTS" value={draft.network.allowPublicPosts} onChange={(value) => patchNested("network", "allowPublicPosts", value)} disabled={!isAdmin} />
            <Toggle label="USER EXPORT" value={draft.retention.allowUserExport} onChange={(value) => patchNested("retention", "allowUserExport", value)} disabled={!isAdmin} />
            <Toggle label="LEGAL HOLD" value={draft.retention.legalHold} onChange={(value) => patchNested("retention", "legalHold", value)} disabled={!isAdmin} />
            <Field label="EXPORT FORMATS"><input className={inputClass} value={draft.retention.allowedExportFormats.join(", ")} onChange={(event) => patchNested("retention", "allowedExportFormats", splitList(event.target.value).filter((value): value is "csv" | "json" | "xlsx" | "pdf" => ["csv", "json", "xlsx", "pdf"].includes(value)))} disabled={!isAdmin} /></Field>
            <Field label="AUDIT RETENTION DAYS"><input className={inputClass} type="number" min="1" value={draft.retention.auditDays ?? ""} placeholder="unbounded" onChange={(event) => patchNested("retention", "auditDays", event.target.value ? Number(event.target.value) : null)} disabled={!isAdmin} /></Field>
          </div></section>

          <section className="border border-border bg-[#080808] p-3"><SectionTitle title="SSO, DEVICES & DEPLOYMENT" /><div className="grid gap-2 sm:grid-cols-2">
            <Field label="SSO MODE"><select className={inputClass} value={draft.sso.mode} onChange={(event) => patchNested("sso", "mode", event.target.value as EnterprisePolicy["sso"]["mode"])} disabled={!isAdmin}><option value="disabled">DISABLED</option><option value="oidc">OIDC CONTRACT</option><option value="saml">SAML CONTRACT</option></select></Field>
            <Field label="DEPLOYMENT MODE"><select className={inputClass} value={draft.deployment.mode} onChange={(event) => patchNested("deployment", "mode", event.target.value as EnterprisePolicy["deployment"]["mode"])} disabled={!isAdmin}><option value="local">LOCAL</option><option value="hosted">HOSTED</option><option value="private_cloud">PRIVATE CLOUD</option><option value="isolated">ISOLATED</option></select></Field>
            <Toggle label="REQUIRE DEVICE AUTH" value={draft.devices.requireAuthorization} onChange={(value) => patchNested("devices", "requireAuthorization", value)} disabled={!isAdmin} />
            <Field label="DEVICE LEASE DAYS"><input className={inputClass} type="number" min="1" max="3650" value={draft.devices.leaseDays} onChange={(event) => patchNested("devices", "leaseDays", Number(event.target.value) || 1)} disabled={!isAdmin} /></Field>
          </div><p className="mt-2 font-terminal text-[8px] leading-relaxed text-amber-200/80">SSO/provider handshakes and hosted/private deployment are represented as contract/readiness states. No credentials or fake connectivity are stored here.</p></section>
        </div>

        <div className="mt-3 border border-border bg-[#080808] p-3"><SectionTitle title="READINESS & BLOCKERS" />
          <div className="grid gap-1 md:grid-cols-2">{overview.readiness.checks.map((check) => <div key={check.id} className="border border-border/60 px-2 py-1.5"><div className="flex items-center justify-between font-terminal text-[8px]"><span>{check.label}</span><span className={check.status === "ready" || check.status === "configured" ? "text-emerald-300" : check.status === "external" ? "text-amber-300" : "text-rose-300"}>{check.status.toUpperCase()}</span></div><div className="mt-1 font-ui text-[9px] text-muted-foreground">{check.detail}</div></div>)}</div>
          {overview.readiness.blockers.length > 0 && <div className="mt-2 space-y-1 font-terminal text-[8px] text-amber-200">{overview.readiness.blockers.map((blocker) => <div key={blocker}>• {blocker}</div>)}</div>}
        </div>

        <div className="mt-3 flex items-center justify-end gap-3"><span className="font-terminal text-[9px] text-muted-foreground" role="status">{message}</span><button className="flex items-center gap-2 border border-emerald-400/70 px-3 py-1.5 font-terminal text-[9px] tracking-widest text-emerald-300 disabled:opacity-40" disabled={!isAdmin || save.isPending} onClick={() => save.mutate()}><Save className="h-3 w-3" /> {save.isPending ? "SAVING…" : "SAVE POLICY"}</button></div>
      </>}
    </div>
  );
}

function splitList(value: string): string[] { return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 200); }
function SectionTitle({ title }: { title: string }) { return <div className="mb-3 font-terminal text-[9px] tracking-[0.16em] text-emerald-300">{title}</div>; }
function Metric({ icon, label, value, tone = "text-foreground" }: { icon: React.ReactNode; label: string; value: string; tone?: string }) { return <div className="border border-border bg-[#080808] p-2"><div className="flex items-center gap-1 font-terminal text-[7px] tracking-widest text-muted-foreground">{icon}{label}</div><div className={`mt-1 font-terminal text-[11px] ${tone}`}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="flex flex-col gap-1"><span className={labelClass}>{label}</span>{children}</label>; }
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className="flex items-center justify-between gap-2 border border-border/60 px-2 py-1.5"><span className={labelClass}>{label}</span><input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /></label>; }
