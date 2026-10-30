#!/usr/bin/env node
'use strict';
// Renders a static, script-free download page from a signed multipart index. The page states hashes
// and manual verification steps only; it never claims notarization, Windows support or signature trust.
const fs = require('node:fs');
const path = require('node:path');
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{1,180}$/;
const HEX = /^[a-f0-9]{64}$/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderDownloadPage({ manifest, version, baseUrl }) {
  const body = manifest && manifest.body;
  if (!body || body.schema !== 1 || body.kind !== 'lios-installer-parts' || !Array.isArray(body.parts) || !body.parts.length)
    throw new Error('Invalid multipart index');
  const installer = body.installer;
  if (!installer || !NAME.test(installer.name) || !HEX.test(installer.sha256) || !Number.isSafeInteger(installer.bytes)) throw new Error('Invalid installer metadata');
  if (!/^[0-9A-Za-z.+-]{1,40}$/.test(version)) throw new Error('Invalid version');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('baseUrl must be a plain https URL');
  const prefix = base.href.endsWith('/') ? base.href : base.href + '/';
  for (const [i, part] of body.parts.entries()) {
    if (part.name !== installer.name + '.part' + String(i + 1).padStart(3, '0') || !HEX.test(part.sha256) || !Number.isSafeInteger(part.bytes)) throw new Error('Invalid part metadata');
  }
  const gb = bytes => (bytes / 1e9).toFixed(2) + ' GB';
  const rows = body.parts.map(part => `<tr><td><a href="${escapeHtml(prefix + part.name)}">${escapeHtml(part.name)}</a></td><td>${gb(part.bytes)}</td><td><code>${escapeHtml(part.sha256)}</code></td></tr>`).join('\n');
  const names = body.parts.map(part => part.name).join(' ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LiOS Intelligence Terminal ${escapeHtml(version)} for macOS (beta)</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><main>
<h1>LiOS Intelligence Terminal ${escapeHtml(version)} &middot; macOS beta</h1>
<p><strong>Beta.</strong> Apple Silicon (arm64). The app is ad-hoc signed and <strong>not notarized</strong> by Apple, so macOS will warn on first launch. A Windows version is not available yet.</p>
<h2>1. Download all parts into one folder</h2>
<table><thead><tr><th>Part</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>2. Join and verify</h2>
<pre>cat ${escapeHtml(names)} &gt; ${escapeHtml(installer.name)}
shasum -a 256 ${escapeHtml(installer.name)}</pre>
<p>The result must equal <code>${escapeHtml(installer.sha256)}</code> (${gb(installer.bytes)}). If it does not, delete the files and download again. Do not open a file whose hash differs.</p>
<h2>3. Install</h2>
<p>Open the disk image and drag LiOS to Applications. On first launch, right-click the app, choose <em>Open</em>, then confirm. Your data stays on your Mac.</p>
<p>These hashes are published by the same site as the files. For independent verification, compare them with the signed index using the owner's separately published public key.</p>
</main></body></html>
`;
}

function main(args) {
  if (args.length !== 4) throw new Error('Usage: INDEX_JSON VERSION BASE_URL OUTPUT_HTML');
  const stat = fs.lstatSync(args[0]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw new Error('Invalid index file');
  const html = renderDownloadPage({ manifest: JSON.parse(fs.readFileSync(args[0], 'utf8')), version: args[1], baseUrl: args[2] });
  fs.writeFileSync(path.resolve(args[3]), html, { flag: 'wx', mode: 0o644 });
  console.log('Download page written. Nothing was uploaded or published.');
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { renderDownloadPage };
