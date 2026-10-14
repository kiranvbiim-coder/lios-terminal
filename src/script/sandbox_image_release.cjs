#!/usr/bin/env node
// Offline release assembler. Trusted pins live in sandbox-image/source-lock.json,
// separately from the mutable payload descriptor.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const payload = path.resolve(process.argv[2] || path.join(root, 'sandbox-image-inputs'));
const output = path.resolve(process.argv[3] || path.join(root, 'sandbox-image-dist'));
const candidate = process.argv.includes('--candidate');
const reuseRuntimeBase = process.argv.includes('--reuse-runtime-base');
// Independently recorded custody of the previously shipped SI-01 release.
// This is only a build input pin; it never qualifies the extended browser image.
const runtimeBasePin = Object.freeze({
  image: 'sha256:f17d897b7f01fb8e9389faf83ca9db7178cb620c2f8fd8f95b18eda95deb7cde',
  sourceLockSha256: 'c229904193c2e290fc277e501b62f9e5ca433ae14e76fdec5ca55fa586955818',
  manifestSha256: '82e36b1a88b8b39a9f29040670150bbc26c70cd64fac432c4e787d15710822b6',
  archiveSha256: '5a7280f4551dd41ec35ac4bc81ef6f14ec662aa156d09bb4d09e3039e9401816',
});
let dockerTarget;
const lockPath = path.join(root, 'sandbox-image', 'source-lock.json');
const hash = (file, algorithm = 'sha256') => {
  const h = crypto.createHash(algorithm);
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) h.update(chunk.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest(algorithm === 'sha512' ? 'base64' : 'hex');
};
const sha256 = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function run(file, args, options = {}) {
  if (file === 'docker' && dockerTarget) args = [`--host=${dockerTarget}`, ...args];
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${file} ${args[0]} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  return result.stdout?.trim() || '';
}
async function saveCompressedImage(image, archive) {
  const child = spawn('bash', ['-o', 'pipefail', '-c', 'docker --host="$3" save "$1" | gzip -6 > "$2"', 'bash', image, archive, dockerTarget], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`docker image export failed: ${stderr.trim() || code}`)));
  });
}
function regularFile(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.split('/').some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) throw new Error(`Invalid sandbox input path: ${String(relative)}`);
  const resolved = path.join(base, relative);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || fs.realpathSync(resolved) !== path.join(fs.realpathSync(base), relative)) throw new Error(`Input must be a regular non-symlink file: ${relative}`);
  return resolved;
}
function verifiedRuntimeBase(trusted, platform) {
  const directory = path.resolve(process.env.LIOS_SI01_SANDBOX_RUNTIME_BASE_RELEASE?.trim() || path.join(root, 'sandbox-image-dist'));
  const lockFile = regularFile(directory, 'source-lock.json');
  const manifestFile = regularFile(directory, 'sandbox-image.json');
  if (hash(lockFile) !== runtimeBasePin.sourceLockSha256 || hash(manifestFile) !== runtimeBasePin.manifestSha256) throw new Error('Runtime base release/source-lock differs from the independently pinned shipped baseline.');
  const baseline = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const release = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (baseline.releaseStatus !== 'ready' || baseline.provenance?.verified !== true || baseline.verifiedImageId !== runtimeBasePin.image
    || release.image !== runtimeBasePin.image || release.platform !== platform || release.archiveSha256 !== runtimeBasePin.archiveSha256
    || release.provenance.sourceLockSha256 !== runtimeBasePin.sourceLockSha256) throw new Error('Runtime base metadata is not the pinned qualified baseline.');
  for (const key of ['baseImage', 'node', 'xlsx', 'docling']) {
    const current = { ...trusted[key] };
    delete current.models;
    delete current.wheels;
    if (JSON.stringify(current) !== JSON.stringify(baseline[key])) throw new Error(`Runtime base ${key} source pins differ from current image contract; perform full source build.`);
  }
  const readBaselineInventory = (pin) => {
    const file = regularFile(directory, pin.file);
    if (hash(file) !== pin.sha256) throw new Error('Runtime base inventory differs from its qualified source lock.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const proof = {
    lock: baseline,
    models: readBaselineInventory(baseline.docling.modelInventory),
    wheels: readBaselineInventory(baseline.docling.wheelInventory),
  };
  const actual = run('docker', ['image', 'inspect', runtimeBasePin.image, '--format', '{{.Id}} {{.Os}}/{{.Architecture}}']);
  if (actual !== `${runtimeBasePin.image} ${platform}`) throw new Error('Exact pinned runtime base image is unavailable; no mutable-tag lookup or implicit import is permitted.');
  const source = fs.readFileSync(path.join(root, 'sandbox-image', 'verify-runtime-base.py'), 'utf8');
  run('docker', ['run', '--rm', '-i', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--user', '10001:10001', runtimeBasePin.image, '/usr/bin/python3', '-c', source], { input: JSON.stringify(proof), stdio: ['pipe', 'inherit', 'inherit'] });
  return runtimeBasePin.image;
}
async function acquire(entry, relative) {
  if (!/^https:\/\//.test(entry.url || '') || !sha256(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size <= 0) throw new Error(`Invalid acquisition pin: ${relative}`);
  const destination = path.join(payload, relative);
  if (fs.existsSync(destination)) {
    if (hash(regularFile(payload, relative)) !== entry.sha256 || fs.statSync(destination).size !== entry.size) throw new Error(`Existing input differs from lock: ${relative}`);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.acquiring';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    const response = await fetch(entry.url, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error(`Locked input acquisition failed: ${relative} (${response.status})`);
    const checksum = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > entry.size) throw new Error(`Locked input exceeds declared size: ${relative}`);
      checksum.update(chunk);
      let offset = 0;
      while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
    }
    if (bytes !== entry.size || checksum.digest('hex') !== entry.sha256) throw new Error(`Acquired input differs from hash lock: ${relative}`);
    fs.closeSync(fd);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* already closed before rename */ }
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
async function main() {
  const lockBytes = fs.readFileSync(lockPath);
  const trusted = JSON.parse(lockBytes.toString('utf8'));
  const readInventory = (pin) => {
    if (!pin || typeof pin.file !== 'string' || !sha256(pin.sha256)) throw new Error('Trusted inventory pin is missing or malformed.');
    const file = regularFile(path.join(root, 'sandbox-image'), pin.file);
    if (hash(file) !== pin.sha256) throw new Error(`Trusted source inventory checksum mismatch: ${pin.file}`);
    const inventory = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(inventory) || !inventory.length) throw new Error(`Trusted inventory is empty: ${pin.file}`);
    return inventory;
  };
  if (trusted.docling) {
    trusted.docling.models = readInventory(trusted.docling.modelInventory);
    trusted.docling.wheels = readInventory(trusted.docling.wheelInventory);
  }
  if (!trusted.browser || trusted.browser.playwrightVersion !== '1.63.0' || trusted.browser.chromiumRevision !== '1243'
    || trusted.browser.modulePath !== '/opt/lios/node_modules/playwright-core' || trusted.browser.executablePath !== '/opt/lios/browser/chromium') throw new Error('Trusted browser runtime lock is missing or incompatible.');
  const browserArtifacts = readInventory(trusted.browser.artifactInventory);
  const browserDependencies = readInventory(trusted.browser.dependencyInventory);
  if (new Set(browserArtifacts.map((entry) => entry.filename)).size !== browserArtifacts.length
    || new Set(browserDependencies.map((entry) => entry.filename)).size !== browserDependencies.length
    || browserDependencies.some((entry) => !['arm64', 'all'].includes(entry.architecture) || !entry.filename.endsWith('.deb') || !entry.sourceReference || !entry.copyrightPath)) throw new Error('Browser dependency inventory is malformed.');
  if (process.argv.includes('--acquire-browser')) {
    const descriptorPath = regularFile(payload, 'inputs.json');
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
    for (const entry of browserArtifacts) {
      await acquire(entry, entry.filename);
      descriptor.files[entry.filename] = entry.sha256;
    }
    for (const entry of browserDependencies) {
      const relative = `browser-debs/${entry.filename}`;
      await acquire(entry, relative);
      descriptor.files[relative] = entry.sha256;
    }
    descriptor.browser = { playwrightVersion: trusted.browser.playwrightVersion, chromiumRevision: trusted.browser.chromiumRevision };
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2) + '\n');
    console.log('Browser inputs acquired and hash-verified; no image has been built or qualified.');
    return;
  }
  if (trusted.schemaVersion !== 1 || (candidate ? trusted.releaseStatus !== 'inputs-locked' : trusted.releaseStatus !== 'ready') || trusted.provenance?.verified !== true) {
    throw new Error(`Sandbox image release blocked: trusted source lock is incomplete. ${trusted.docling?.blocker || 'Verified source provenance is required.'} Required: base-image archive+SHA-256+image ID; exact default-model file/layout SHA-256 inventory; every linux/arm64 wheel filename, version, and SHA-256; independently verified provenance.`);
  }
  dockerTarget = process.env.LIOS_EXECUTION_SANDBOX_TARGET?.trim() || process.env.DOCKER_HOST?.trim();
  if (!dockerTarget || !/^unix:\/\/\/[^?#\0]+$/.test(dockerTarget)) throw new Error('Offline image assembly requires an explicit local Unix Docker target in LIOS_EXECUTION_SANDBOX_TARGET or DOCKER_HOST.');
  if (trusted.baseImage?.platform !== 'linux/arm64' || !trusted.node?.archive || !sha256(trusted.node.sha256) || !trusted.xlsx?.version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(trusted.xlsx?.npmLockIntegrity || '') || !Array.isArray(trusted.docling?.models) || !trusted.docling.models.length || !Array.isArray(trusted.docling?.wheels) || !trusted.docling.wheels.length || !Array.isArray(trusted.docling?.buildSources) || !trusted.docling.buildSources.length || !sha256(trusted.docling?.modelsArchiveSha256) || !sha256(trusted.docling?.requirementsSha256)) throw new Error('Trusted source lock is missing exact base-image, model, wheel, or source-build pins.');
  if (payload === output || output.startsWith(payload + path.sep)) throw new Error('Release output must be outside the input directory.');
  const descriptor = JSON.parse(fs.readFileSync(regularFile(payload, 'inputs.json'), 'utf8'));
  const { platform, baseImage, nodeVersion, files } = descriptor;
  if (!trusted.acceptedPlatforms.includes(platform) || platform !== 'linux/arm64') throw new Error('Only the independently qualified linux/arm64 sandbox image is accepted.');
  if (baseImage !== trusted.baseImage.reference || nodeVersion !== trusted.node.version) throw new Error('Descriptor base image or Node version differs from the separately trusted source lock.');
  if (!sha256(trusted.baseImage.archiveSha256) || !/^sha256:[a-f0-9]{64}$/.test(trusted.baseImage.imageId || '') || trusted.baseImage.archive !== 'base-image.tar') throw new Error('Trusted source lock lacks the exact verified base image archive, digest, and image ID.');
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Payload descriptor has no valid file inventory.');
  const expected = new Map([
    [trusted.node.archive, trusted.node.sha256],
    ['xlsx.tgz', hash(regularFile(payload, 'xlsx.tgz'))],
    ['docling-models.tar', trusted.docling.modelsArchiveSha256],
    ['requirements.lock.txt', trusted.docling.requirementsSha256],
    [trusted.baseImage.archive, trusted.baseImage.archiveSha256],
  ]);
  for (const entry of browserArtifacts) expected.set(entry.filename, entry.sha256);
  for (const entry of browserDependencies) expected.set(`browser-debs/${entry.filename}`, entry.sha256);
  if (descriptor.browser?.playwrightVersion !== trusted.browser.playwrightVersion || descriptor.browser?.chromiumRevision !== trusted.browser.chromiumRevision) throw new Error('Payload browser version/revision differs from trusted source lock.');
  const actualDebs = fs.readdirSync(path.join(payload, 'browser-debs')).filter((name) => name !== 'lock' && name !== 'partial').sort();
  if (actualDebs.join('\n') !== browserDependencies.map((entry) => entry.filename).sort().join('\n')) throw new Error('Browser dependency payload contains missing, unexpected or unhashed packages.');
  if (hash(regularFile(payload, trusted.browser.playwrightArchive), 'sha512') !== trusted.browser.npmLockIntegrity.slice('sha512-'.length)) throw new Error('Playwright tarball differs from published npm SHA-512 SRI.');
  const browsersText = run('tar', ['-xOf', regularFile(payload, trusted.browser.playwrightArchive), 'package/browsers.json']);
  if (crypto.createHash('sha256').update(browsersText + '\n').digest('hex') !== trusted.browser.browsersJsonSha256) throw new Error('Playwright browsers.json differs from independently pinned content.');
  const chromium = JSON.parse(browsersText).browsers.find((entry) => entry.name === 'chromium');
  if (chromium?.revision !== trusted.browser.chromiumRevision || chromium?.browserVersion !== trusted.browser.browserVersion) throw new Error('Chromium revision/version differs from Playwright browsers.json.');
  for (const source of trusted.docling.buildSources) {
    const wheel = trusted.docling.wheels.find((entry) => entry.package === source.package && entry.version === source.version);
    if (!source.filename || !sha256(source.sha256) || !/^https:\/\/files\.pythonhosted\.org\//.test(source.url || '')
      || !wheel || wheel.filename !== source.wheelFilename || wheel.sha256 !== source.wheelSha256) {
      throw new Error(`Trusted source-build pin is incomplete: ${source.package}`);
    }
    expected.set(source.filename, source.sha256);
  }
  for (const wheel of trusted.docling.wheels) expected.set(`wheelhouse/${wheel.filename}`, wheel.sha256);
  if (expected.size !== Object.keys(files).length) throw new Error('Payload descriptor inventory differs from independently trusted lock.');
  for (const [name, digest] of expected) {
    if (!sha256(digest) || files[name] !== digest || hash(regularFile(payload, name)) !== digest) throw new Error(`Payload differs from trusted lock: ${name}`);
  }
  const actualWheels = fs.readdirSync(path.join(payload, 'wheelhouse')).sort();
  if (actualWheels.join('\n') !== trusted.docling.wheels.map((wheel) => wheel.filename).sort().join('\n')) throw new Error('Wheelhouse contains a missing, unexpected, or unhashed wheel.');
  const modelPaths = new Set();
  for (const model of trusted.docling.models) {
    if (typeof model.path !== 'string' || !sha256(model.sha256)) throw new Error('Trusted model inventory contains an invalid path or SHA-256.');
    let parent = path.posix.dirname(model.path);
    while (parent !== '.' && !modelPaths.has(parent)) {
      modelPaths.add(parent);
      parent = path.posix.dirname(parent);
    }
    modelPaths.add(model.path);
  }
  const archiveEntries = run('tar', ['-tf', regularFile(payload, 'docling-models.tar')]).split('\n').filter(Boolean).map((name) => name.replace(/\/$/, ''));
  if (archiveEntries.some((name) => name.startsWith('/') || name.split('/').some((part) => !part || part === '.' || part === '..')) || new Set(archiveEntries).size !== archiveEntries.length || [...modelPaths].sort().join('\n') !== archiveEntries.sort().join('\n')) throw new Error('Docling model archive layout differs from the trusted exact file inventory.');
  const lockText = fs.readFileSync(regularFile(payload, 'requirements.lock.txt'), 'utf8');
  const lockedRequirements = new Map();
  for (const line of lockText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#'))) {
    const match = line.match(/^([A-Za-z0-9_.-]+)==(\S+).*--hash=sha256:([a-f0-9]{64})/);
    if (!match) throw new Error('Every resolved requirement must pin version and SHA-256 in requirements.lock.txt.');
    lockedRequirements.set(match[1].toLowerCase().replace(/[-_.]+/g, '-'), `${match[2]}:${match[3]}`);
  }
  const trustedRequirements = new Map(trusted.docling.wheels.map((wheel) => [wheel.package.toLowerCase().replace(/[-_.]+/g, '-'), `${wheel.version}:${wheel.sha256}`]));
  const sourceRegistries = new Set(['pypi', 'pytorch-cpu', 'pypi-sdist-derived']);
  if (trusted.docling.wheels.some((wheel) =>
    !wheel.filename.endsWith('.whl')
    || !sha256(wheel.sha256)
    || !sourceRegistries.has(wheel.sourceRegistry)
    || /^(?:cuda|nvidia)-/i.test(wheel.package)
    || ((wheel.package === 'torch' || wheel.package === 'torchvision')
      && (!wheel.version.endsWith('+cpu') || wheel.sourceRegistry !== 'pytorch-cpu'))
    || (wheel.package === 'antlr4-python3-runtime' && wheel.sourceRegistry !== 'pypi-sdist-derived')
  )) throw new Error('Wheel inventory contains an untrusted, unhashed, non-CPU, or non-wheel runtime artifact.');
  if (lockedRequirements.size !== trustedRequirements.size || [...trustedRequirements].some(([name, pin]) => lockedRequirements.get(name) !== pin)) throw new Error('requirements.lock.txt does not exactly match trusted resolved wheel/version/hash inventory.');
  const headlessWheel = trusted.docling.wheels.filter((wheel) => wheel.package.toLowerCase().replace(/[-_.]+/g, '-') === 'opencv-python-headless');
  if (headlessWheel.length !== 1 || headlessWheel[0].version !== '5.0.0.93' || !sha256(headlessWheel[0].sha256)) throw new Error('Trusted linux/arm64 wheel lock must pin exactly opencv-python-headless==5.0.0.93 with SHA-256.');
  if (hash(regularFile(payload, 'xlsx.tgz'), 'sha512') !== trusted.xlsx.npmLockIntegrity.slice('sha512-'.length)) throw new Error('SheetJS tarball differs from vendored npm-lock SRI.');
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (packageLock.packages?.['node_modules/xlsx']?.version !== trusted.xlsx.version || packageLock.packages?.['node_modules/xlsx']?.integrity !== trusted.xlsx.npmLockIntegrity) throw new Error('Trusted SheetJS pins differ from the checked-in npm lock.');
  if (descriptor.xlsxVersion !== trusted.xlsx.version || descriptor.xlsxIntegrity !== trusted.xlsx.npmLockIntegrity) throw new Error('Payload SheetJS metadata differs from trusted npm-lock pins.');
  const baseArchive = regularFile(payload, trusted.baseImage.archive);
  if (hash(baseArchive) !== trusted.baseImage.archiveSha256) throw new Error('Pinned base image archive checksum mismatch.');
  if (fs.existsSync(output)) throw new Error('Release destination already exists; never overwrite an immutable artifact.');
  const runtimeBase = reuseRuntimeBase ? verifiedRuntimeBase(trusted, platform) : null;
  if (!runtimeBase) {
    run('docker', ['load', '--input', baseArchive], { stdio: 'inherit' });
    const baseActual = run('docker', ['image', 'inspect', trusted.baseImage.imageId, '--format', '{{.Id}} {{.Os}}/{{.Architecture}}']);
    if (baseActual !== `${trusted.baseImage.imageId} ${platform}`) throw new Error(`Loaded base image differs from trusted ID/platform: ${baseActual}`);
  }
  const tag = process.env.LIOS_SI01_SANDBOX_BUILD_TAG?.trim() || `lios-si01-sandbox:arm64-${trusted.node.version}-${trusted.docling.version}`;
  if (!/^[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/i.test(tag)) throw new Error('Sandbox build tag is invalid.');
  if (process.argv.includes('--reuse-verified')) {
    if (!/^sha256:[a-f0-9]{64}$/.test(trusted.verifiedImageId || '')) throw new Error('Reusing a sandbox image requires an independently pinned verifiedImageId.');
    const localImage = run('docker', ['image', 'inspect', trusted.verifiedImageId, '--format', '{{.Id}} {{.Os}}/{{.Architecture}}']);
    if (localImage !== `${trusted.verifiedImageId} ${platform}`) throw new Error('Local image differs from the pinned, V2-qualified image ID/platform.');
  } else {
  const context = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lios-sandbox-image-'));
  try {
    fs.mkdirSync(path.join(context, 'wheelhouse'), { recursive: true });
    const copyInput = (name, destination = name) => fs.copyFileSync(regularFile(payload, name), path.join(context, destination), fs.constants.COPYFILE_FICLONE);
    fs.mkdirSync(path.join(context, 'browser-inputs', 'browser-debs'), { recursive: true });
    for (const entry of browserArtifacts) copyInput(entry.filename, `browser-inputs/${entry.filename}`);
    for (const entry of browserDependencies) copyInput(`browser-debs/${entry.filename}`, `browser-inputs/browser-debs/${entry.filename}`);
    for (const pin of [trusted.browser.artifactInventory, trusted.browser.dependencyInventory]) fs.copyFileSync(regularFile(path.join(root, 'sandbox-image'), pin.file), path.join(context, 'browser-inputs', pin.file));
    fs.copyFileSync(lockPath, path.join(context, 'source-lock.json'));
    fs.copyFileSync(path.join(root, 'sandbox-image', 'install-browser.py'), path.join(context, 'install-browser.py'));
    if (!runtimeBase) {
    copyInput(trusted.node.archive, 'node.tar.gz');
    copyInput('xlsx.tgz');
    copyInput('docling-models.tar');
    copyInput('requirements.lock.txt');
    for (const wheel of trusted.docling.wheels) copyInput(`wheelhouse/${wheel.filename}`);
    fs.writeFileSync(path.join(context, 'docling-models.manifest.json'), JSON.stringify(trusted.docling.models, null, 2) + '\n', { flag: 'w' });
    }
    fs.copyFileSync(path.join(root, 'sandbox-image', 'smoke.py'), path.join(context, 'smoke.py'));
    fs.copyFileSync(path.join(root, 'sandbox-image', 'smoke-xlsx.cjs'), path.join(context, 'smoke-xlsx.cjs'));
    fs.writeFileSync(path.join(context, 'opencv-headless.lock.txt'), `opencv-python-headless==${headlessWheel[0].version} --hash=sha256:${headlessWheel[0].sha256}\n`, { flag: 'wx' });
    const dockerfile = runtimeBase ? 'Dockerfile.runtime-base' : 'Dockerfile';
    // Buildx interprets a bare image ID as a Docker Hub repository. The local alias is not an
    // accepted input: it is minted from the independently verified ID and its inherited layers are checked.
    const runtimeBaseReference = runtimeBase ? `lios-qualified-runtime-base:${runtimeBase.slice(7)}` : null;
    if (runtimeBaseReference) {
      run('docker', ['tag', runtimeBase, runtimeBaseReference]);
      if (run('docker', ['image', 'inspect', runtimeBaseReference, '--format', '{{.Id}}']) !== runtimeBase) throw new Error('Runtime-base alias does not resolve to the verified immutable image.');
    }
    const baseArgument = runtimeBase ? `RUNTIME_BASE=${runtimeBaseReference}` : `BASE_IMAGE=${baseImage}`;
    try {
      run('docker', ['buildx', 'version']);
    } catch {
      throw new Error('Offline sandbox release requires the Docker Buildx plugin; Docker legacy builder cannot enforce RUN --network=none.');
    }
    run('docker', ['buildx', 'build', '--builder', 'default', '--load', '--pull=false', '--network=none', '--platform', platform, '-f', path.join(root, 'sandbox-image', dockerfile), '--build-arg', baseArgument, '--build-arg', `NODE_VERSION=${nodeVersion}`, '--build-arg', `XLSX_VERSION=${trusted.xlsx.version}`, '--build-arg', `DOCLING_VERSION=${trusted.docling.version}`, '-t', tag, context], { stdio: 'inherit' });
    if (runtimeBase) {
      const inheritedLayers = JSON.parse(run('docker', ['image', 'inspect', runtimeBase, '--format', '{{json .RootFS.Layers}}']));
      const builtLayers = JSON.parse(run('docker', ['image', 'inspect', tag, '--format', '{{json .RootFS.Layers}}']));
      if (!Array.isArray(inheritedLayers) || !Array.isArray(builtLayers)
        || inheritedLayers.some((layer, index) => layer !== builtLayers[index])) {
        throw new Error('Built browser image does not inherit the exact independently verified runtime layers.');
      }
    }
  } finally {
    fs.rmSync(context, { recursive: true, force: true });
  }
  }
  const reference = process.argv.includes('--reuse-verified') ? trusted.verifiedImageId : tag;
  const image = run('docker', ['image', 'inspect', reference, '--format', '{{.Id}}']);
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Docker did not return an immutable image ID.');
  if (trusted.verifiedImageId && image !== trusted.verifiedImageId) throw new Error('Built image differs from independently pinned verifiedImageId.');
  if (!candidate && (!/^sha256:[a-f0-9]{64}$/.test(trusted.verifiedImageId || '') || trusted.browser.qualification !== 'qualified')) throw new Error('Release requires the exact parent-qualified image ID and browser navigation/cancellation/extinction qualification; use --candidate only for an unqualified build.');
  if (run('docker', ['image', 'inspect', image, '--format', '{{.Os}}/{{.Architecture}}']) !== platform) throw new Error('Built image architecture differs from trusted platform.');
  run('docker', ['run', '--rm', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--user', '10001:10001', image, '/usr/local/bin/python3', '/opt/lios/sandbox-smoke.py'], { stdio: 'inherit' });
  if (process.argv.includes('--image-only')) {
    if (!candidate) throw new Error('--image-only is an unqualified candidate build, not an installer release.');
    console.log(`${image} candidate image verified; no installer archive exported`);
    return;
  }
  const outputParent = path.dirname(output);
  fs.mkdirSync(outputParent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(outputParent, `.${path.basename(output)}.staging-`));
  try {
    const archive = path.join(staging, 'sandbox-image.tar.gz');
    await saveCompressedImage(image, archive);
    fs.copyFileSync(lockPath, path.join(staging, 'source-lock.json'));
    for (const pin of [trusted.docling.modelInventory, trusted.docling.wheelInventory, trusted.browser.artifactInventory, trusted.browser.dependencyInventory]) {
      fs.copyFileSync(
        regularFile(path.join(root, 'sandbox-image'), pin.file),
        path.join(staging, pin.file),
      );
    }
    const release = { schemaVersion: 1, platform, image, archive: 'sandbox-image.tar.gz', archiveSha256: hash(archive), provenance: { sourceLockSha256: hash(lockPath), sourceLock: 'source-lock.json', baseImage: trusted.baseImage, node: trusted.node, xlsx: trusted.xlsx, docling: trusted.docling, browser: trusted.browser } };
    if (runtimeBase) release.provenance.runtimeBase = { ...runtimeBasePin, qualification: 'inherited-runtime-only-not-browser-qualification' };
    fs.writeFileSync(path.join(staging, 'sandbox-image.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
    if (fs.existsSync(output)) throw new Error('Release destination appeared during build; refusing to overwrite it.');
    fs.renameSync(staging, output);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  console.log(`${image} ${path.join(output, 'sandbox-image.tar.gz')}`);
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
