const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { defaultLocalDockerSocket, packagedSandboxEnvironment, verifyPackagedSandboxRelease } = require('./desktopSandboxImage.cjs');

function releaseFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-sandbox-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'sandbox-image-dist');
  fs.mkdirSync(directory);
  const archive = Buffer.from('docker-image-archive-for-integrity-test');
  fs.writeFileSync(path.join(directory, 'sandbox-image.tar.gz'), archive);
  const inventory = Buffer.from('[]');
  const inventorySha256 = crypto.createHash('sha256').update(inventory).digest('hex');
  for (const file of ['browser-artifact-inventory.json', 'browser-dependency-inventory.json']) {
    fs.writeFileSync(path.join(directory, file), inventory);
  }
  const sourceLock = {
    schemaVersion: 1, releaseStatus: 'ready', acceptedPlatforms: ['linux/arm64'],
    verifiedImageId: 'sha256:' + 'b'.repeat(64),
    provenance: { verified: true },
    baseImage: { platform: 'linux/arm64', reference: 'python@sha256:' + 'a'.repeat(64) },
    node: { version: '22.12.0' }, xlsx: { version: '0.20.3' }, docling: { version: '2.129.0' },
    browser: {
      playwrightVersion: '1.63.0', chromiumRevision: '1243', browserVersion: '153.0.8010.12',
      modulePath: '/opt/lios/node_modules/playwright-core', executablePath: '/opt/lios/browser/chromium',
      qualification: 'qualified',
      artifactInventory: { file: 'browser-artifact-inventory.json', sha256: inventorySha256 },
      dependencyInventory: { file: 'browser-dependency-inventory.json', sha256: inventorySha256 },
    },
  };
  const lockBytes = Buffer.from(JSON.stringify(sourceLock));
  fs.writeFileSync(path.join(directory, 'source-lock.json'), lockBytes);
  const release = {
    schemaVersion: 1, platform: 'linux/arm64', image: 'sha256:' + 'b'.repeat(64),
    archive: 'sandbox-image.tar.gz', archiveSha256: crypto.createHash('sha256').update(archive).digest('hex'),
    provenance: {
      sourceLock: 'source-lock.json', sourceLockSha256: crypto.createHash('sha256').update(lockBytes).digest('hex'),
      baseImage: { reference: sourceLock.baseImage.reference }, node: sourceLock.node,
      xlsx: sourceLock.xlsx, docling: sourceLock.docling, browser: sourceLock.browser,
    },
  };
  fs.writeFileSync(path.join(directory, 'sandbox-image.json'), JSON.stringify(release));
  return { root, directory, release };
}

test('packaged image pins the exact digest and rejects downgraded isolation or altered archive', (t) => {
  const { root, directory, release } = releaseFixture(t);
  assert.equal(verifyPackagedSandboxRelease(root), release.image);
  assert.equal(packagedSandboxEnvironment(root, {}).LIOS_EXECUTION_SANDBOX_IMAGE, release.image);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_ISOLATION: 'legacy-host' }), /downgraded/);
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_SANDBOX_IMAGE: 'sha256:' + 'c'.repeat(64) }), /differs/);
  assert.equal(packagedSandboxEnvironment(root, {}).LIOS_EXECUTION_BROWSER_CHROMIUM, '/opt/lios/browser/chromium');
  assert.throws(() => packagedSandboxEnvironment(root, { LIOS_EXECUTION_BROWSER_CHROMIUM: '/usr/bin/google-chrome' }), /browser paths differ/);
  fs.writeFileSync(path.join(directory, 'sandbox-image.tar.gz'), 'tampered');
  assert.throws(() => verifyPackagedSandboxRelease(root), /checksum differs/);
});

test('packaged sandbox prefers an existing local Docker socket and supports Colima without remote contexts', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-sandbox-socket-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const colima = path.join(home, '.colima', 'default', 'docker.sock');
  const desktop = path.join(home, '.docker', 'run', 'docker.sock');
  fs.mkdirSync(path.dirname(colima), { recursive: true });
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  assert.equal(defaultLocalDockerSocket(home), `unix://${desktop}`);
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(colima, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(defaultLocalDockerSocket(home), `unix://${colima}`);
});

test('packaging refuses an unqualified browser, an old image, or altered browser inventory', (t) => {
  const { root, directory, release } = releaseFixture(t);
  const lockFile = path.join(directory, 'source-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  const rewrite = () => {
    const bytes = Buffer.from(JSON.stringify(lock));
    fs.writeFileSync(lockFile, bytes);
    release.provenance.sourceLockSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(directory, 'sandbox-image.json'), JSON.stringify(release));
  };
  lock.browser.qualification = 'pending-real-image-build-and-isolated-broker-navigation-cancellation-extinction';
  rewrite();
  assert.throws(() => packagedSandboxEnvironment(root, {}), /qualified browser runtime/);
  lock.browser.qualification = 'qualified';
  lock.verifiedImageId = 'sha256:' + 'd'.repeat(64);
  rewrite();
  assert.throws(() => packagedSandboxEnvironment(root, {}), /qualified browser runtime/);
  lock.verifiedImageId = release.image;
  rewrite();
  fs.writeFileSync(path.join(directory, 'browser-dependency-inventory.json'), '[\"tampered\"]');
  assert.throws(() => packagedSandboxEnvironment(root, {}), /inventory differs/);
});
