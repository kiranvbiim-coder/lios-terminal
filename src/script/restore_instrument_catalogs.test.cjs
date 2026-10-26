'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const script = path.join(__dirname, 'restore_instrument_catalogs.cjs');

function execute(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}
function createFixture(root) {
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'tickers.json'), JSON.stringify(Array.from({ length: 1000 }, (_, i) =>
    ({ symbol: 'T' + i, name: 'Stock ' + i, exchange: 'NASDAQ' }))));
  fs.writeFileSync(path.join(source, 'provider_ingested_universe.json'), JSON.stringify(Array.from({ length: 100 }, (_, i) =>
    ({ symbol: 'T' + i, name: 'Stock ' + i, provider: 'sec_edgar' }))));
  fs.writeFileSync(path.join(source, 'crypto_coingecko_ids.json'), JSON.stringify(Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => ['C' + i, { id: 'coin-' + i, name: 'Coin ' + i }]))));
  return source;
}
test('restores, checks integrity, refuses overwrite and repairs with explicit force', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = createFixture(root);
  const out = path.join(root, 'dest');
  const args = ['--source-dir=' + source, '--out-dir=' + out];
  assert.equal(execute(args).status, 0);
  assert.equal(execute(['--check', '--out-dir=' + out]).status, 0);
  const file = path.join(out, 'tickers.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('T0', 'TAMPER'));
  assert.equal(execute(['--check', '--out-dir=' + out]).status, 1);
  assert.equal(execute(args).status, 1);
  assert.equal(execute([...args, '--force']).status, 0);
  assert.equal(execute(['--check', '--out-dir=' + out]).status, 0);
});
test('rejects absent or incomplete catalogs without publishing data', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(execute(['--check', '--out-dir=' + root]).status, 1);
  const source = createFixture(root);
  fs.writeFileSync(path.join(source, 'crypto_coingecko_ids.json'), '{}');
  assert.equal(execute(['--source-dir=' + source, '--out-dir=' + path.join(root, 'dest')]).status, 1);
});
