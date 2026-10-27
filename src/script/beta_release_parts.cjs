#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { splitInstaller, reassembleInstaller } = require('../betaReleaseParts.cjs');
async function main(args) {
  if (args[0] === 'split' && args.length === 4) {
    if (process.env.CI) throw new Error('Owner signing is unavailable in CI');
    // Signing material comes only through stdin, never argv, environment or the manifest.
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 16384) throw new Error('Signing input exceeds limit');
      chunks.push(chunk);
    }
    const privateKey = Buffer.concat(chunks);
    try {
      if (fs.existsSync(args[3])) throw new Error('Refusing existing manifest');
      const manifest = await splitInstaller({ file: path.resolve(args[1]), outputDir: path.resolve(args[2]), privateKey });
      fs.writeFileSync(args[3], JSON.stringify(manifest, null, 2) + '\n', {flag:'wx',mode:0o600});
      console.log('Signed multipart transport index created. No installer executed or release published.');
    } finally { privateKey.fill(0); for (const chunk of chunks) chunk.fill(0); }
  } else if (args[0] === 'join' && args.length === 5) {
    const stat=fs.lstatSync(args[1]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 131072) throw new Error('Invalid manifest file');
    const result = await reassembleInstaller({ manifest:JSON.parse(fs.readFileSync(args[1],'utf8')), partsDir:path.resolve(args[2]), outputDir:path.resolve(args[3]), trustedPublicKey:fs.readFileSync(args[4],'utf8') });
    console.log(JSON.stringify(result,null,2));
  } else throw new Error('Usage: split INSTALLER PARTS_DIR INDEX_JSON (Ed25519 private key on stdin), or join INDEX_JSON PARTS_DIR OUTPUT_DIR INDEPENDENT_PUBLIC_KEY_PEM');
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Multipart operation refused; verify inputs, independent trust key, free space and integrity.');process.exitCode=1;});
module.exports={main};
