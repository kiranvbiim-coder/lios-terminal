const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { prepareVisualSmokeOutput } = require("./prepare_visual_smoke_output.cjs");

const baseUrl = process.env.LIOS_VALUATION_SMOKE_URL || "http://127.0.0.1:4173/valuation-smoke.html";
const outputDirName = "valuation-smoke-artifacts";
const slices = [
  { name: "valuation-top", target: "INSTITUTIONAL DCF / FCF WORKBENCH", top: true },
  { name: "valuation-forecast", target: "10-YEAR OPERATING / REINVESTMENT FORECAST" },
  { name: "valuation-results", target: "DCF / FCF RESULT & CONTINUING VALUE" },
  { name: "valuation-diagnostics", target: "TWO-WAY DCF SENSITIVITY" },
  { name: "valuation-drivers", target: "KEY DRIVER IMPACT · ONE-AT-A-TIME LOCAL SHOCKS" },
];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForReady(window) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript("document.querySelector('[data-visual-smoke-ready=\"true\"]') !== null", true);
    if (ready) return;
    await sleep(200);
  }
  throw new Error("Valuation smoke harness did not become ready within 15 seconds");
}

async function runProbabilisticFixture(window) {
  const started = await window.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent?.includes('RUN 2,000 SEEDED PATHS'));
    if (!button) return false;
    button.click();
    return true;
  })()`, true);
  if (!started) throw new Error("Probabilistic DCF action was not found in the rendered workstation");

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
      const labels = Array.from(document.querySelectorAll('div')).filter(el => normalize(el.textContent) === 'P10');
      const label = labels.sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))[0];
      const value = label?.nextElementSibling?.textContent?.trim() || '';
      return { found: Boolean(label), value };
    })()`, true);
    if (state.found && state.value && state.value !== "—") return state.value;
    await sleep(150);
  }
  throw new Error("Probabilistic DCF did not populate within 10 seconds");
}

async function scrollToSlice(window, slice) {
  if (slice.top) {
    return window.webContents.executeJavaScript(`(() => {
      const container = document.querySelector('#root .overflow-y-auto');
      if (!container) throw new Error('valuation scroll container missing');
      container.scrollTop = 0;
      return {
        target: ${JSON.stringify(slice.target)},
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        visible: true,
        targetTop: 0,
        containerTop: Math.round(container.getBoundingClientRect().top),
      };
    })()`, true);
  }

  const meta = await window.webContents.executeJavaScript(`(() => {
    const container = document.querySelector('#root .overflow-y-auto');
    if (!container) throw new Error('valuation scroll container missing');
    const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
    const wanted = ${JSON.stringify(slice.target)};
    const candidates = Array.from(document.querySelectorAll('div, span, th'))
      .filter(el => normalize(el.textContent).includes(wanted))
      .sort((a, b) => normalize(a.textContent).length - normalize(b.textContent).length);
    const target = candidates[0];
    if (!target) {
      return { error: 'valuation target missing: ' + wanted, available: Array.from(document.querySelectorAll('div, span, th')).map(el => normalize(el.textContent)).filter(text => text && text.length < 90).slice(0, 80) };
    }
    target.scrollIntoView({ block: 'start', inline: 'nearest' });
    container.scrollTop = Math.max(0, container.scrollTop - 54);
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visible = targetRect.bottom > containerRect.top && targetRect.top < containerRect.bottom;
    return {
      target: wanted,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      visible,
      targetTop: Math.round(targetRect.top),
      containerTop: Math.round(containerRect.top),
    };
  })()`, true);
  if (meta.error) throw new Error(`${meta.error}. Rendered labels: ${meta.available.join(" | ")}`);
  if (!meta.visible) throw new Error(`Valuation smoke target is outside the viewport after scrolling: ${slice.target}`);
  return meta;
}

async function run() {
  const outputDir = prepareVisualSmokeOutput("LIOS_VALUATION_SMOKE_OUTPUT_DIR", outputDirName);
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: "#030303",
    webPreferences: { sandbox: false, contextIsolation: true, nodeIntegration: false },
  });
  window.setContentSize(1440, 900);

  const rendererErrors = [];
  window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) rendererErrors.push(message); });
  window.webContents.on("render-process-gone", (_event, details) => rendererErrors.push(`render-process-gone: ${details.reason}`));

  await window.loadURL(baseUrl);
  await waitForReady(window);
  await sleep(1400);
  const probabilisticP10 = await runProbabilisticFixture(window);
  await sleep(250);

  const captured = [];
  for (const slice of slices) {
    const meta = await scrollToSlice(window, slice);
    await sleep(350);
    const image = await window.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`Captured empty image for ${slice.name}`);
    const size = image.getSize();
    if (size.width < 1200 || size.height < 700) throw new Error(`Unexpected screenshot size ${size.width}x${size.height}`);
    fs.writeFileSync(path.join(outputDir, `${slice.name}.png`), image.toPNG());
    captured.push({ name: slice.name, ...meta });
  }

  const uniqueScrollPositions = new Set(captured.map(item => item.scrollTop));
  if (uniqueScrollPositions.size < 4) {
    throw new Error(`Valuation smoke slices collapsed to too few distinct scroll positions: ${JSON.stringify(captured)}`);
  }

  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify({
    viewport: "1440x900",
    probabilisticReady: true,
    probabilisticP10,
    slices: captured,
  }, null, 2));
  window.destroy();
  if (rendererErrors.length) throw new Error(`Renderer reported errors:\n${rendererErrors.join("\n")}`);
}

app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
