const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  evidenceOutputPath, sidecarExecutableIdentity, writeSidecarEvidenceReport,
} = require('./verify_packaged_python_sidecar.cjs');

test('sidecar evidence stays outside the signed app for app and Resources entrypoints', () => {
  const bundle = path.resolve('dist-app/mac-arm64/LiOS.app');
  const expected = path.join(path.dirname(bundle), 'python-sidecar-evidence.json');
  for (const root of [bundle, path.join(bundle, 'Contents/Resources')]) {
    assert.equal(evidenceOutputPath(root), expected);
    assert.throws(() => evidenceOutputPath(root, path.join(bundle, 'Contents/report.json')), /outside the signed application/);
  }
  const external = path.resolve('qualification/sidecar.json');
  assert.equal(evidenceOutputPath(path.join(bundle, 'Contents/Resources'), external), external);
});

test('native sidecar qualification is bound to the exact bounded executable bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-pack-sidecar-'));
  const exe = path.join(root, 'lios-python-sidecar');
  try {
    fs.writeFileSync(exe, Buffer.from('synthetic executable image version 1'));
    const original = sidecarExecutableIdentity(exe);
    assert.deepEqual(original, {
      sha256: crypto.createHash('sha256').update('synthetic executable image version 1').digest('hex'),
      bytes: Buffer.byteLength('synthetic executable image version 1'),
    });
    fs.writeFileSync(exe, Buffer.from('synthetic executable image version 2'));
    const changed = sidecarExecutableIdentity(exe);
    assert.notEqual(changed.sha256, original.sha256, 'changing the image must invalidate earlier proof');
    assert.throws(() => sidecarExecutableIdentity(root), /bounded regular executable/);
    fs.writeFileSync(exe, '');
    assert.throws(() => sidecarExecutableIdentity(exe), /bounded regular executable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native proof cannot overwrite an earlier record or mutate packaged resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-pack-evidence-'));
  const resources = path.join(root, 'Resources');
  const report = path.join(root, 'python-sidecar-evidence.json');
  const inside = path.join(resources, 'untrusted-evidence.json');
  fs.mkdirSync(resources);
  try {
    assert.throws(
      () => writeSidecarEvidenceReport(resources, inside, { status: 'verified' }),
      /outside packaged resources/,
    );
    assert.equal(fs.existsSync(inside), false);
    writeSidecarEvidenceReport(resources, report, { status: 'verified', sidecarExecutable: { sha256: 'test' } });
    assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')), {
      status: 'verified', sidecarExecutable: { sha256: 'test' },
    });
    assert.throws(() => writeSidecarEvidenceReport(resources, report, { status: 'failed' }), /EEXIST/);
    assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).status, 'verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
