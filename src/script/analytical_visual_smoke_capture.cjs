const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { prepareVisualSmokeOutput } = require("./prepare_visual_smoke_output.cjs");

const baseUrl = process.env.LIOS_ANALYTICAL_VISUAL_SMOKE_URL || "http://127.0.0.1:4173/analytical-visual-smoke.html";
const outputDirName = "analytical-visual-smoke-artifacts";
const cases = [
  { name: "quote-1440x900", smokeCase: "quote", width: 1440, height: 900, ready: "[data-quote-overview]" },
  { name: "quote-1366x768", smokeCase: "quote", width: 1366, height: 768, ready: "[data-quote-overview]" },
  { name: "quote-split-720x768", smokeCase: "quote", width: 720, height: 768, ready: "[data-quote-overview]" },
  { name: "quote-mobile-430x800", smokeCase: "quote", width: 430, height: 800, ready: "[data-quote-overview]" },
  { name: "economics-1440x900", smokeCase: "economics", width: 1440, height: 900, ready: "[data-macro-overview]" },
  { name: "economics-1366x768", smokeCase: "economics", width: 1366, height: 768, ready: "[data-macro-overview]" },
  { name: "economics-split-720x768", smokeCase: "economics", width: 720, height: 768, ready: "[data-macro-overview]" },
  { name: "economics-mobile-430x800", smokeCase: "economics", width: 430, height: 800, ready: "[data-macro-overview]" },
  { name: "quant-1440x900", smokeCase: "quant", width: 1440, height: 900, ready: "[data-quant-lab]" },
  { name: "quant-1366x768", smokeCase: "quant", width: 1366, height: 768, ready: "[data-quant-lab]" },
  { name: "quant-split-720x768", smokeCase: "quant", width: 720, height: 768, ready: "[data-quant-lab]" },
  { name: "quant-mobile-430x800", smokeCase: "quant", width: 430, height: 800, ready: "[data-quant-lab]" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadUrlWithRetry(window, url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await window.loadURL(url);
      return;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`Analytical smoke navigation ${label} failed on attempt ${attempt}/3: ${detail}`);
      if (attempt < 3) await sleep(250 * attempt);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed to load analytical smoke case ${label} after 3 attempts: ${detail}`);
}

async function waitForReady(window, selector) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)}) !== null`,
      true,
    );
    if (ready) return;
    await sleep(150);
  }
  throw new Error(`Analytical visual smoke did not render ${selector} within 15 seconds`);
}

async function assertNoRootOverflow(window, name) {
  const result = await window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-analytical-smoke-root]');
    if (!root) return { missing: true };
    return {
      missing: false,
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  })()`, true);
  if (result.missing) throw new Error(`Missing analytical smoke root for ${name}`);
  if (result.scrollWidth > result.clientWidth + 1 || result.bodyScrollWidth > result.bodyClientWidth + 1) {
    throw new Error(`Horizontal page overflow in ${name}: root ${result.scrollWidth}/${result.clientWidth}, body ${result.bodyScrollWidth}/${result.bodyClientWidth}`);
  }
  return result;
}

async function run() {
  const outputDir = prepareVisualSmokeOutput("LIOS_ANALYTICAL_VISUAL_SMOKE_OUTPUT_DIR", outputDirName);
  const manifest = [];
  const renderErrors = [];
  const first = cases[0];
  const window = new BrowserWindow({
    width: first.width,
    height: first.height,
    show: true,
    backgroundColor: "#030303",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let loadedCase = null;

  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) renderErrors.push(message);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    renderErrors.push(`render-process-gone: ${details.reason}`);
  });

  try {
    for (const current of cases) {
      renderErrors.length = 0;
      window.setContentSize(current.width, current.height);

      // Keep one renderer alive across viewport captures. On the constrained
      // self-hosted macOS runner, repeatedly creating and destroying windows
      // made otherwise healthy Vite navigations intermittently return
      // ERR_FAILED. Each real surface still loads independently; its remaining
      // cases exercise the browser's actual resize/reflow path.
      if (loadedCase !== current.smokeCase) {
        const url = `${baseUrl}?case=${encodeURIComponent(current.smokeCase)}`;
        await loadUrlWithRetry(window, url, current.smokeCase);
        loadedCase = current.smokeCase;
      }

      await waitForReady(window, current.ready);
      await sleep(current.smokeCase === "quant" ? 1000 : 650);
      const overflow = await assertNoRootOverflow(window, current.name);

      const image = await window.webContents.capturePage();
      if (image.isEmpty()) throw new Error(`Captured empty image for ${current.name}`);
      const size = image.getSize();
      if (size.width < current.width - 4 || size.height < current.height - 4) {
        throw new Error(`Unexpected screenshot size for ${current.name}: ${size.width}x${size.height}`);
      }
      fs.writeFileSync(path.join(outputDir, `${current.name}.png`), image.toPNG());
      manifest.push({ ...current, overflow });

      if (renderErrors.length) {
        throw new Error(`Renderer reported errors in ${current.name}:\n${renderErrors.join("\n")}`);
      }
    }

    fs.writeFileSync(
      path.join(outputDir, "manifest.json"),
      JSON.stringify({ cases: manifest }, null, 2),
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
