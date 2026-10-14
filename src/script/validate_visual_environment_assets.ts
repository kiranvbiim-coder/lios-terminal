import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SRC_ROOT, "..");
const PUBLIC_ROOT = resolve(SRC_ROOT, "client/public/visual-environments");
const MASTER_ROOT = resolve(REPO_ROOT, "assets/visual-environments/masters");

const IDS = [
  "neutral",
  "global-intelligence",
  "company-intelligence",
  "markets",
  "valuation",
  "portfolio-risk",
  "quant-strategy",
  "research-knowledge",
  "personal-finance",
  "economic-intelligence",
] as const;

type ManifestEnvironment = {
  id: string;
  desktopAssetPath: string;
  lowResourceAssetPath: string;
  masterSourceRepoPath: string;
  composition?: {
    canvas?: string;
    centralSafeZone?: { x?: number; y?: number; width?: number; height?: number };
    peripheralDetail?: boolean;
    embeddedText?: boolean;
  };
  provenance?: {
    owner?: string;
    method?: string;
    thirdPartyAssets?: boolean;
    version?: string;
  };
};

type Manifest = {
  version: number;
  environments: ManifestEnvironment[];
};

function fail(message: string): never {
  throw new Error(`[visual-environments] ${message}`);
}

function requireFile(path: string): string {
  if (!existsSync(path)) fail(`missing file: ${path}`);
  return readFileSync(path, "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
});

function validateSvg(input: {
  id: string;
  kind: "desktop" | "low-resource" | "master";
  path: string;
  expectedWidth: number;
  expectedHeight: number;
}) {
  const source = requireFile(input.path);
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(source) as Record<string, unknown>;
  } catch (error) {
    fail(`${input.id} ${input.kind} is not valid XML: ${String(error)}`);
  }

  const svg = parsed.svg as Record<string, unknown> | undefined;
  assert(svg, `${input.id} ${input.kind} has no <svg> root`);
  assert(Number(svg.width) === input.expectedWidth, `${input.id} ${input.kind} width must be ${input.expectedWidth}`);
  assert(Number(svg.height) === input.expectedHeight, `${input.id} ${input.kind} height must be ${input.expectedHeight}`);

  assert(!/<text\b/i.test(source), `${input.id} ${input.kind} contains embedded text`);
  assert(!/<image\b/i.test(source), `${input.id} ${input.kind} contains raster/remote image content`);
  assert(!/(?:href|xlink:href)\s*=\s*["']https?:\/\//i.test(source), `${input.id} ${input.kind} contains a remote asset reference`);

  if (input.kind === "desktop") {
    assert(source.length >= 3500, `${input.id} desktop asset is too small to qualify as the production scene`);
    assert(/centralSafeZone|centerQuiet|edgeMask/i.test(source), `${input.id} desktop asset is missing composer-safe-zone treatment`);
  }

  if (input.kind === "low-resource") {
    assert(source.length < 2600, `${input.id} low-resource asset should remain intentionally lightweight`);
    assert(!/feTurbulence/i.test(source), `${input.id} low-resource asset must not include turbulence/grain filters`);
  }

  if (input.kind === "master") {
    assert(source.includes('data-lios-master="true"'), `${input.id} master is missing the master marker`);
    assert(source.includes(`data-scene-id="${input.id}"`), `${input.id} master has the wrong scene id`);
  }

  return source.length;
}

const manifestPath = resolve(PUBLIC_ROOT, "manifest.json");
const manifest = JSON.parse(requireFile(manifestPath)) as Manifest;
assert(manifest.version >= 2, "manifest version must be >= 2");
assert(manifest.environments.length === IDS.length, `manifest must contain exactly ${IDS.length} environments`);
assert(new Set(manifest.environments.map((environment) => environment.id)).size === IDS.length, "manifest environment ids must be unique");

let productionBytes = 0;
let lowResourceBytes = 0;
let masterBytes = 0;

for (const id of IDS) {
  const descriptor = manifest.environments.find((environment) => environment.id === id);
  assert(descriptor, `manifest is missing ${id}`);
  assert(descriptor.desktopAssetPath === `/visual-environments/${id}.svg`, `${id} desktop path mismatch`);
  assert(descriptor.lowResourceAssetPath === `/visual-environments/low-resource/${id}.svg`, `${id} low-resource path mismatch`);
  assert(descriptor.masterSourceRepoPath === `assets/visual-environments/masters/${id}.svg`, `${id} master path mismatch`);
  assert(descriptor.composition?.canvas === "1920x1080", `${id} manifest canvas mismatch`);
  assert(descriptor.composition?.centralSafeZone?.width === 1060, `${id} manifest safe zone width mismatch`);
  assert(descriptor.composition?.centralSafeZone?.height === 820, `${id} manifest safe zone height mismatch`);
  assert(descriptor.composition?.peripheralDetail === true, `${id} must declare peripheral detail`);
  assert(descriptor.composition?.embeddedText === false, `${id} must declare no embedded text`);
  assert(descriptor.provenance?.thirdPartyAssets === false, `${id} provenance must declare no third-party assets`);
  assert(Boolean(descriptor.provenance?.owner), `${id} provenance owner is required`);
  assert(Boolean(descriptor.provenance?.method), `${id} provenance method is required`);

  const desktopPath = resolve(PUBLIC_ROOT, `${id}.svg`);
  const lowResourcePath = resolve(PUBLIC_ROOT, "low-resource", `${id}.svg`);
  const masterPath = resolve(MASTER_ROOT, `${id}.svg`);

  const desktopLength = validateSvg({ id, kind: "desktop", path: desktopPath, expectedWidth: 1920, expectedHeight: 1080 });
  const lowLength = validateSvg({ id, kind: "low-resource", path: lowResourcePath, expectedWidth: 1600, expectedHeight: 900 });
  const masterLength = validateSvg({ id, kind: "master", path: masterPath, expectedWidth: 1920, expectedHeight: 1080 });

  assert(desktopLength > lowLength * 2, `${id} desktop scene is not materially richer than its fallback`);
  productionBytes += desktopLength;
  lowResourceBytes += lowLength;
  masterBytes += masterLength;
}

console.log(JSON.stringify({
  ok: true,
  manifestVersion: manifest.version,
  environments: IDS.length,
  productionBytes,
  lowResourceBytes,
  masterBytes,
  note: "Asset integrity only. Human aesthetic sign-off remains required by FIX-021.",
}, null, 2));
