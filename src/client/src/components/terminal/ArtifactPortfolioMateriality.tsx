import React, { useRef, useState } from "react";
import { p9PortfolioMaterialityActionSchema, p9PortfolioMaterialityOutputSchema, portfolioMaterialityPayload, validatePortfolioMaterialityThresholds } from "@shared/p9PortfolioMateriality";
import type { ArtifactDetail } from "@/lib/useArtifacts";
import { createP9Workflow, useInvalidateP9Automation } from "@/lib/useP9Automation";

export default function ArtifactPortfolioMateriality({ detail, blocked = false }: { detail: ArtifactDetail; blocked?: boolean }) {
  const { artifact, version } = detail;
  const [weight, setWeight] = useState("5");
  const [concentration, setConcentration] = useState("40");
  const [buffer, setBuffer] = useState("1");
  const [age, setAge] = useState("1440");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const invalidate = useInvalidateP9Automation();
  const currentHead = artifact.kind === "portfolio" && artifact.status === "active" && artifact.trashedAt === null && version.version === artifact.headVersion;
  const identity = `${artifact.id}:${version.version}:${version.contentHash}`;
  const [acceptedIdentity, setAcceptedIdentity] = useState(identity);
  const displayed = useRef(identity);
  displayed.current = identity;
  // Bind explicit acceptance to this exact rendered revision, never to a later head.
  const acceptanceMatches = accepted && acceptedIdentity === identity;
  let eligibilityError: string | null = null;
  try { portfolioMaterialityPayload(version.content); }
  catch (error) { eligibilityError = error instanceof Error ? error.message : "Portfolio metadata or explicit holding values are invalid."; }
  const save = async () => {
    if (artifact.projectId === null) { setMessage("Project monitors require a Project. This Chat Artifact remains saved here."); return; }
    if (pending.current || !currentHead || blocked || !acceptanceMatches || eligibilityError) return;
    const capturedIdentity = identity;
    pending.current = true; setBusy(true); setMessage(null);
    try {
      const action = p9PortfolioMaterialityActionSchema.parse({
        kind: "portfolio_materiality", acceptedArtifact: { artifactId: artifact.id, version: version.version, contentHash: version.contentHash },
        weightChangePercentagePoints: Number(weight), concentrationPercent: Number(concentration), rearmBufferPercentagePoints: Number(buffer), maximumAgeMinutes: Number(age),
      });
      validatePortfolioMaterialityThresholds(action);
      await createP9Workflow(artifact.projectId, {
        schemaVersion: "1", name: `${artifact.title.slice(0, 140)} · materiality`, template: "custom", enabled: true,
        description: "Read-only retained PortfolioArtifact gross-exposure concentration and accepted-baseline weight drift. No quote/FX fetch, holdings transmission, trade, or Decision mutation.",
        trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } }, action,
        notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["failure", "condition_met"], cooldownMinutes: 0, suppressUnchanged: true, minimumRelevanceScore: 0.5 },
        sourceRefs: [], engineRefs: ["lios.portfolio-materiality.v1"], artifactRefs: [artifact.id],
      });
      invalidate(artifact.projectId);
      if (displayed.current === capturedIdentity) {
        setAccepted(false);
        setMessage("Portfolio materiality monitor saved in Automations. Run now or wait for hourly observation. Only new breaches notify; recovery re-arms. Existing baseline concentrations do not generate new alerts.");
      }
    } catch (error) {
      if (displayed.current === capturedIdentity) setMessage(error instanceof Error ? error.message : "Portfolio monitor could not be saved.");
    } finally { pending.current = false; setBusy(false); }
  };
  const inputClass = "mt-1 block w-full rounded border border-border/50 bg-[#090909] px-3 py-2 disabled:opacity-40";
  return <section aria-label="Portfolio materiality monitor" data-testid="artifact-portfolio-materiality" aria-busy={busy} className="space-y-3 rounded-lg border border-cyan-300/25 p-3">
    <h3 className="text-sm font-semibold">Monitor portfolio materiality · read only</h3>
    <p className="text-sm text-muted-foreground">Uses explicit retained marketValue values, not live prices. Summary must supply portfolioId, name, asOf, baseCurrency and cash. Every holding must have the same currency. Save edits first; current ownership, source lineage, hash, head and freshness are checked on the server.</p>
    <p className="text-sm text-muted-foreground">Gross securities exposure = sum of absolute holding market values, aggregating lots by symbol without netting shorts. Cash is disclosed but excluded. Concentration is percent of gross exposure; weight change is absolute percentage-point drift from this accepted baseline. No provider/FX calls, holdings transmission, trade, application of changes or Decision mutation.</p>
    {!currentHead && <p role="alert" className="text-sm text-amber-200">Open the active current PortfolioArtifact head before accepting a baseline.</p>}
    {blocked && <p role="alert" className="text-sm text-amber-200">Save pending portfolio edits before creating a monitor.</p>}
    {eligibilityError && <p role="alert" className="break-words text-sm text-amber-200">Monitoring unavailable: {eligibilityError}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Weight change threshold (percentage points)<input aria-label="Portfolio weight change percentage points" type="number" min="0.01" max="100" step="any" value={weight} disabled={busy} onChange={event => { setWeight(event.target.value); setAccepted(false); }} className={inputClass}/></label>
      <label className="text-sm">Symbol concentration threshold (% gross)<input aria-label="Portfolio concentration percent" type="number" min="0.01" max="100" step="any" value={concentration} disabled={busy} onChange={event => { setConcentration(event.target.value); setAccepted(false); }} className={inputClass}/></label>
      <label className="text-sm">Re-arm buffer (percentage points)<input aria-label="Portfolio rearm buffer percentage points" type="number" min="0.01" max="100" step="any" value={buffer} disabled={busy} onChange={event => { setBuffer(event.target.value); setAccepted(false); }} className={inputClass}/></label>
      <label className="text-sm">Maximum retained value age (minutes)<input aria-label="Portfolio maximum age minutes" type="number" min="1" max="10080" step="1" value={age} disabled={busy} onChange={event => { setAge(event.target.value); setAccepted(false); }} className={inputClass}/></label>
    </div>
    <p className="text-xs text-muted-foreground">A breach persists until its metric is at or below threshold minus re-arm buffer; small boundary jitter stays quiet. Persistent breaches are not resent. Freshness is checked against the saved portfolio asOf; stale data fails visibly rather than being repriced.</p>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label="Accept portfolio materiality baseline" checked={acceptanceMatches} disabled={busy || blocked || !currentHead || eligibilityError !== null} onChange={event => { setAccepted(event.target.checked); setAcceptedIdentity(identity); }}/><span>I accept saved portfolio v{version.version} as the fixed weight baseline and these thresholds. Hourly observations follow only its owned canonical descendant revisions.</span></label>
    <p className="break-all text-xs text-muted-foreground">Baseline custody: {artifact.id} · v{version.version} · {version.contentHash}</p>
    <button type="button" data-testid="save-portfolio-materiality-monitor" disabled={busy || blocked || !currentHead || !acceptanceMatches || eligibilityError !== null} onClick={() => void save()} className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40">{busy ? "Saving monitor…" : "Save hourly portfolio materiality monitor"}</button>
    {message && <p role="status" className="break-words text-sm text-muted-foreground">{message}</p>}
  </section>;
}

export function PortfolioMaterialityResult({ output }: { output: Record<string, unknown> }) {
  const [page, setPage] = useState(0);
  const parsed = p9PortfolioMaterialityOutputSchema.safeParse(output);
  if (!parsed.success) return <p role="alert" className="text-xs text-amber-200">Portfolio materiality evidence is unavailable or invalid.</p>;
  const result = parsed.data;
  const pageSize = 40;
  const lastPage = Math.max(0, Math.ceil(result.states.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const positions = new Map(result.positions.map(position => [position.symbol, position]));
  const states = result.states.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section aria-label="Portfolio materiality evidence" data-testid="portfolio-materiality-result" className="space-y-2 text-xs">
    <p>Read-only retained values as of {result.asOf}. No live pricing, FX, transmission or trading.</p>
    <p>Gross securities exposure: {result.grossExposure} {result.baseCurrency}. Cash excluded: {result.cashExcluded} {result.baseCurrency}. Maximum concentration: {result.maximumConcentrationPercent}%; maximum accepted-baseline weight drift: {result.maximumWeightChangePercentagePoints} percentage points.</p>
    <p className="break-all">Accepted baseline: {result.acceptedArtifact.artifactId} v{result.acceptedArtifact.version} · {result.acceptedArtifact.contentHash}</p>
    <p className="break-all">Observed head: v{result.currentArtifact.version} · {result.currentArtifact.contentHash}</p>
    <ul>{result.transitions.map(item => <li key={`${item.symbol}:${item.metric}`}>{item.symbol} · {item.metric} {item.transition} · current weight {item.currentPercent}% · baseline weight {item.baselinePercent}% · threshold {item.threshold}{item.metric === "weight_change" ? " percentage points" : "% gross"}</li>)}</ul>
    {!result.transitions.length && <p>No new threshold transition. Persistent breaches and immaterial jitter stay quiet.</p>}
    <table className="w-full text-left"><caption className="text-left">Symbol weights (% gross securities exposure) and re-arm states · {result.states.length} symbols</caption><thead><tr><th>Symbol</th><th>Gross value</th><th>Weight %</th><th>Concentration</th><th>Weight drift</th></tr></thead><tbody>{states.map(state => <tr key={state.symbol}><th scope="row">{state.symbol}</th><td>{positions.get(state.symbol)?.grossMarketValue ?? 0}</td><td>{positions.get(state.symbol)?.weightPercent ?? 0}</td><td>{state.concentration}</td><td>{state.weightChange}</td></tr>)}</tbody></table>
    <div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous symbols</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next symbols</button></div>
  </section>;
}
