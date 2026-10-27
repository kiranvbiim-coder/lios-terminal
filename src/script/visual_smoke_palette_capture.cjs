"use strict";

/**
 * Local-only Electron visual capture (NOT a signed-app or production test).
 * Starts against an already-running, local visual-smoke Vite URL.
 * Reuses LiOS's pre-existing renderer fixture and output safety mechanism.
 *
 * Usage from src/:
 *   npm run visual:palette:capture
 *   LIOS_PALETTE_SMOKE_OUTPUT_DIR=/new/evidence/path npm run visual:palette:capture
 * No external provider, user account, or private native release CI required.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { prepareVisualSmokeOutput } = require("./prepare_visual_smoke_output.cjs");
const { PALETTES, paletteSpecs, validateFrame } = require("./palette_smoke_contract.cjs");

const evidenceDirKey = "LIOS_PALETTE_SMOKE_OUTPUT_DIR";
const baseUrl = process.env.LIOS_VISUAL_SMOKE_URL || "http://127.0.0.1:4173/visual-smoke.html";

function localFixtureUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Palette visual smoke only accepts a local HTTP fixture URL");
  }
  if (!url.pathname.endsWith("/visual-smoke.html")) {
    throw new Error("Palette visual smoke requires the existing visual-smoke.html fixture");
  }
  return url;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForCase(window, spec) {
  const limit = Date.now() + 20000;
  while (Date.now() < limit) {
    if (window.isDestroyed()) throw new Error("Visual smoke renderer exited");
    const state = await window.webContents.executeJavaScript(
      "(() => { const root = document.querySelector('[data-visual-smoke-ready]');" +
      " return { ready: root?.dataset.visualSmokeReady === 'true'," +
      " palette: root?.dataset.visualSmokePalette," +
      " density: root?.dataset.density," +
      " marker: root?.textContent?.includes(" +
      JSON.stringify(spec.smokeCase.toUpperCase() + " · STANDARD") + ") }; })()",
      true,
    );
    if (state.ready && state.palette === spec.palette && state.density === "standard" && state.marker) {
      // Font availability/fallbacks must have settled before taking a screenshot.
      await Promise.race([
        window.webContents.executeJavaScript("document.fonts.ready.then(() => true)", true),
        sleep(10000).then(() => { throw new Error("Fixture fonts did not settle"); }),
      ]);
      return;
    }
    await sleep(150);
  }
  throw new Error("Visual smoke fixture did not render " + spec.name);
}

async function activateCase(window, spec) {
  window.setContentSize(spec.width, spec.height);
  await window.webContents.executeJavaScript(
    "window.dispatchEvent(new CustomEvent('lios-visual-smoke-state', {detail:" +
    JSON.stringify({ smokeCase: spec.smokeCase, density: "standard" }) + "}));",
    true,
  );
  await waitForCase(window, spec);
  await sleep(200); // let Chromium flush the compositor after the React ready marker
}

async function inspectFrame(window, spec) {
  const raw = await window.webContents.executeJavaScript(
    "(() => {" +
    " const html = document.documentElement;" +
    " const root = document.querySelector('[data-visual-smoke-ready]');" +
    " const styles = getComputedStyle(html);" +
    " const fixture = document.querySelector('[data-ux-flagship-smoke]');" +
    " const dock = document.querySelector('[data-workspace-engine=\"dockview\"]');" +
    " const asHex = (rgb) => {" +
    "   const match = rgb && rgb.match(/^rgba?\\((\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/i);" +
    "   return match ? '#' + match.slice(1, 4).map(v => Number(v).toString(16).padStart(2, '0')).join('') : null;" +
    " };" +
    " const rr = root?.getBoundingClientRect();" +
    " return {" +
    "   palette: html.getAttribute('data-lios-palette')," +
    "   theme: html.getAttribute('data-theme')," +
    "   ready: root?.dataset.visualSmokeReady === 'true'," +
    "   surface: fixture?.dataset.uxFlagshipSmoke || (document.querySelector('[data-real-workbench-smoke=\"true\"]') ? 'workbench-real' : null)," +
    "   width: rr ? Math.round(rr.width) : null," +
    "   height: rr ? Math.round(rr.height) : null," +
    "   scrollWidth: root?.scrollWidth ?? null," +
    "   scrollHeight: root?.scrollHeight ?? null," +
    "   background: styles.getPropertyValue('--lios-bg-app').trim().toLowerCase()," +
    "   primary: styles.getPropertyValue('--lios-text-primary').trim().toLowerCase()," +
    "   secondary: styles.getPropertyValue('--lios-text-secondary').trim().toLowerCase()," +
    "   surfaceBackgroundHex: root ? asHex(getComputedStyle(root).backgroundColor) : null," +
    "   realDockMounted: Boolean(dock)," +
    "   dockWidth: dock ? Math.round(dock.getBoundingClientRect().width) : null," +
    " };" +
    "})()", true,
  );
  return { ...raw, requestedCase: spec.smokeCase };
}

async function capture(window, name) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const image = await window.webContents.capturePage();
      if (image.isEmpty()) throw new Error("Empty screenshot");
      const png = image.toPNG();
      if (png.length < 500) throw new Error("Suspiciously small screenshot");
      return png;
    } catch (error) {
      last = error;
      console.warn("Palette smoke capture retry " + (attempt + 1) + " for " + name);
      if (attempt < 2) {
        window.showInactive();
        await sleep(250 * (attempt + 1));
      }
    }
  }
  throw new Error("Screenshot failed: " + name + ": " + String(last));
}

async function run() {
  const local = localFixtureUrl(baseUrl);
  const directory = prepareVisualSmokeOutput(evidenceDirKey, "palette-smoke-artifacts");
  const specs = paletteSpecs();
  const manifest = {
    qualification: "SOURCE_FIXTURE_ONLY__NATIVE_RELEASE_NOT_RUN",
    generatedAtUtc: new Date().toISOString(),
    buildSha: process.env.LIOS_SMOKE_COMMIT_SHA || null,
    matrix: { themes: PALETTES, count: specs.length },
    frames: [],
    result: "INCOMPLETE",
  };
  const rendererErrors = [];
  let window = null;

  try {
    for (const palette of PALETTES) {
      const cases = specs.filter((spec) => spec.palette === palette);
      // New window per palette avoids fragile repeated macOS navigation and
      // guarantees a fresh renderer with a deterministic query-string theme.
      window = new BrowserWindow({
        width: 1440, height: 900, show: true,
        backgroundColor: "#09090b",
        webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
      });
      window.setContentSize(1440, 900);
      window.webContents.on("console-message", (_event, level, message) => {
        if (level >= 3) rendererErrors.push({ palette, message });
      });
      window.webContents.on("render-process-gone", (_event, details) => {
        rendererErrors.push({ palette, message: "render-process-gone: " + details.reason });
      });
      const url = new URL(local);
      url.searchParams.set("case", cases[0].smokeCase);
      url.searchParams.set("density", "standard");
      url.searchParams.set("palette", palette);
      await window.loadURL(url.href);

      for (const spec of cases) {
        await activateCase(window, spec);
        const observed = await inspectFrame(window, spec);
        const audit = validateFrame(spec, observed);
        // Always retain a screenshot for review even on a visual audit failure.
        const png = await capture(window, spec.name);
        fs.writeFileSync(path.join(directory, spec.name + ".png"), png, { flag: "wx" });
        manifest.frames.push({
          ...spec, file: spec.name + ".png",
          sha256: createHash("sha256").update(png).digest("hex"),
          observed, audit,
        });
        if (!audit.passed) console.error("Palette audit FAILED " + spec.name + ": " + audit.failures.join(", "));
      }
      window.destroy();
      window = null;
    }
    manifest.result = manifest.frames.every((frame) => frame.audit.passed) &&
      rendererErrors.length === 0 ? "SOURCE_FIXTURES_PASSED" : "SOURCE_FIXTURES_FAILED";
  } catch (error) {
    manifest.result = "INCOMPLETE";
    manifest.error = String(error);
    throw error;
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    manifest.rendererErrors = rendererErrors;
    // Never overwrite previous evidence or fake completeness on errors.
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  }
  if (manifest.result !== "SOURCE_FIXTURES_PASSED") {
    throw new Error("One or more palette screenshot audits failed. Inspect manifest.json and PNGs.");
  }
  console.log("Captured " + manifest.frames.length + " source fixture screenshots in " + directory);
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
