import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SI01_SANDBOX_IMAGE_CONTRACT,
  assertLocalSandboxImageId,
  engineTargetArgument,
  sandboxImageBuildInputs,
} from "../server/exec/sandbox-image-contract";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifyOnly = process.argv.includes("--verify-only");
const runV2 = process.argv.includes("--v2");
const configuredImage = process.env.LIOS_EXECUTION_SANDBOX_IMAGE?.trim() || null;
const tag = process.env.LIOS_SI01_SANDBOX_BUILD_TAG?.trim() || "lios-si01-sandbox:local";
const inputs = sandboxImageBuildInputs(process.env, tag);
const targetArg = engineTargetArgument(inputs.engine, inputs.engineTarget);

async function run(
  args: string[],
  options: { capture?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(args[0]!, args.slice(1), {
      cwd: sourceRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    if (options.capture) {
      child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(
        `${args[0]} ${args.slice(1).join(" ")} failed (${code ?? signal ?? "unknown"})${stderr ? `: ${stderr.trim().slice(0, 4000)}` : ""}`,
      ));
    });
  });
}

function engine(...args: string[]): string[] {
  return [inputs.engine, targetArg, ...args];
}

async function buildImage(): Promise<string> {
  if (inputs.engine !== "docker") throw new Error("The locked offline image assembler requires Docker Buildx; runtime verification still supports Podman.");
  const payload = process.env.LIOS_SI01_SANDBOX_INPUTS?.trim() || path.join(sourceRoot, "sandbox-image-inputs");
  const output = process.env.LIOS_SI01_SANDBOX_RELEASE_OUTPUT?.trim() || path.join(sourceRoot, "sandbox-image-candidate");
  await run([
    process.execPath, "script/sandbox_image_release.cjs", payload, output, "--candidate",
    ...(process.argv.includes("--reuse-runtime-base") ? ["--reuse-runtime-base"] : []),
    ...(process.argv.includes("--image-only") ? ["--image-only"] : []),
  ], { env: { ...process.env, DOCKER_HOST: inputs.engineTarget, LIOS_SI01_SANDBOX_BUILD_TAG: inputs.tag } });
  return inspectImageId(inputs.tag);
}

async function inspectImageId(reference: string): Promise<string> {
  const raw = await run(engine("image", "inspect", "--format", "{{.Id}}", reference), { capture: true });
  return assertLocalSandboxImageId(raw);
}

async function imageProbe(image: string, argv: string[]): Promise<string> {
  return run(engine(
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    `--user=${SI01_SANDBOX_IMAGE_CONTRACT.user}`,
    image,
    ...argv,
  ), { capture: true });
}

async function verifyImage(image: string) {
  const nodeVersion = await imageProbe(image, [SI01_SANDBOX_IMAGE_CONTRACT.tools.node, "--version"]);
  const doclingVersion = await imageProbe(image, [
    SI01_SANDBOX_IMAGE_CONTRACT.tools.python,
    "-c",
    "import importlib.metadata as m; print(m.version('docling'))",
  ]);
  const xlsxVersion = await imageProbe(image, [
    SI01_SANDBOX_IMAGE_CONTRACT.tools.node,
    "-p",
    `require(${JSON.stringify(SI01_SANDBOX_IMAGE_CONTRACT.tools.xlsxModule + "/package.json")}).version`,
  ]);
  await imageProbe(image, [
    SI01_SANDBOX_IMAGE_CONTRACT.tools.shell,
    "-c",
    [
      `test -x ${SI01_SANDBOX_IMAGE_CONTRACT.tools.shell}`,
      `test -x ${SI01_SANDBOX_IMAGE_CONTRACT.tools.base64}`,
      `test -x ${SI01_SANDBOX_IMAGE_CONTRACT.tools.tar}`,
      `test -x ${SI01_SANDBOX_IMAGE_CONTRACT.tools.python}`,
      `test -x ${SI01_SANDBOX_IMAGE_CONTRACT.tools.node}`,
      `test -r ${SI01_SANDBOX_IMAGE_CONTRACT.tools.xlsxModule}/package.json`,
    ].join(" && "),
  ]);
  const playwrightVersion = await imageProbe(image, [
    SI01_SANDBOX_IMAGE_CONTRACT.tools.node, "-p",
    `require(${JSON.stringify(SI01_SANDBOX_IMAGE_CONTRACT.browser.playwrightModule + "/package.json")}).version`,
  ]);
  const chromiumVersion = await imageProbe(image, [SI01_SANDBOX_IMAGE_CONTRACT.browser.chromium, "--version"]);
  if (playwrightVersion !== SI01_SANDBOX_IMAGE_CONTRACT.browser.playwrightVersion) {
    throw new Error(`Sandbox Playwright version drifted: ${playwrightVersion}.`);
  }
  if (!chromiumVersion.includes(SI01_SANDBOX_IMAGE_CONTRACT.browser.browserVersion)) {
    throw new Error(`Sandbox Chromium version drifted: ${chromiumVersion}.`);
  }

  if (nodeVersion !== `v${SI01_SANDBOX_IMAGE_CONTRACT.nodeVersion}`) {
    throw new Error(`Sandbox Node version drifted: ${nodeVersion}.`);
  }
  if (doclingVersion !== SI01_SANDBOX_IMAGE_CONTRACT.doclingVersion) {
    throw new Error(`Sandbox Docling version drifted: ${doclingVersion}.`);
  }
  if (xlsxVersion !== SI01_SANDBOX_IMAGE_CONTRACT.xlsxVersion) {
    throw new Error(`Sandbox SheetJS version drifted: ${xlsxVersion}.`);
  }
  return { nodeVersion, doclingVersion, xlsxVersion, playwrightVersion, chromiumVersion };
}

async function main() {
  const image = verifyOnly
    ? assertLocalSandboxImageId(configuredImage ?? "")
    : await buildImage();
  const versions = await verifyImage(image);
  const evidence = {
    schemaVersion: 1,
    truthLevel: "local-image-built-and-verified",
    engine: inputs.engine,
    engineTarget: inputs.engineTarget,
    image,
    runtime: {
      user: SI01_SANDBOX_IMAGE_CONTRACT.user,
      tools: SI01_SANDBOX_IMAGE_CONTRACT.tools,
      browser: SI01_SANDBOX_IMAGE_CONTRACT.browser,
      ...versions,
    },
    releaseWheelHashLock: "separate-si01.16-gate-required",
  } as const;
  const evidencePath = path.resolve(
    process.env.LIOS_SI01_SANDBOX_IMAGE_EVIDENCE_PATH?.trim() || "si01-sandbox-image-evidence.json",
  );
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(`LIOS_EXECUTION_SANDBOX_IMAGE=${image}\n`);

  if (runV2) {
    await run(["npm", "run", "acceptance:si01-isolation-v2"], {
      env: {
        ...process.env,
        LIOS_EXECUTION_ISOLATION: "strict",
        LIOS_EXECUTION_SANDBOX_ENGINE: inputs.engine,
        LIOS_EXECUTION_SANDBOX_TARGET: inputs.engineTarget,
        LIOS_EXECUTION_SANDBOX_IMAGE: image,
        LIOS_EXECUTION_SANDBOX_USER: SI01_SANDBOX_IMAGE_CONTRACT.user,
        LIOS_EXECUTION_SANDBOX_SHELL: SI01_SANDBOX_IMAGE_CONTRACT.tools.shell,
        LIOS_EXECUTION_SANDBOX_BASE64: SI01_SANDBOX_IMAGE_CONTRACT.tools.base64,
        LIOS_EXECUTION_SANDBOX_TAR: SI01_SANDBOX_IMAGE_CONTRACT.tools.tar,
        LIOS_EXECUTION_SANDBOX_PYTHON: SI01_SANDBOX_IMAGE_CONTRACT.tools.python,
        LIOS_EXECUTION_SANDBOX_NODE: SI01_SANDBOX_IMAGE_CONTRACT.tools.node,
        LIOS_EXECUTION_SANDBOX_XLSX: SI01_SANDBOX_IMAGE_CONTRACT.tools.xlsxModule,
      },
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
