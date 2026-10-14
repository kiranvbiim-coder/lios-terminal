const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { prepareVisualSmokeOutput } = require("./prepare_visual_smoke_output.cjs");

const baseUrl = process.env.LIOS_VISUAL_SMOKE_URL || "http://127.0.0.1:4173/visual-smoke.html";
const outputDirName = "visual-smoke-artifacts";
const cases = [
  ["market-standard", "market", "standard"],
  ["breadth-standard", "breadth", "standard"],
  ["news-standard", "news", "standard"],
  ["watchlist-compact", "watchlist", "compact"],
  ["watchlist-standard", "watchlist", "standard"],
  ["watchlist-comfortable", "watchlist", "comfortable"],
  ["layout-2-standard", "layout-2", "standard"],
  ["layout-3-standard", "layout-3", "standard"],
  ["layout-4-standard", "layout-4", "standard"],
  ["workbench-real-standard", "workbench-real", "standard"],
  ["workbench-real-narrow-standard", "workbench-real-narrow", "standard"],
  ["project-home-standard", "project-home", "standard"],
  ["conversation-standard", "conversation", "standard"],
  ["conversation-artifact-standard", "conversation-artifact", "standard"],
  ["workspace-focus-standard", "workspace-focus", "standard"],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(window) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(
      "document.querySelector('[data-visual-smoke-ready=\"true\"]') !== null",
      true,
    );
    if (ready) return;
    await sleep(200);
  }
  throw new Error("Visual smoke harness did not become ready within 15 seconds");
}

async function setSmokeState(window, smokeCase, density) {
  const marker = `${smokeCase.toUpperCase()} · ${density.toUpperCase()}`;
  await window.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent("lios-visual-smoke-state", { detail: ${JSON.stringify({ smokeCase, density })} }));`,
    true,
  );

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('[data-visual-smoke-ready]');
      return {
        ready: root?.dataset.visualSmokeReady === "true",
        density: root?.dataset.density || null,
        marker: root?.textContent?.includes(${JSON.stringify(marker)}) || false,
      };
    })()`, true);
    if (state.ready && state.density === density && state.marker) return;
    await sleep(150);
  }
  throw new Error(`Visual smoke harness did not become ready for ${smokeCase}/${density} within 15 seconds`);
}

async function assertWorkbenchInvariants(window, name, smokeCase) {
  if (smokeCase !== "workbench-real" && smokeCase !== "workbench-real-narrow") return null;
  const narrow = smokeCase === "workbench-real-narrow";
  const result = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-visual-smoke-ready]');
    const fixture = document.querySelector('[data-real-workbench-smoke="true"]');
    const dock = document.querySelector('[data-workspace-engine="dockview"]');
    const manager = document.querySelector('[data-workspaces-manager="true"]');
    const workspaceBody = document.querySelector('[data-workspaces-body="true"]');
    const orientationShells = document.querySelectorAll('.lios-phase2-workbench').length;
    if (!root || !fixture || !dock || !manager || !workspaceBody) return { missing: true, orientationShells };
    const rr = root.getBoundingClientRect();
    const fr = fixture.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const mr = manager.getBoundingClientRect();
    const inside = (child, parent) =>
      child.left >= parent.left - 1 && child.top >= parent.top - 1 &&
      child.right <= parent.right + 1 && child.bottom <= parent.bottom + 1;
    return {
      missing: false,
      orientationShells,
      root: { width: rr.width, height: rr.height, scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight },
      fixture: { width: fr.width, height: fr.height },
      dock: { width: dr.width, height: dr.height },
      manager: { width: mr.width, height: mr.height },
      workspaceBodyDirection: getComputedStyle(workspaceBody).flexDirection,
      dockInsideFixture: inside(dr, fr),
      managerInsideDock: inside(mr, dr),
    };
  })()`, true);

  if (result.missing) throw new Error(`Missing real Workbench smoke surface in ${name}`);
  if (result.orientationShells !== 0) throw new Error(`Competing Workbench orientation shell rendered in ${name}`);
  if (!result.dockInsideFixture || !result.managerInsideDock) {
    throw new Error(`Workbench containment failure in ${name}: ${JSON.stringify(result)}`);
  }
  if (result.dock.height < 700 || result.manager.width < 300 || result.manager.height < 300) {
    throw new Error(`Workbench usable-area regression in ${name}: ${JSON.stringify(result)}`);
  }
  if (!narrow && result.dock.width < 1000) {
    throw new Error(`Standard Workbench width regression in ${name}: ${JSON.stringify(result)}`);
  }
  if (narrow && (result.manager.width >= 620 || result.workspaceBodyDirection !== "column")) {
    throw new Error(`Narrow Workspaces did not reflow inside its pane in ${name}: ${JSON.stringify(result)}`);
  }
  if (result.root.scrollWidth > result.root.width + 1 || result.root.scrollHeight > result.root.height + 1) {
    throw new Error(`Workbench root overflow in ${name}: ${JSON.stringify(result)}`);
  }
  return result;
}

async function capturePageWithRetry(window, name) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const image = await window.webContents.capturePage();
      if (image.isEmpty()) throw new Error(`Captured empty image for ${name}`);
      return image;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Desktop smoke capture ${name} failed on attempt ${attempt}/3: ${detail}`);
      if (attempt < 3) {
        if (!window.isDestroyed()) {
          window.showInactive();
          window.focus();
        }
        await sleep(250 * attempt);
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to capture desktop smoke surface ${name} after 3 attempts: ${detail}`);
}

async function run() {
  const outputDir = prepareVisualSmokeOutput("LIOS_VISUAL_SMOKE_OUTPUT_DIR", outputDirName);

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: "#030303",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.setContentSize(1440, 900);

  const renderErrors = [];
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) renderErrors.push(message);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    renderErrors.push(`render-process-gone: ${details.reason}`);
  });

  const firstCase = cases[0];
  await window.loadURL(`${baseUrl}?case=${encodeURIComponent(firstCase[1])}&density=${encodeURIComponent(firstCase[2])}`);
  await waitForReady(window);

  try {
    for (const [name, smokeCase, density] of cases) {
      // Keep one renderer alive and switch fixture state in-page. Repeated
      // navigations make Chromium's macOS compositor intermittently return
      // UnknownVizError on constrained self-hosted runners.
      await setSmokeState(window, smokeCase, density);
      await sleep(900);
      await assertWorkbenchInvariants(window, name, smokeCase);

      const image = await capturePageWithRetry(window, name);
      const size = image.getSize();
      if (size.width < 1200 || size.height < 700) {
        throw new Error(`Unexpected screenshot size for ${name}: ${size.width}x${size.height}`);
      }
      fs.writeFileSync(path.join(outputDir, `${name}.png`), image.toPNG());
    }

    fs.writeFileSync(
      path.join(outputDir, "manifest.json"),
      JSON.stringify({ viewport: "1440x900", cases: cases.map(([name, smokeCase, density]) => ({ name, smokeCase, density })) }, null, 2),
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }

  if (renderErrors.length) {
    throw new Error(`Renderer reported errors:\n${renderErrors.join("\n")}`);
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
