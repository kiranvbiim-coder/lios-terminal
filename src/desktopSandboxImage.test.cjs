const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  bootstrapPackagedSandboxEnvironment,
  containerPlatformForHost,
  defaultLocalDockerTarget,
  inferLocalContainerEngine,
  packagedSandboxEnvironment,
  validLocalEngineTarget,
  verifyPackagedSandboxRelease,
} = require('./desktopSandboxImage.cjs');

const UNIX_ENV = { LIOS_EXECUTION_SANDBOX_TARGET: 'unix:///var/run/docker.sock' };
const WINDOWS_ENV = { LIOS_EXECUTION_SANDBOX_TARGET: 'npipe:////./pipe/docker_engine' };

function releaseFixture(t, targetPlatform = 'linux/arm64') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-sandbox-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'sandbox-image-dist');
  fs.mkdirSync(directory);
  const archive = Buffer.from(`docker-image-archive-${targetPlatform}`);
  fs.writeFileSync(path.join(directory, 'sandbox-image.tar.gz'), archive);
  const inventory = Buffer.from('[]');
  const inventorySha256 = crypto.createHash('sha256').update(inventory).digest('hex');
  for (const file of ['browser-artifact-inventory.json', 'browser-dependency-inventory.json']) {
    fs.writeFileSync(path.join(directory, file), inventory);
  }
  const sourceLock = {
    schemaVersion: 1,
    releaseStatus: 'ready',
    acceptedPlatforms: [targetPlatform],
    verifiedImageId: 'sha256:' + 'b'.repeat(64),
    provenance: { verified: true },
    baseImage: { platform: targetPlatform, reference: 'python@sha256:' + 'a'.repeat(64) },
    node: { version: '22.12.0' },
    xlsx: { version: '0.20.3' },
    docling: { version: '2.129.0' },
    browser: {
      playwrightVersion: '1.63.0',
      chromiumRevision: '1243',
      browserVersion: '153.0.8010.12',
      modulePath: '/opt/lios/node_modules/playwright-core',
      executablePath: '/opt/lios/browser/chromium',
      qualification: 'qualified',
      artifactInventory: { file: 'browser-artifact-inventory.json', sha256: inventorySha256 },
      dependencyInventory: { file: 'browser-dependency-inventory.json', sha256: inventorySha256 },
    },
  };
  const lockBytes = Buffer.from(JSON.stringify(sourceLock));
  fs.writeFileSync(path.join(directory, 'source-lock.json'), lockBytes);
  const release = {
    schemaVersion: 1,
    platform: targetPlatform,
    image: 'sha256:' + 'b'.repeat(64),
    archive: 'sandbox-image.tar.gz',
    archiveSha256: crypto.createHash('sha256').update(archive).digest('hex'),
    provenance: {
      sourceLock: 'source-lock.json',
      sourceLockSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
      baseImage: { reference: sourceLock.baseImage.reference },
      node: sourceLock.node,
      xlsx: sourceLock.xlsx,
      docling: sourceLock.docling,
      browser: sourceLock.browser,
    },
  };
  fs.writeFileSync(path.join(directory, 'sandbox-image.json'), JSON.stringify(release));
  return { root, directory, release, sourceLock };
}

test('host architectures map to the matching Linux container platform without spoofing process globals', () => {
  for (const host of ['darwin', 'win32', 'linux']) {
    assert.equal(containerPlatformForHost(host, 'arm64'), 'linux/arm64');
    assert.equal(containerPlatformForHost(host, 'x64'), 'linux/amd64');
  }
  assert.throws(() => containerPlatformForHost('freebsd', 'x64'), /not qualified/);
  assert.throws(() => containerPlatformForHost('darwin', 'ia32'), /not qualified/);
});

test('packaged release must be qualified for the actual host architecture', (t) => {
  const arm = releaseFixture(t, 'linux/arm64');
  assert.equal(packagedSandboxEnvironment(arm.root, UNIX_ENV, { platform: 'darwin', arch: 'arm64' }).LIOS_EXECUTION_SANDBOX_IMAGE, arm.release.image);
  assert.throws(() => packagedSandboxEnvironment(arm.root, UNIX_ENV, { platform: 'darwin', arch: 'x64' }), /expected linux\/amd64/);

  const x64 = releaseFixture(t, 'linux/amd64');
  assert.equal(packagedSandboxEnvironment(x64.root, UNIX_ENV, { platform: 'linux', arch: 'x64' }).LIOS_EXECUTION_SANDBOX_IMAGE, x64.release.image);
  assert.equal(packagedSandboxEnvironment(x64.root, WINDOWS_ENV, { platform: 'win32', arch: 'x64' }).LIOS_EXECUTION_SANDBOX_IMAGE, x64.release.image);
  assert.throws(() => packagedSandboxEnvironment(x64.root, UNIX_ENV, { platform: 'linux', arch: 'arm64' }), /expected linux\/arm64/);
});

test('packaged desktop bootstrap installs strict verified settings on Windows x64', (t) => {
  const { root, release } = releaseFixture(t, 'linux/amd64');
  const env = {};
  const result = bootstrapPackagedSandboxEnvironment({
    env,
    resourcesPath: root,
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
  });
  assert.equal(result.active, true);
  assert.equal(result.error, null);
  assert.equal(env.LIOS_EXECUTION_ISOLATION, 'strict');
  assert.equal(env.LIOS_EXECUTION_SANDBOX_ENGINE, 'docker');
  assert.equal(env.LIOS_EXECUTION_SANDBOX_TARGET, 'npipe:////./pipe/docker_engine');
  assert.equal(env.LIOS_EXECUTION_SANDBOX_IMAGE, release.image);
});

test('packaged desktop bootstrap fails closed when its architecture release is missing or mismatched', (t) => {
  const { root } = releaseFixture(t, 'linux/arm64');
  const env = {
    LIOS_EXECUTION_ISOLATION: 'legacy-host',
    LIOS_EXECUTION_SANDBOX_ENGINE: 'docker',
    LIOS_EXECUTION_SANDBOX_TARGET: 'tcp://10.0.0.2:2375',
    LIOS_EXECUTION_SANDBOX_IMAGE: 'sha256:' + 'c'.repeat(64),
  };
  const result = bootstrapPackagedSandboxEnvironment({
    env,
    resourcesPath: root,
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
  });
  assert.equal(result.active, true);
  assert.match(result.error, /expected linux\/amd64/);
  assert.equal(env.LIOS_EXECUTION_ISOLATION, 'strict');
  assert.equal(env.LIOS_EXECUTION_SANDBOX_ENGINE, undefined);
  assert.equal(env.LIOS_EXECUTION_SANDBOX_TARGET, undefined);
  assert.equal(env.LIOS_EXECUTION_SANDBOX_IMAGE, undefined);
  assert.match(env.LIOS_PACKAGED_SANDBOX_ERROR, /expected linux\/amd64/);
});

test('Windows uses a local named pipe while macOS and Linux use local Unix sockets', () => {
  assert.equal(defaultLocalDockerTarget({ platform: 'win32' }), 'npipe:////./pipe/docker_engine');
  assert.equal(validLocalEngineTarget('npipe:////./pipe/docker_engine', 'win32'), true);
  assert.equal(validLocalEngineTarget('unix:///var/run/docker.sock', 'win32'), false);
  assert.equal(validLocalEngineTarget('tcp://127.0.0.1:2375', 'win32'), false);
  assert.equal(validLocalEngineTarget('unix:///var/run/docker.sock', 'linux'), true);
  assert.equal(validLocalEngineTarget('npipe:////./pipe/docker_engine', 'linux'), false);
  assert.equal(validLocalEngineTarget('tcp://127.0.0.1:2375', 'linux'), false);
});

test('Unix target discovery prefers real socket files and keeps deterministic local fallbacks', (t) => {
  const home = path.join(os.tmpdir(), 'lios-sandbox-socket-selection');
  const colima = path.join(home, '.colima', 'default', 'docker.sock');
  const desktop = path.join(home, '.docker', 'run', 'docker.sock');
  const sockets = new Set();
  const originalStat = fs.statSync;
  t.mock.method(fs, 'statSync', (filename, ...args) => {
    if (filename !== colima && filename !== desktop && filename !== '/var/run/docker.sock') return originalStat(filename, ...args);
    return { isSocket: () => sockets.has(filename) };
  });
  assert.equal(defaultLocalDockerTarget({ platform: 'darwin', home }), `unix://${desktop}`);
  sockets.add(colima);
  assert.equal(defaultLocalDockerTarget({ platform: 'darwin', home }), `unix://${colima}`);
  sockets.add(desktop);
  assert.equal(defaultLocalDockerTarget({ platform: 'darwin', home }), `unix://${desktop}`);
  sockets.clear();
  assert.equal(defaultLocalDockerTarget({ platform: 'linux', home, env: {} }), 'unix:///var/run/docker.sock');
});

test('local Podman socket is paired with Podman while existing Docker socket defaults are unchanged', (t) => {
  assert.equal(inferLocalContainerEngine('unix:///run/user/1000/podman/podman.sock', 'linux'), 'podman');
  assert.equal(inferLocalContainerEngine('unix:///home/user/.docker/run/docker.sock', 'linux'), 'docker');
  assert.equal(inferLocalContainerEngine('unix:///home/user/.colima/default/docker.sock', 'darwin'), 'docker');
  assert.equal(inferLocalContainerEngine('npipe:////./pipe/docker_engine', 'win32'), 'docker');

  const { root } = releaseFixture(t, 'linux/amd64');
  const endpoint = 'unix:///run/user/1000/podman/podman.sock';
  const selected = packagedSandboxEnvironment(root, { LIOS_EXECUTION_SANDBOX_TARGET: endpoint }, {
    platform: 'linux', arch: 'x64',
  });
  assert.equal(selected.LIOS_EXECUTION_ISOLATION, 'strict');
  assert.equal(selected.LIOS_EXECUTION_SANDBOX_ENGINE, 'podman');
  assert.equal(selected.LIOS_EXECUTION_SANDBOX_TARGET, endpoint);
  assert.equal(selected.LIOS_EXECUTION_SANDBOX_IMAGE, 'sha256:' + 'b'.repeat(64));
  assert.equal(packagedSandboxEnvironment(root, UNIX_ENV, { platform: 'linux', arch: 'x64' })
    .LIOS_EXECUTION_SANDBOX_ENGINE, 'docker');
  assert.throws(() => packagedSandboxEnvironment(root, {
    LIOS_EXECUTION_SANDBOX_TARGET: endpoint, LIOS_EXECUTION_SANDBOX_ENGINE: 'docker',
  }, { platform: 'linux', arch: 'x64' }), /Podman socket must be paired/);
  assert.throws(() => packagedSandboxEnvironment(root, {
    LIOS_EXECUTION_SANDBOX_ENGINE: 'podman', LIOS_EXECUTION_SANDBOX_TARGET: 'npipe:////./pipe/docker_engine',
  }, { platform: 'win32', arch: 'x64' }), /Windows named-pipe execution is supported only with Docker/);
});

test('packaged Linux bootstrap discovers a real rootless Podman socket without invoking Docker', (t) => {
  const { root } = releaseFixture(t, 'linux/amd64');
  const home = path.join(os.tmpdir(), 'lios-podman-engine-selection');
  const runtimeDir = path.join(home, 'run', '1000');
  const socket = path.join(runtimeDir, 'podman', 'podman.sock');
  const original = fs.statSync;
  t.mock.method(fs, 'statSync', (filename, ...args) => {
    if (filename === socket) return { isSocket: () => true };
    if (filename === path.join(home, '.docker', 'run', 'docker.sock') ||
        filename === path.join(home, '.colima', 'default', 'docker.sock') ||
        filename === '/var/run/docker.sock' ||
        filename === `/run/user/${typeof process.getuid === 'function' ? process.getuid() : 1000}/podman/podman.sock`) {
      return { isSocket: () => false };
    }
    return original(filename, ...args);
  });
  const env = { XDG_RUNTIME_DIR: runtimeDir };
  const resolved = packagedSandboxEnvironment(root, env, { platform: 'linux', arch: 'x64', home });
  assert.equal(resolved.LIOS_EXECUTION_SANDBOX_ENGINE, 'podman');
  assert.equal(resolved.LIOS_EXECUTION_SANDBOX_TARGET, `unix://${socket}`);
  assert.equal(env.LIOS_EXECUTION_SANDBOX_ENGINE, undefined, 'resolution is read-only');
});

test('packaged image pins exact digest and rejects downgrade, image substitution and altered archive', (t) => {
  const { root, directory, release } = releaseFixture(t, 'linux/arm64');
  const host = { platform: 'darwin', arch: 'arm64' };
  assert.equal(verifyPackagedSandboxRelease(root, host), release.image);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_ISOLATION: 'legacy-host' }, { ...host, resolveTarget: false }), /downgraded/);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_SANDBOX_IMAGE: 'sha256:' + 'c'.repeat(64) }, { ...host, resolveTarget: false }), /differs/);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_BROWSER_CHROMIUM: '/usr/bin/google-chrome' }, { ...host, resolveTarget: false }), /browser paths differ/);
  fs.writeFileSync(path.join(directory, 'sandbox-image.tar.gz'), 'tampered');
  assert.throws(() => verifyPackagedSandboxRelease(root, host), /checksum differs/);
});

test('packaging refuses unqualified browser, stale image identity or altered browser inventory', (t) => {
  const { root, directory, release } = releaseFixture(t, 'linux/amd64');
  const lockFile = path.join(directory, 'source-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const rewrite = () => {
    const bytes = Buffer.from(JSON.stringify(lock));
    fs.writeFileSync(lockFile, bytes);
    release.provenance.sourceLockSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(directory, 'sandbox-image.json'), JSON.stringify(release));
  };
  lock.browser.qualification = 'pending-real-image-build';
  rewrite();
  assert.throws(() => packagedSandboxEnvironment(root, {}, { platform: 'win32', arch: 'x64', resolveTarget: false }), /qualified browser runtime/);
  lock.browser.qualification = 'qualified';
  lock.verifiedImageId = 'sha256:' + 'd'.repeat(64);
  rewrite();
  assert.throws(() => packagedSandboxEnvironment(root, {}, { platform: 'win32', arch: 'x64', resolveTarget: false }), /qualified browser runtime/);
  lock.verifiedImageId = release.image;
  rewrite();
  fs.writeFileSync(path.join(directory, 'browser-dependency-inventory.json'), '["tampered"]');
  assert.throws(() => packagedSandboxEnvironment(root, {}, { platform: 'win32', arch: 'x64', resolveTarget: false }), /inventory differs/);
});

test('remote container endpoints and unsupported host architectures fail closed', (t) => {
  const { root } = releaseFixture(t, 'linux/amd64');
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_SANDBOX_TARGET: 'tcp://10.0.0.2:2375' }, { platform: 'linux', arch: 'x64' }), /local Unix-socket/);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_SANDBOX_TARGET: 'tcp://10.0.0.2:2375' }, { platform: 'win32', arch: 'x64' }), /local named-pipe/);
  assert.throws(() => packagedSandboxEnvironment(root, {}, { platform: 'freebsd', arch: 'x64', resolveTarget: false }), /not qualified/);
});
