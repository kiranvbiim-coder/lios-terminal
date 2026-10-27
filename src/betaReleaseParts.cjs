"use strict";
// Transport only: never downloads, installs, executes, or establishes OS publisher trust.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { publicKeyFingerprint, MAX_RELEASE_ASSET_BYTES } = require('./betaReleaseManifest.cjs');
const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{1,180}$/;
const MAX_INSTALLER = 16_000_000_000;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
function child(dir, name) { requireThat(typeof name === 'string' && NAME.test(name), 'Unsafe artifact name'); return path.join(dir, name); }
function directory(dir) { const s=fs.lstatSync(dir); requireThat(s.isDirectory()&&!s.isSymbolicLink(),'Expected real directory'); }
async function openRead(file) {
  const before=fs.lstatSync(file); requireThat(before.isFile()&&!before.isSymbolicLink(),'Expected non-symlink regular file');
  const fd=await fs.promises.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  const actual=await fd.stat();
  if (!actual.isFile()||actual.dev!==before.dev||actual.ino!==before.ino) { await fd.close(); throw new Error('File identity changed'); }
  return fd;
}
async function splitInstaller({file,outputDir,privateKey,partBytes=1_000_000_000}) {
  directory(outputDir); const name=path.basename(file); child(outputDir,name);
  requireThat(Number.isSafeInteger(partBytes)&&partBytes>0&&partBytes<=MAX_RELEASE_ASSET_BYTES,'Invalid part size');
  const key=crypto.createPrivateKey(privateKey);requireThat(key.asymmetricKeyType==='ed25519','Ed25519 key required');
  const input=await openRead(file), created=[];
  try {
    const before=await input.stat();requireThat(before.size>0&&before.size<=MAX_INSTALLER,'Invalid installer size');
    requireThat(Math.ceil(before.size/partBytes)<=100,'Too many parts');
    const totalHash=crypto.createHash('sha256'),parts=[];let offset=0;
    while(offset<before.size) {
      const partName=name+'.part'+String(parts.length+1).padStart(3,'0'), dest=child(outputDir,partName);
      const output=await fs.promises.open(dest,'wx',0o600);created.push(dest);
      const hash=crypto.createHash('sha256');let bytes=0;const target=Math.min(partBytes,before.size-offset);
      try { const buffer=Buffer.allocUnsafe(Math.min(1024*1024,target));while(bytes<target){const read=await input.read(buffer,0,Math.min(buffer.length,target-bytes),offset+bytes);requireThat(read.bytesRead>0,'Installer truncated');const chunk=buffer.subarray(0,read.bytesRead);let written=0;while(written<chunk.length){const w=await output.write(chunk,written,chunk.length-written);requireThat(w.bytesWritten>0,'Short output write');written+=w.bytesWritten;}hash.update(chunk);totalHash.update(chunk);bytes+=chunk.length;}await output.sync(); } finally {await output.close();}
      parts.push({name:partName,bytes,sha256:hash.digest('hex')});offset+=bytes;
    }
    const after=await input.stat();requireThat(after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'Installer changed during split');
    const body={schema:1,kind:'lios-installer-parts',installer:{name,bytes:offset,sha256:totalHash.digest('hex')},parts};
    return {body,signature:{algorithm:'Ed25519',fingerprint:publicKeyFingerprint(crypto.createPublicKey(key)),value:crypto.sign(null,Buffer.from(JSON.stringify(body)),key).toString('base64')}};
  } catch(e) {for(const f of created)await fs.promises.unlink(f).catch(()=>{});throw e;} finally {await input.close();}
}
async function reassembleInstaller({manifest,partsDir,outputDir,trustedPublicKey}) {
  directory(partsDir);directory(outputDir);
  const {body,signature}=manifest;const key=crypto.createPublicKey(trustedPublicKey);
  requireThat(signature?.algorithm==='Ed25519'&&signature.fingerprint===publicKeyFingerprint(key)&&crypto.verify(null,Buffer.from(JSON.stringify(body)),key,Buffer.from(signature.value,'base64')),'Untrusted multipart manifest');
  requireThat(body.schema===1&&body.kind==='lios-installer-parts'&&Array.isArray(body.parts)&&body.parts.length>0&&body.parts.length<=100,'Invalid multipart manifest');
  const installer=body.installer;const destination=child(outputDir,installer.name);
  requireThat(Number.isSafeInteger(installer.bytes)&&installer.bytes>0&&installer.bytes<=MAX_INSTALLER&&/^[a-f0-9]{64}$/.test(installer.sha256),'Invalid installer metadata');
  let sum=0;for(const [i,p] of body.parts.entries()){requireThat(p.name===installer.name+'.part'+String(i+1).padStart(3,'0')&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&p.bytes<=MAX_RELEASE_ASSET_BYTES&&/^[a-f0-9]{64}$/.test(p.sha256),'Invalid part metadata');sum+=p.bytes;}requireThat(sum===installer.bytes,'Inconsistent total size');
  const temporary=child(outputDir,installer.name+'.assembling-'+crypto.randomUUID());const out=await fs.promises.open(temporary,'wx',0o600);let complete=false;
  try {const total=crypto.createHash('sha256');for(const p of body.parts){const input=await openRead(child(partsDir,p.name));try {const h=crypto.createHash('sha256');let bytes=0;for await(const chunk of input.createReadStream({autoClose:false})){bytes+=chunk.length;requireThat(bytes<=p.bytes,'Oversized part');h.update(chunk);total.update(chunk);let written=0;while(written<chunk.length){const w=await out.write(chunk,written,chunk.length-written);requireThat(w.bytesWritten>0,'Short output write');written+=w.bytesWritten;}}requireThat(bytes===p.bytes&&h.digest('hex')===p.sha256,'Part integrity mismatch');}finally{await input.close();}}
    requireThat(total.digest('hex')===installer.sha256,'Installer integrity mismatch');await out.sync();await out.close();await fs.promises.link(temporary,destination);complete=true;
    return {file:destination,bytes:installer.bytes,sha256:installer.sha256,qualification:'authenticated_transport_only',installApproved:false};
  } finally {if(!complete)await out.close().catch(()=>{});await fs.promises.unlink(temporary).catch(()=>{});}
}
module.exports={splitInstaller,reassembleInstaller};
