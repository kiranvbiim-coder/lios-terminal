"use strict";

/**
 * WS-05 diagnostic capture. This is the existing synthetic visual fixture,
 * NOT a signed-in app, canonical P4 journey or installed target.
 *
 * From src/: run npx vite --host 127.0.0.1 --port 4173 --strictPort
 * Then: npx electron script/ws05_visual_baseline_capture.cjs
 * Output: ignored visual-smoke-artifacts/ws05-baseline (never overwritten).
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { prepareVisualSmokeOutput } = require("./prepare_visual_smoke_output.cjs");
const { captureCases, captureFilename, assessSample, summarize } = require("./ws05_visual_baseline_core.cjs");

const DEFAULT_URL = "http://127.0.0.1:4173/visual-smoke.html";
const WAIT_TIMEOUT_MS = 15000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Serialize only purpose-built local fixture functions: no cookie, profile,
// credential, provider, storage or real conversation introspection.
function evaluate(window, fn, ...args) {
  const parameters = args.map((item) => JSON.stringify(item)).join(",");
  return window.webContents.executeJavaScript("(" + fn.toString() + ")(" + parameters + ")", true);
}

function validateFixtureUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.pathname !== "/visual-smoke.html") {
    throw new Error("WS05 captures only local /visual-smoke.html synthetic fixture, never user sessions");
  }
  return parsed;
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 5000,
    }).trim();
  } catch { return "UNVERIFIED_LOCAL_SHA"; }
}

async function selectCase(window, smokeCase) {
  await evaluate(window, (nextCase) => {
    window.dispatchEvent(new CustomEvent("lios-visual-smoke-state", {
      detail: { smokeCase: nextCase, density: "standard" },
    }));
  }, smokeCase);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const actual = await evaluate(window, () => {
      const root = document.querySelector("[data-visual-smoke-ready]");
      const main = document.querySelector("[data-ux-flagship-smoke]");
      const workbench = document.querySelector("[data-real-workbench-smoke]");
      return {
        ready: root?.dataset.visualSmokeReady === "true",
        mainCase: main?.getAttribute("data-ux-flagship-smoke"),
        workbenchNarrow: workbench?.getAttribute("data-workbench-narrow"),
      };
    });
    if (actual.ready &&
        (actual.mainCase === smokeCase ||
         (smokeCase === "workbench-real" && actual.workbenchNarrow === "false") ||
         (smokeCase === "workbench-real-narrow" && actual.workbenchNarrow === "true"))) return;
    await sleep(150);
  }
  throw new Error("Fixture did not become ready for " + smokeCase);
}

async function geometry(window) {
  return evaluate(window, () => {
    const root = document.querySelector("[data-visual-smoke-ready]");
    const surface = document.querySelector("[data-ux-flagship-smoke]") ||
                    document.querySelector("[data-real-workbench-smoke]");
    const primary = document.querySelector("[data-ux-flagship-smoke] section.min-w-0.flex-1");
    return {
      rootPresent: Boolean(root),
      ready: root?.dataset.visualSmokeReady === "true",
      expectedSurfacePresent: Boolean(surface),
      cssViewportWidth: window.innerWidth,
      cssViewportHeight: window.innerHeight,
      rootWidth: root?.getBoundingClientRect().width ?? 0,
      rootScrollWidth: root?.scrollWidth ?? 0,
      documentScrollWidth: document.documentElement.scrollWidth,
      primaryContentWidth: primary?.getBoundingClientRect().width ?? 0,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  });
}

async function nativeTab(window) {
  await evaluate(window, () => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  window.focus();
  window.webContents.focus();
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
  await sleep(120);
  return evaluate(window, () => {
    const active = document.activeElement;
    const bounds = active?.getBoundingClientRect?.();
    return {
      attempted: true,
      focusedTag: active?.tagName || null,
      focusedLabel: active?.getAttribute?.("aria-label") ||
        active?.textContent?.trim().slice(0, 80) || null,
      inViewport: Boolean(bounds && bounds.width > 0 && bounds.height > 0 &&
        bounds.left >= -1 && bounds.top >= -1 &&
        bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1),
    };
  });
}

async function screenshot(window, filename) {
  let lastError = null;
  for (let n = 1; n <= 3; n += 1) {
    try {
      const image = await window.webContents.capturePage();
      if (image.isEmpty()) throw new Error("Empty screenshot");
      return image;
    } catch (error) {
      lastError = error;
      if (n < 3) {
        window.showInactive();
        await sleep(250 * n);
      }
    }
  }
  throw new Error("Screenshot failed for " + filename + ": " + String(lastError));
}

async function run() {
  const url = validateFixtureUrl(process.env.LIOS_VISUAL_SMOKE_URL || DEFAULT_URL);
  const output = prepareVisualSmokeOutput("LIOS_WS05_OUTPUT_DIR", "visual-smoke-artifacts/ws05-baseline");
  const samples = [];
  const rendererErrors = [];
  let fatalError = null;
  let window = null;
  try {
    window = new BrowserWindow({
      width: 1440, height: 900, show: true, backgroundColor: "#030303",
      webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: true },
    });
    window.webContents.on("render-process-gone", (_event, details) =>
      rendererErrors.push("Renderer gone: " + details.reason));
    window.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) rendererErrors.push(message.slice(0, 512));
    });
    url.searchParams.set("case", "conversation");
    url.searchParams.set("density", "standard");
    await window.loadURL(url.href);

    let previous = null;
    for (const config of captureCases()) {
      const name = captureFilename(config);
      const record = { ...config, name, screenshot: name, type: "deterministic-fixture" };
      try {
        if (config.smokeCase !== previous) {
          await selectCase(window, config.smokeCase);
          previous = config.smokeCase;
        }
        window.webContents.setZoomFactor(config.zoom);
        window.setContentSize(config.width, config.height);
        await sleep(250);
        Object.assign(record, await geometry(window));
        record.focusTest = config.smokeCase === "conversation-artifact"
          ? await nativeTab(window) : { attempted: false, notApplicable: true };
        const image = await screenshot(window, name);
        record.screenshotNonEmpty = !image.isEmpty();
        record.imagePixelDimensions = image.getSize();
        fs.writeFileSync(path.join(output, name), image.toPNG());
        record.assessment = assessSample(record);
      } catch (error) {
        record.assessment = {
          status: "capture-error",
          gaps: [error instanceof Error ? error.message : String(error)],
        };
      }
      samples.push(record);
      console.log("[WS05] " + name + ": " + record.assessment.status +
        (record.assessment.gaps.length ? " — " + record.assessment.gaps.join("; ") : ""));
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.message : String(error);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    const result = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      repositoryHead: gitHead(),
      source: "existing local LiOS visual-smoke fixture (NOT authenticated installed app)",
      fixtureUrl: url.origin + "/visual-smoke.html",
      screenshotPrivacy: "synthetic fixture only; no user sessions or provider responses",
      platform: process.platform,
      cases: samples,
      summary: summarize(samples),
      rendererErrors,
      fatalError,
    };
    fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(result, null, 2) + "\n");
    console.log("[WS05] Manifest: " + path.join(output, "manifest.json"));
  }
  if (fatalError || rendererErrors.length || samples.length !== captureCases().length ||
      samples.some((s) => s.assessment.status !== "fixture-probes-pass")) {
    throw new Error("WS05 diagnostic gaps or errors: inspect manifest.json. This is NOT a product release gate.");
  }
}

app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
