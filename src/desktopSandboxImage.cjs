const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const HOST_CONTAINER_PLATFORMS = Object.freeze({
  darwin: Object.freeze({ arm64: 'linux/arm64', x64: 'linux/amd64' }),
  win32: Object.freeze({ arm64: 'linux/arm64', x64: 'linux/amd64' }),
  linux: Object.freeze({ arm64: 'linux/arm64', x64: 'linux/amd64' }),
});

function containerPlatformForHost(platform = process.platform, arch = process.arch) {
  const target = HOST_CONTAINER_PLATFORMS[platform]?.[arch];
  if (!target) throw new Error(`Packaged sandbox is not qualified for host ${platform}/${arch}.`);
  return target;
}

function isSocket(candidate) {
  try { return fs.statSync(candidate).isSocket(); }
  catch { return false; }
}

function defaultLocalDockerTarget({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (platform === 'win32') return 'npipe:////./pipe/docker_engine';

  const candidates = [
    path.join(home, '.docker', 'run', 'docker.sock'),
    path.join(home, '.colima', 'default', 'docker.sock'),
  ];
  if (platform === 'linux') {
    const runtime = env.XDG_RUNTIME_DIR?.trim();
    if (runtime) candidates.push(path.join(runtime, 'podman', 'podman.sock'));
    if (typeof process.getuid === 'function') candidates.push(`/run/user/${process.getuid()}/podman/podman.sock`);
    candidates.push('/var/run/docker.sock');
  }
  const socket = candidates.find(isSocket);
  const fallback = platform === 'linux' ? '/var/run/docker.sock' : candidates[0];
  return `unix://${socket || fallback}`;
}

function validLocalEngineTarget(target, platform) {
  if (typeof target !== 'string' || target.includes('\0')) return false;
  if (platform === 'win32') return /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9._-]+$/.test(target);
  return /^unix:\/\/\/[^?#\0]+$/.test(target);
}

function packagedSandboxEnvironment(resourcesPath, env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const resolveTarget = options.resolveTarget !== false && options.resolveSocket !== false;
  const targetPlatform = containerPlatformForHost(platform, arch);
  const manifest = path.join(resourcesPath, 'sandbox-image-dist', 'sandbox-image.json');
  if (!fs.existsSync(manifest)) return null;
  const manifestStat = fs.lstatSync(manifest);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Packaged sandbox manifest is not a regular file.');
  const release = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (release.schemaVersion !== 1 || release.platform !== targetPlatform || !/^sha256:[a-f0-9]{64}$/.test(release.image) || release.archive !== 'sandbox-image.tar.gz' || !/^[a-f0-9]{64}$/.test(release.archiveSha256)) {
    throw new Error(`Packaged sandbox manifest is invalid or incompatible with host ${platform}/${arch}; expected ${targetPlatform}.`);
  }
  if (release.provenance?.sourceLock !== 'source-lock.json' || !/^[a-f0-9]{64}$/.test(release.provenance?.sourceLockSha256 || '')) throw new Error('Sandbox release provenance is missing or invalid.');
  const sourceLock = path.join(path.dirname(manifest), 'source-lock.json');
  const lockStat = fs.lstatSync(sourceLock);
  if (!lockStat.isFile() || lockStat.isSymbolicLink() || crypto.createHash('sha256').update(fs.readFileSync(sourceLock)).digest('hex') !== release.provenance.sourceLockSha256) throw new Error('Packaged sandbox source lock differs from release provenance.');
  const trusted = JSON.parse(fs.readFileSync(sourceLock, 'utf8'));
  if (trusted.schemaVersion !== 1 || trusted.releaseStatus !== 'ready' || trusted.provenance?.verified !== true || !trusted.acceptedPlatforms?.includes(targetPlatform)) throw new Error(`Packaged sandbox source lock is not release-qualified for ${targetPlatform}.`);
  if (trusted.baseImage?.platform !== targetPlatform || trusted.baseImage?.reference !== release.provenance.baseImage?.reference || trusted.node?.version !== release.provenance.node?.version || trusted.xlsx?.version !== release.provenance.xlsx?.version || trusted.docling?.version !== release.provenance.docling?.version) throw new Error('Sandbox release provenance differs from its trusted source lock.');
  const browser = trusted.browser;
  if (trusted.verifiedImageId !== release.image || browser?.qualification !== 'qualified'
    || browser.playwrightVersion !== '1.63.0' || browser.chromiumRevision !== '1243'
    || browser.modulePath !== '/opt/lios/node_modules/playwright-core' || browser.executablePath !== '/opt/lios/browser/chromium') throw new Error('Packaged sandbox lacks the exact qualified browser runtime image.');
  for (const key of ['playwrightVersion', 'chromiumRevision', 'browserVersion', 'modulePath', 'executablePath', 'qualification']) {
    if (release.provenance.browser?.[key] !== browser[key]) throw new Error('Browser release provenance differs from its trusted source lock.');
  }
  for (const pin of [browser.artifactInventory, browser.dependencyInventory]) {
    if (!pin || typeof pin.file !== 'string' || path.basename(pin.file) !== pin.file || !/^[a-f0-9]{64}$/.test(pin.sha256 || '')) throw new Error('Packaged browser inventory pin is malformed.');
    const file = path.join(path.dirname(manifest), pin.file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== pin.sha256) throw new Error('Packaged browser inventory differs from its source lock.');
  }
  if ((env.LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE && env.LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE !== browser.modulePath)
    || (env.LIOS_EXECUTION_BROWSER_CHROMIUM && env.LIOS_EXECUTION_BROWSER_CHROMIUM !== browser.executablePath)) throw new Error('Configured browser paths differ from the packaged runtime.');
  if (env.LIOS_EXECUTION_ISOLATION && env.LIOS_EXECUTION_ISOLATION !== 'strict') throw new Error('A packaged sandbox cannot be downgraded to legacy host execution.');
  if (env.LIOS_EXECUTION_SANDBOX_IMAGE && env.LIOS_EXECUTION_SANDBOX_IMAGE !== release.image) throw new Error('Configured sandbox image differs from the packaged immutable digest.');
  if (!resolveTarget) return { LIOS_EXECUTION_SANDBOX_IMAGE: release.image };

  const target = env.LIOS_EXECUTION_SANDBOX_TARGET || defaultLocalDockerTarget({ platform, home: options.home || os.homedir(), env });
  const engine = env.LIOS_EXECUTION_SANDBOX_ENGINE || 'docker';
  if (!['docker', 'podman'].includes(engine) || !validLocalEngineTarget(target, platform)) {
    throw new Error(`Packaged sandbox requires an explicit local ${platform === 'win32' ? 'named-pipe' : 'Unix-socket'} container engine target.`);
  }
  return {
    LIOS_EXECUTION_ISOLATION: 'strict',
    LIOS_EXECUTION_SANDBOX_ENGINE: engine,
    LIOS_EXECUTION_SANDBOX_TARGET: target,
    LIOS_EXECUTION_SANDBOX_IMAGE: release.image,
    LIOS_EXECUTION_BROWSER_PLAYWRIGHT_MODULE: browser.modulePath,
    LIOS_EXECUTION_BROWSER_CHROMIUM: browser.executablePath,
  };
}

function verifyPackagedSandboxRelease(resourcesPath, options = {}) {
  const environment = packagedSandboxEnvironment(resourcesPath, {}, { ...options, resolveTarget: false });
  if (!environment) throw new Error('Signed desktop release requires sandbox-image-dist/sandbox-image.json.');
  const directory = path.join(resourcesPath, 'sandbox-image-dist');
  const release = JSON.parse(fs.readFileSync(path.join(directory, 'sandbox-image.json'), 'utf8'));
  const archive = path.join(directory, release.archive);
  const archiveStat = fs.lstatSync(archive);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) throw new Error('Sandbox image archive is missing or not a regular file.');
  const checksum = crypto.createHash('sha256');
  const file = fs.openSync(archive, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) checksum.update(buffer.subarray(0, count));
  } finally { fs.closeSync(file); }
  if (checksum.digest('hex') !== release.archiveSha256) throw new Error('Sandbox image archive checksum differs from its release manifest.');
  return environment.LIOS_EXECUTION_SANDBOX_IMAGE;
}

function requirePackagedSandboxEnvironment(resourcesPath, env = process.env, options = {}) {
  const environment = packagedSandboxEnvironment(resourcesPath, env, options);
  if (!environment) throw new Error('Packaged desktop requires a verified sandbox image release for this host architecture.');
  return environment;
}

module.exports = {
  containerPlatformForHost,
  defaultLocalDockerTarget,
  packagedSandboxEnvironment,
  requirePackagedSandboxEnvironment,
  validLocalEngineTarget,
  verifyPackagedSandboxRelease,
};
