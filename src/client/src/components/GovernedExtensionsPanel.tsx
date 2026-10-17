import { useEffect, useState } from "react";
import type { ExtensionCatalog, ExtensionPreview, LocalExtensionInput } from "@shared/p13ExtensionContracts";
import { LOCAL_EXTENSION_MAX_BYTES } from "@shared/p13ExtensionContracts";

async function extensionRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/extensions${path}`, { method: body === undefined ? "GET" : "POST", credentials: "include", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result ? String(result.error) : "Extension request failed.");
  return result as T;
}

/** The existing P13/P11 authorities are the catalog; selecting a file never installs or executes it. */
export default function GovernedExtensionsPanel() {
  const [catalog, setCatalog] = useState<ExtensionCatalog | null>(null);
  const [preview, setPreview] = useState<ExtensionPreview | null>(null);
  const [inspection, setInspection] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rights, setRights] = useState(false);
  const [consent, setConsent] = useState(false);
  const [publicKeyPem, setPublicKeyPem] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [trustConsent, setTrustConsent] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ kind: "p13" | "p11"; id: string; digest: string; version?: string } | null>(null);
  useEffect(() => {
    let live = true;
    void extensionRequest<ExtensionCatalog>("").then(value => { if (live) setCatalog(value); }).catch(reason => { if (live) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => { live = false; };
  }, []);

  async function action(run: () => Promise<void>) {
    setBusy(true); setError("");
    try { await run(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Extension operation failed."); } finally { setBusy(false); }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    await action(async () => {
      if (file.size > LOCAL_EXTENSION_MAX_BYTES) throw new Error("Choose a local package no larger than 8 MiB.");
      if (preview) await extensionRequest("/cancel", { previewId: preview.previewId });
      setPreview(null); setInspection(null); setRights(false); setConsent(false); setPublicKeyPem(""); setFingerprint(""); setTrustConsent(false);
      let input: LocalExtensionInput;
      if (file.name.endsWith(".lios-pack")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
        input = { kind: "p11", archiveBase64: btoa(binary) };
      } else {
        input = JSON.parse(await file.text()) as LocalExtensionInput;
      }
      setPreview(await extensionRequest<ExtensionPreview>("/preview", input));
    });
  }

  return <section aria-label="Governed extensions" className="space-y-4 rounded-lg border border-border p-4">
    <div><h2 className="font-semibold">Governed Finance extensions</h2><p className="text-sm text-muted-foreground">Inspect existing runtime contributions or import an approved local package. No public vendor catalog, downloads or automatic installation. Package signatures do not establish independent publisher identity, license or data/model/API rights.</p></div>
    <p className="text-sm">P13 declarative plugins are active only for this Home process session. Restart removes imported adapters and publisher trust; reimport and review to activate again. P11 archives are stored inactive and never executed by this screen.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!catalog ? <p className="text-sm">{error ? "Extension management requires the current unlocked Home owner administrator." : "Loading canonical runtime catalog…"}</p> : <>
      <label className="block text-sm">Import owner-supplied local package (.json P13 envelope or .lios-pack archive)
        <input type="file" accept=".json,.lios-pack" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} className="mt-2 block w-full" />
      </label>
      <details className="text-sm"><summary>Package format and rights</summary><p>P13 JSON contains kind: p13, a signed manifest and payloadBase64 holding the exact publisher-signed bytes. The server computes SHA-256 from these bytes, never from a claimed digest. Only signed, trusted declarative Artifact/skill contributions can activate here; connectors, executable tools and agents require a separately provisioned supervised broker and remain unavailable. Obtain the publisher Ed25519 public key separately and compare its full SPKI SHA-256 fingerprint through a trusted channel. Only import packages you have rights to use; source, binaries, data, models and external APIs have separate rights. No package installs its dependencies automatically.</p></details>
      <div className="space-y-3"><h3 className="font-medium">Installed P13 contributions</h3>
        {catalog.plugins.length === 0 && <p className="text-sm text-muted-foreground">No plugins registered in this Home runtime.</p>}
        {catalog.plugins.map(plugin => <article key={plugin.id} className="rounded border p-3 text-sm space-y-2">
          <p className="font-medium">{plugin.manifest.name} · {plugin.version}</p><p>{plugin.id} · {plugin.manifest.publisher} · {plugin.trust.state}</p>
          <p className="break-all">Package SHA-256: {plugin.trust.packageDigest ?? "No observed package digest"}</p>
          <p>Permissions: {plugin.manifest.permissions.join(", ") || "None"}</p>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void action(async () => { setInspection(await extensionRequest(`/inspect?kind=p13&id=${encodeURIComponent(plugin.id)}`)); setRevokeTarget(null); })} className="rounded border px-3 py-1">Inspect contributions and trust</button>
            {plugin.trust.packageDigest && <button type="button" disabled={busy} onClick={() => setRevokeTarget({ kind: "p13", id: plugin.id, digest: plugin.trust.packageDigest! })} className="rounded border px-3 py-1">Review revocation</button>}
          </div>
          {plugin.manifest.skills.map(skill => <button key={skill.componentId} type="button" className="mr-2 rounded border px-3 py-1" onClick={() => void action(async () => { setInspection(await extensionRequest(`/inspect?kind=p13&id=${encodeURIComponent(plugin.id)}`)); })}>Inspect registered skill: {skill.name}</button>)}
          {plugin.manifest.artifacts.map(artifact => <button key={artifact.componentId} type="button" className="mr-2 rounded border px-3 py-1" onClick={() => void action(async () => { setInspection(await extensionRequest(`/inspect?kind=p13&id=${encodeURIComponent(plugin.id)}`)); })}>Inspect registered Artifact support: {artifact.name}</button>)}
        </article>)}
      </div>
      <div className="space-y-2"><h3 className="font-medium">Local P11 packs</h3><p className="text-sm text-muted-foreground">Verified local storage only. Executable activation is unavailable without its canonical supervised runtime adapter; installed does not mean enabled.</p>
        {catalog.packs.length === 0 && <p className="text-sm">No locally imported P11 packs.</p>}
        {catalog.packs.flatMap(pack => pack.versions.map(version => <article key={`${pack.packId}@${version.version}`} className="rounded border p-3 text-sm"><p>{pack.packId} · {version.version} · {version.state} · {version.lastHealth}</p><button type="button" disabled={busy} className="rounded border px-3 py-1" onClick={() => void action(async () => { const result = await extensionRequest<{ manifest: { integrity: { manifestSha256: string } } | null }>(`/inspect?kind=p11&id=${encodeURIComponent(pack.packId)}&version=${encodeURIComponent(version.version)}`); setInspection(result); setRevokeTarget(result.manifest && pack.activeVersion !== version.version ? { kind: "p11", id: pack.packId, version: version.version, digest: result.manifest.integrity.manifestSha256 } : null); })}>Inspect / review removal</button></article>))}
      </div>
    </>}
    {preview && <section aria-label="Exact local package review" className="space-y-3 rounded border p-3 text-sm">
      <h3 className="font-semibold">Review exact local package</h3><p>{preview.manifest?.id ?? "Unrecognized package"} · {preview.kind} · {preview.byteLength} bytes · {preview.trust}</p>
      <p className="break-all">Package bytes SHA-256: {preview.packageDigest}</p><p className="break-all">Signed manifest SHA-256: {preview.manifestDigest}</p><p className="break-all">Publisher key: {preview.publisherKeyId ?? "Unsigned"} · fingerprint: {preview.publisherFingerprint ?? "Not trusted"}</p>
      <p>Activation: {preview.activation === "inactive_only" ? "Verified storage only; no executable activation" : preview.activation}. Review expires {preview.expiresAt}.</p>
      <details open><summary>Signed manifest, signature, permissions, tools, dependencies and compatibility</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.manifest, null, 2)}</pre></details>
      {preview.reasons.map(reason => <p key={reason} className="text-destructive">{reason}</p>)}
      {preview.publisherKeyId && !["trusted", "revoked"].includes(preview.trust) && <fieldset className="space-y-2 rounded border p-3"><legend>Explicit publisher trust</legend>
        <label className="block">Publisher Ed25519 public key (PEM)<textarea className="mt-1 block w-full rounded border bg-background p-2" rows={3} value={publicKeyPem} onChange={event => { setPublicKeyPem(event.target.value); setFingerprint(""); setTrustConsent(false); }} /></label>
        <button type="button" disabled={busy || !publicKeyPem} className="rounded border px-3 py-1" onClick={() => void action(async () => { const key = await extensionRequest<{ fingerprint: string }>("/publisher-key/preview", { publicKeyPem }); setFingerprint(key.fingerprint); })}>Inspect full key fingerprint</button>
        {fingerprint && <><p className="break-all">SPKI SHA-256: {fingerprint}</p><label className="flex gap-2"><input type="checkbox" checked={trustConsent} onChange={event => setTrustConsent(event.target.checked)} />I verified this full key fingerprint independently and choose to trust this publisher key for this Home session. This choice is not independent publisher or rights verification by LiOS.</label><button type="button" disabled={busy || !trustConsent} className="rounded border px-3 py-1" onClick={() => void action(async () => { setPreview(await extensionRequest<ExtensionPreview>("/publisher-key/consent", { previewId: preview.previewId, reviewHash: preview.reviewHash, publicKeyPem, fingerprint, trustPublisher: true })); setConsent(false); setRights(false); setTrustConsent(false); })}>Trust exact key and recheck package</button></>}
      </fieldset>}
      <label className="flex gap-2"><input type="checkbox" disabled={!preview.installable || busy} checked={rights} onChange={event => setRights(event.target.checked)} />I have reviewed the package licenses/notices and hold the separate code, data, model and API rights required for my use.</label>
      <label className="flex gap-2"><input type="checkbox" disabled={!preview.installable || busy} checked={consent} onChange={event => setConsent(event.target.checked)} />I consent to this exact digest, signed manifest, permissions and contributions {preview.activation === "inactive_only" ? "being stored inactive without execution" : "being registered in this Home runtime session"}. No Decision or external-action approval is granted.</label>
      <button type="button" disabled={busy || !preview.installable || !rights || !consent} className="rounded border px-3 py-1" onClick={() => void action(async () => { await extensionRequest("/install", { previewId: preview.previewId, reviewHash: preview.reviewHash, packageDigest: preview.packageDigest, consent: true, rightsConfirmed: true }); setPreview(null); setCatalog(await extensionRequest<ExtensionCatalog>("")); })}>{preview.activation === "inactive_only" ? "Install verified inactive pack" : "Activate reviewed declarative contributions"}</button>
      <button type="button" disabled={busy} className="ml-2 rounded border px-3 py-1" onClick={() => void action(async () => { await extensionRequest("/cancel", { previewId: preview.previewId }); setPreview(null); })}>Cancel and discard bytes</button>
    </section>}
    {inspection !== null && <details open><summary>Canonical installed contribution inspection</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-xs">{JSON.stringify(inspection, null, 2)}</pre></details>}
    {revokeTarget && <section aria-label="Confirm extension revocation" className="space-y-2 rounded border p-3 text-sm"><h3 className="font-semibold">Revoke {revokeTarget.id}{revokeTarget.version ? `@${revokeTarget.version}` : ""}?</h3><p className="break-all">Exact digest: {revokeTarget.digest}</p><p>{revokeTarget.kind === "p13" ? "This removes current adapters and dependent plugin adapters, disposes brokers through P13, and revokes this package digest for the session. Saved Artifacts are not deleted." : "This removes this exact inactive package through P11. Active executable packages cannot be removed here."}</p><button type="button" disabled={busy} className="rounded border px-3 py-1" onClick={() => void action(async () => { await extensionRequest("/revoke", { ...revokeTarget, revoke: true }); setRevokeTarget(null); setInspection(null); setCatalog(await extensionRequest<ExtensionCatalog>("")); })}>Confirm exact revocation</button><button type="button" disabled={busy} className="ml-2 rounded border px-3 py-1" onClick={() => setRevokeTarget(null)}>Keep installed</button></section>}
  </section>;
}
