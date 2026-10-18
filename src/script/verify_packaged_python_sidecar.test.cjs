const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { evidenceOutputPath } = require('./verify_packaged_python_sidecar.cjs');

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
