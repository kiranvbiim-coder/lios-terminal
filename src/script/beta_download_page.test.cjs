'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { renderDownloadPage } = require('./beta_download_page.cjs');

const hex = c => c.repeat(64);
const manifest = (over = {}) => ({ body: { schema: 1, kind: 'lios-installer-parts',
  installer: { name: 'LiOS-1.0.0-beta.6-mac-arm64.dmg', bytes: 1_500_000_000, sha256: hex('a') },
  parts: [
    { name: 'LiOS-1.0.0-beta.6-mac-arm64.dmg.part001', bytes: 1_000_000_000, sha256: hex('b') },
    { name: 'LiOS-1.0.0-beta.6-mac-arm64.dmg.part002', bytes: 500_000_000, sha256: hex('c') }],
  ...over }, signature: {} });

test('page lists every part with its hash, the joined hash and honest limits', () => {
  const html = renderDownloadPage({ manifest: manifest(), version: '1.0.0-beta.6', baseUrl: 'https://downloads.example.com/lios' });
  for (const part of manifest().body.parts) assert.match(html, new RegExp(`href="https://downloads.example.com/lios/${part.name}"`));
  assert.match(html, new RegExp(hex('a')));
  assert.match(html, /cat .*part001 .*part002 &gt; LiOS-1\.0\.0-beta\.6-mac-arm64\.dmg/);
  assert.match(html, /not notarized/);
  assert.match(html, /Windows version is not available/);
  assert.doesNotMatch(html, /<script/i);
});

test('page refuses inconsistent part names, non-https or credentialed URLs and hostile versions', () => {
  const bad = manifest(); bad.body.parts[1].name = 'other.part002';
  assert.throws(() => renderDownloadPage({ manifest: bad, version: '1.0.0', baseUrl: 'https://a.example' }), /part metadata/);
  for (const baseUrl of ['http://a.example', 'https://u:p@a.example', 'https://a.example/?x=1'])
    assert.throws(() => renderDownloadPage({ manifest: manifest(), version: '1.0.0', baseUrl }), /https/);
  assert.throws(() => renderDownloadPage({ manifest: manifest(), version: '<b>', baseUrl: 'https://a.example' }), /version/);
});
