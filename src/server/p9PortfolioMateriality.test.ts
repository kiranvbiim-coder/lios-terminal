import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioMaterialityResult } from "../client/src/components/terminal/ArtifactPortfolioMateriality";
import type { ArtifactContent } from "@shared/artifactContracts";
import type { P9PortfolioMaterialityAction } from "@shared/p9PortfolioMateriality";
import { p9PortfolioMaterialityOutputSchema } from "@shared/p9PortfolioMateriality";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-portfolio-materiality-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// DB root is captured at module initialization; load the runtime only after setting this test's isolated Home.
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, createArtifactVersion, getArtifact, getArtifactVersion, listArtifactVersions, setArtifactStatus } = await import("./artifactStore");
const { createP9Workflow, listP9Runs, listP9Notifications } = await import("./p9AutomationStore");
const { executeP9Workflow } = await import("./p9AutomationService");
const { requireP9PortfolioMateriality } = await import("./p9PortfolioMateriality");

test("owned P4 values drive durable P9 materiality, quiet jitter, recovery/rebreach and fail-closed custody without providers", { timeout: 120_000 }, async t => {
  await initDb();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("Provider/network calls are forbidden for portfolio materiality."); };
  t.after(async () => { globalThis.fetch = originalFetch; await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner, foreign] = await getDb().insert(users).values([
    { name: "Portfolio owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "verification-only", role: "internal_admin" as const, organizationId: null },
    { name: "Foreign owner", email: `${crypto.randomUUID()}@example.test`, passwordHash: "verification-only", role: "internal_admin" as const, organizationId: null },
  ]).returning();
  assert.ok(owner && foreign);
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const other = { userId: foreign.id, organizationId: null, role: foreign.role };
  const project = await createProject(ctx, { name: "Owned portfolio materiality" });
  const anotherProject = await createProject(ctx, { name: "Other owned Project" });
  const asOf = new Date(Date.now() - 60_000).toISOString();
  const content = (values = [2500, 2500, 2500, 2500], overrides: Record<string, unknown> = {}): Extract<ArtifactContent, { kind: "portfolio" }> => ({
    kind: "portfolio", portfolioRef: "owned-materiality-book", summary: { portfolioId: "owned-materiality-book", name: "Explicit values", asOf, baseCurrency: "USD", cash: 500, ...overrides }, risk: {},
    holdings: values.map((marketValue, index) => ({ symbol: ["AAA", "BBB", "CCC", "DDD"][index], quantity: 10, marketValue, currency: "USD" })),
  });
  const make = async (portfolio = content()) => createArtifact(ctx, { projectId: project.id, title: "Explicit retained portfolio", content: portfolio, sourceRefs: ["user:owned-portfolio-values"] });
  const book = await make();
  const actionFor = (artifactId: string, version: number, contentHash: string): P9PortfolioMaterialityAction => ({
    kind: "portfolio_materiality", acceptedArtifact: { artifactId, version, contentHash }, weightChangePercentagePoints: 10, concentrationPercent: 40, rearmBufferPercentagePoints: 2, maximumAgeMinutes: 1440,
  });
  const action = actionFor(book.artifact.id, book.version.version, book.version.contentHash);
  const workflow = await createP9Workflow(ctx, project.id, {
    name: "Explicit portfolio thresholds", template: "custom", enabled: false, trigger: { type: "manual" }, action,
    notificationPolicy: { notifyOn: ["condition_met"], cooldownMinutes: 0, suppressUnchanged: true },
  });
  const run = () => executeP9Workflow({ workflow, ctx, triggerType: "manual" });
  const update = async (next: Extract<ArtifactContent, { kind: "portfolio" }>, sourceRefs?: string[]) => {
    const head = await getArtifact(ctx, book.artifact.id);
    return createArtifactVersion(ctx, { artifactId: head.id, baseVersion: head.headVersion, content: next, ...(sourceRefs ? { sourceRefs } : {}) });
  };
  await t.test("baseline and immaterial jitter are quiet; one material breach delivers once and re-arms only on recovery", async () => {
    const baseline = await run();
    assert.equal(baseline.error, null);
    assert.equal(baseline.result?.changed, false);
    assert.equal(baseline.notification?.status, "suppressed");
    await update(content([2520, 2480, 2500, 2500]));
    const jitter = await run();
    assert.equal(jitter.error, null);
    assert.equal(jitter.result?.conditionMet, false);
    assert.equal(jitter.notification?.status, "suppressed");
    await update(content([4300, 1900, 1900, 1900]));
    const concurrent = await Promise.all([run(), run()]);
    assert.ok(concurrent.every(item => item.error === null));
    assert.deepEqual(concurrent.map(item => item.notification?.status).sort(), ["delivered", "suppressed"], "same source evidence is admitted once even with zero cooldown and concurrent runs");
    const material = concurrent.find(item => item.notification?.status === "delivered")!;
    const evidence = p9PortfolioMaterialityOutputSchema.parse(material.result?.output);
    assert.equal(evidence.grossExposure, 10000);
    assert.equal(evidence.maximumConcentrationPercent, 43);
    assert.equal(evidence.maximumWeightChangePercentagePoints, 18);
    assert.equal(evidence.cashExcluded, 500);
    assert.equal(evidence.transitions.filter(item => item.transition === "breached").length, 2);
    assert.equal(evidence.acceptedArtifact.contentHash, book.version.contentHash);
    assert.equal(evidence.currentArtifact.version, 3);
    const visible = renderToStaticMarkup(createElement(PortfolioMaterialityResult, { output: evidence }));
    assert.match(visible, /Maximum concentration: 43%/);
    assert.match(visible, /weight drift: 18 percentage points/);
    assert.match(visible, /concentration breached/);
    assert.ok(visible.includes(book.version.contentHash), "Automations evidence exposes the actual accepted custody hash");
    const persistent = await run();
    assert.equal(persistent.result?.changed, false);
    assert.equal(persistent.notification?.status, "suppressed");
    await update(content([3990, 2000, 2000, 2010]));
    const boundaryJitter = await run();
    assert.equal(boundaryJitter.result?.conditionMet, false);
    assert.equal(p9PortfolioMaterialityOutputSchema.parse(boundaryJitter.result?.output).states.find(state => state.symbol === "AAA")?.concentration, "breached", "crossing just below threshold does not re-arm inside hysteresis");
    await update(content());
    const recovery = await run();
    assert.equal(recovery.result?.changed, false);
    assert.equal(recovery.notification?.status, "suppressed");
    assert.equal(p9PortfolioMaterialityOutputSchema.parse(recovery.result?.output).transitions.filter(item => item.transition === "recovered").length, 2);
    await update(content([4300, 1900, 1900, 1900]));
    const rebreach = await run();
    assert.equal(rebreach.result?.conditionMet, true);
    assert.equal(rebreach.notification?.status, "delivered");
    assert.equal((await run()).notification?.status, "suppressed");
    assert.equal((await getArtifact(ctx, book.artifact.id)).headVersion, 6, "monitor never changes owner state");
    assert.equal((await listArtifactVersions(ctx, book.artifact.id)).length, 6);
    assert.equal((await listP9Notifications(ctx, project.id)).filter(notification => notification.workflowId === workflow.id && notification.status === "delivered").length, 2, "concurrent first breach and later rebreach each deliver once");
  });
  await t.test("foreign Project/owner, stale values, mixed currency, missing value, invalid freshness and wrong baseline hash are denied", async () => {
    await assert.rejects(requireP9PortfolioMateriality(other, project.id, action), /not found|not owned/i);
    await assert.rejects(requireP9PortfolioMateriality(ctx, anotherProject.id, action), /owned PortfolioArtifact|Project/i);
    const freshHead = await getArtifactVersion(ctx, book.artifact.id);
    const freshAction = actionFor(book.artifact.id, freshHead.version, freshHead.contentHash);
    await assert.rejects(requireP9PortfolioMateriality(ctx, project.id, { ...freshAction, acceptedArtifact: { ...freshAction.acceptedArtifact, contentHash: "0".repeat(64) } }), /hash|custody/i);
    await assert.rejects(requireP9PortfolioMateriality(ctx, project.id, action), /head changed/i);
    await assert.rejects(requireP9PortfolioMateriality(ctx, project.id, { ...freshAction, rearmBufferPercentagePoints: 10 }), /buffer/i);
    const invalid = [
      content(undefined, { asOf: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
      content(undefined, { asOf: new Date(Date.now() + 86_400_000).toISOString() }),
      content(undefined, { cash: Number.POSITIVE_INFINITY }),
      content(undefined, { portfolioId: undefined }),
      { ...content(), holdings: [{ symbol: "AAA", quantity: 1, currency: "EUR", marketValue: 100 }] },
      { ...content(), holdings: [{ symbol: "AAA", quantity: 1, currency: "USD", marketPrice: 100 }] },
      content([0, 0, 0, 0]),
    ];
    for (const invalidContent of invalid) {
      // P4 may already reject a nonfinite field; otherwise P9 must reject it at admission.
      await assert.rejects(async () => {
        const invalidBook = await make(invalidContent);
        await createP9Workflow(ctx, project.id, { name: "Must refuse invalid portfolio", trigger: { type: "manual" }, action: actionFor(invalidBook.artifact.id, 1, invalidBook.version.contentHash) });
      });
    }
  });
  await t.test("source drift, regressed asOf and archived lifecycle fail visibly without changing portfolio head", async () => {
    await update(content(), ["user:different-source"]);
    const drift = await run();
    assert.match(drift.error ?? "", /source identity|custody drifted/i);
    assert.equal(drift.result, null);
    // Reaccept the current source, then stale/regressed data must not borrow its earlier output.
    const head = await getArtifactVersion(ctx, book.artifact.id);
    const second = await createP9Workflow(ctx, project.id, { name: "Reaccepted source", enabled: false, trigger: { type: "manual" }, action: actionFor(book.artifact.id, head.version, head.contentHash) });
    assert.equal((await executeP9Workflow({ workflow: second, ctx, triggerType: "manual" })).error, null);
    await update(content(undefined, { asOf: new Date(Date.parse(asOf) - 60_000).toISOString() }));
    assert.match((await executeP9Workflow({ workflow: second, ctx, triggerType: "manual" })).error ?? "", /asOf regressed/i);
    await setArtifactStatus(ctx, book.artifact.id, "archived");
    assert.match((await executeP9Workflow({ workflow: second, ctx, triggerType: "manual" })).error ?? "", /active owned/i);
  });
  await t.test("cash is excluded and opposing lots aggregate by absolute exposure; generic Finance acceptance remains strict", async () => {
    const lots = await make({ ...content(), holdings: [
      { symbol: "AAA", quantity: 2, marketValue: 300, currency: "USD" },
      { symbol: "aaa", quantity: -1, marketValue: -200, currency: "USD" },
      { symbol: "BBB", quantity: 1, marketValue: 500, currency: "USD" },
    ] });
    const lotsAction = actionFor(lots.artifact.id, 1, lots.version.contentHash);
    const monitor = await createP9Workflow(ctx, project.id, { name: "Gross lots", trigger: { type: "manual" }, action: lotsAction, notificationPolicy: { notifyOn: ["condition_met"], cooldownMinutes: 0 } });
    const first = await executeP9Workflow({ workflow: monitor, ctx, triggerType: "manual" });
    assert.equal(first.error, null);
    const output = p9PortfolioMaterialityOutputSchema.parse(first.result?.output);
    assert.equal(output.grossExposure, 1000);
    assert.deepEqual(output.positions.map(position => [position.symbol, position.weightPercent]), [["AAA", 50], ["BBB", 50]]);
    assert.equal(first.result?.changed, false, "explicit baseline concentrations are not new breaches");
    await assert.rejects(createP9Workflow(ctx, project.id, { name: "Cannot weaken Finance template", template: "portfolio_monitor", trigger: { type: "manual" }, action: lotsAction }), /saved conversation rerun/i);
  });
  assert.equal(fetches, 0, "all real P4/P9 transitions use retained data without provider/network calls");
});
