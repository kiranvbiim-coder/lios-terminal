#!/usr/bin/env node
/* Restore original LiOS instrument catalogs locally without committing vendor datasets to public source. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SOURCES = [
  ['tickers.json', 'legacy', 'f9edacb9d8dc04485b868ab9ee44638fbbcf416d'],
  ['crypto_coingecko_ids.json', 'crypto', 'ca29d5000a89a7382309d667800e495010662662'],
  ['provider_ingested_universe.json', 'provider', '8b9e82b4143d453a0d0c8e7804820cf7a778cd43'],
];
const MAX_BYTES = 32 * 1024 * 1024;
const MANIFEST = 'catalog-recovery-manifest.json';
const defaultDir = path.resolve(__dirname, '..', 'server', 'data');
function fail(message) { throw new Error(message); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function gitHash(bytes) {
  return crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
function argumentsFor(argv) {
  const args = { mode: 'check', out: defaultDir, source: null, force: false };
  for (const item of argv) {
    if (item === '--check') args.mode = 'check';
    else if (item === '--from-private') args.mode = 'private';
    else if (item.startsWith('--source-dir=')) { args.mode = 'local'; args.source = path.resolve(item.slice('--source-dir='.length)); }
    else if (item.startsWith('--out-dir=')) args.out = path.resolve(item.slice('--out-dir='.length));
    else if (item === '--force') args.force = true;
    else fail('Unexpected option: ' + item);
  }
  if (args.mode === 'local' && !args.source) fail('Supply --source-dir=PATH');
  return args;
}
function validate(name, kind, bytes) {
  if (!bytes.length || bytes.length > MAX_BYTES) fail(name + ': invalid file size');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { fail(name + ': invalid JSON'); }
  if (kind === 'crypto') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(name + ': expected ID mapping');
    const entries = Object.entries(data);
    if (entries.length < 100 || entries.some(([key, value]) => !key.trim() || typeof value?.id !== 'string' || !value.id.trim())) fail(name + ': malformed crypto IDs');
    return entries.length;
  }
  if (!Array.isArray(data) || data.length < (kind === 'legacy' ? 1000 : 100)) fail(name + ': insufficient records');
  for (const row of data) {
    if (!row || typeof row.symbol !== 'string' || !row.symbol.trim() || typeof row.name !== 'string' || !row.name.trim()) fail(name + ': missing instrument identity');
    if (kind === 'legacy' && (typeof row.exchange !== 'string' || !row.exchange.trim())) fail(name + ': missing exchange');
    if (kind === 'provider' && (typeof row.provider !== 'string' || !row.provider.trim())) fail(name + ': missing source provenance');
  }
  return data.length;
}
function checked(file, name, kind) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || !stat.size || stat.size > MAX_BYTES) fail(name + ': invalid regular file');
  const bytes = fs.readFileSync(file);
  return { bytes, count: validate(name, kind, bytes), sha256: hash(bytes) };
}
function privateBlob(repo, name, kind, expected) {
  const result = spawnSync('gh', ['api', 'repos/' + repo + '/git/blobs/' + expected], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail('Private GitHub snapshot unavailable. Authenticate with gh auth login and verify LIOS_CATALOG_SOURCE_REPO access.');
  let response;
  try { response = JSON.parse(result.stdout); } catch { fail('Invalid GitHub response'); }
  if (response.encoding !== 'base64' || typeof response.content !== 'string') fail(name + ': invalid blob encoding');
  const bytes = Buffer.from(response.content.replace(/\s/g, ''), 'base64');
  if (bytes.length !== response.size || gitHash(bytes) !== expected) fail(name + ': source Git blob checksum mismatch');
  return { bytes, count: validate(name, kind, bytes), sha256: hash(bytes), sourceGitBlob: expected };
}
function writeAtomically(file, bytes) {
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function check(dir) {
  const manifestFile = path.join(dir, MANIFEST);
  let manifest = null;
  if (fs.existsSync(manifestFile)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { fail('Invalid catalog recovery manifest JSON'); }
    if (manifest?.version !== 1 || !manifest.files) fail('Invalid catalog recovery manifest');
  }
  for (const [name, kind] of SOURCES) {
    const record = checked(path.join(dir, name), name, kind);
    if (manifest && (manifest.files[name]?.sha256 !== record.sha256 || manifest.files[name]?.count !== record.count)) fail(name + ': checksum differs from recovery manifest');
    process.stdout.write(name + ': ' + record.count + ' entries, SHA-256 ' + record.sha256.slice(0, 16) + '\n');
  }
  if (!manifest) process.stderr.write('No catalog recovery manifest; structure verified, original provenance not attested.\n');
}
function restore(args) {
  const sourceRepo = process.env.LIOS_CATALOG_SOURCE_REPO || '';
  if (args.mode === 'private' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceRepo)) fail('Set LIOS_CATALOG_SOURCE_REPO=owner/private-repository');
  const records = SOURCES.map(([name, kind, sha]) => ({
    name, kind, ...(args.mode === 'private'
      ? privateBlob(sourceRepo, name, kind, sha)
      : checked(path.join(args.source, name), name, kind)),
  }));
  fs.mkdirSync(args.out, { recursive: true, mode: 0o700 });
  // Check all conflicts before changing any output.
  for (const record of records) {
    const target = path.join(args.out, record.name);
    if (!fs.existsSync(target)) continue;
    const existing = checked(target, record.name, record.kind);
    if (existing.sha256 !== record.sha256 && !args.force) fail(record.name + ': local version differs; rerun with --force to replace intentionally');
  }
  for (const record of records) {
    const target = path.join(args.out, record.name);
    if (!fs.existsSync(target) || hash(fs.readFileSync(target)) !== record.sha256) writeAtomically(target, record.bytes);
    process.stdout.write(record.name + ': restored ' + record.count + ' records\n');
  }
  const manifest = { version: 1, files: {} };
  for (const { name, count, sha256, sourceGitBlob } of records) {
    manifest.files[name] = { count, sha256, ...(sourceGitBlob ? { sourceGitBlob } : {}) };
  }
  writeAtomically(path.join(args.out, MANIFEST), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  check(args.out);
}
try {
  const args = argumentsFor(process.argv.slice(2));
  if (args.mode === 'check') check(args.out);
  else restore(args);
} catch (error) {
  process.stderr.write('LiOS instrument catalog recovery: ' + error.message + '\n');
  process.exitCode = 1;
}
