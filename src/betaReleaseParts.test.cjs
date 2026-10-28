const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {splitInstaller,reassembleInstaller,verifyInstallerParts}=require('./betaReleaseParts.cjs');
test('authenticated parts restore exact installer and reject tampering, foreign keys and overwrites',async t=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lios-parts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const parts=path.join(root,'parts'),output=path.join(root,'out');fs.mkdirSync(parts);fs.mkdirSync(output);const file=path.join(root,'LiOS-test.dmg'),bytes=crypto.randomBytes(257);fs.writeFileSync(file,bytes);const keys=crypto.generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}),trustedPublicKey=keys.publicKey.export({type:'spki',format:'pem'});const manifest=await splitInstaller({file,outputDir:parts,privateKey,partBytes:100});assert.deepEqual(manifest.body.parts.map(p=>p.bytes),[100,100,57]);
const options={manifest,partsDir:parts,outputDir:output,trustedPublicKey};await assert.rejects(reassembleInstaller({...options,trustedPublicKey:crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}));
const first=path.join(parts,manifest.body.parts[0].name),original=fs.readFileSync(first);fs.writeFileSync(first,Buffer.alloc(100));await assert.rejects(reassembleInstaller(options),/integrity mismatch/);assert.deepEqual(fs.readdirSync(output),[]);fs.writeFileSync(first,original);const result=await reassembleInstaller(options);assert.deepEqual(fs.readFileSync(result.file),bytes);assert.equal(result.installApproved,false);await assert.rejects(reassembleInstaller(options));assert.deepEqual(fs.readFileSync(result.file),bytes);
});
test('split refuses symlink inputs and pre-existing parts without deleting them',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'lios-parts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'installer.zip');fs.writeFileSync(file,'abcdef');const keys=crypto.generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});fs.writeFileSync(file+'.part001','preserve');await assert.rejects(splitInstaller({file,outputDir:root,privateKey,partBytes:3}));assert.equal(fs.readFileSync(file+'.part001','utf8'),'preserve');if(process.platform!=='win32'){const link=path.join(root,'alias.zip');fs.symlinkSync(file,link);await assert.rejects(splitInstaller({file:link,outputDir:root,privateKey}),/non-symlink/);}});

test('D10 read-only signed multipart proof verifies bytes and refuses foreign keys and corrupted parts',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lios-parts-verify-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const parts=path.join(root,'parts');
  fs.mkdirSync(parts);
  const installer=path.join(root,'LiOS-test-mac-arm64-beta.dmg');
  fs.writeFileSync(installer,crypto.randomBytes(513));
  const keys=crypto.generateKeyPairSync('ed25519');
  const privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
  const trustedPublicKey=keys.publicKey.export({type:'spki',format:'pem'});
  const manifest=await splitInstaller({file:installer,outputDir:parts,privateKey,partBytes:200});
  const out=await verifyInstallerParts({manifest,partsDir:parts,trustedPublicKey});
  assert.equal(out.name,path.basename(installer));
  assert.equal(out.bytes,513);
  assert.equal(out.partCount,3);
  assert.equal(out.sha256,manifest.body.installer.sha256);
  assert.equal(out.installApproved,false);
  assert.deepEqual(fs.readdirSync(parts).sort(),manifest.body.parts.map(p=>p.name).sort());
  await assert.rejects(verifyInstallerParts({manifest,partsDir:parts,trustedPublicKey:
    crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})}),/Untrusted/);
  const first=path.join(parts,manifest.body.parts[0].name);
  const original=fs.readFileSync(first);
  fs.writeFileSync(first,Buffer.alloc(original.length));
  await assert.rejects(verifyInstallerParts({manifest,partsDir:parts,trustedPublicKey}),/integrity mismatch/);
  fs.writeFileSync(first,original);
  assert.equal((await verifyInstallerParts({manifest,partsDir:parts,trustedPublicKey})).partCount,3);
});
