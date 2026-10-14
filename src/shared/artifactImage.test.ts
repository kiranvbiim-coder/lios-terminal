import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { artifactImageBytes, artifactImageDataUri, readArtifactImage, ARTIFACT_IMAGE_LIMITS } from './artifactImage';
const dataBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7xoAAAAASUVORK5CYII=';
const raw=Uint8Array.from(atob(dataBase64),c=>c.charCodeAt(0));
const image={mimeType:'image/png' as const,dataBase64,sha256:[...sha256(raw)].map(n=>n.toString(16).padStart(2,'0')).join(''),byteLength:raw.length,width:1,height:1,sourceRef:'attachment:authored'};
test('captured image preserves actual bytes mime dimensions and source integrity',()=>{const captured=readArtifactImage(image);assert.deepEqual(artifactImageBytes(captured),raw);assert.equal(artifactImageDataUri(captured),'data:image/png;base64,'+dataBase64);assert.equal(captured.sourceRef,'attachment:authored');});
test('image metadata cannot bypass actual byte hash signature dimensions or budget',()=>{assert.throws(()=>readArtifactImage({...image,sha256:'a'.repeat(64)}),/integrity/);assert.throws(()=>readArtifactImage({...image,width:2}),/dimensions/);assert.throws(()=>readArtifactImage({...image,byteLength:raw.length+1}),/count/);assert.throws(()=>readArtifactImage({...image,mimeType:'image/jpeg'}),/JPEG/);assert.throws(()=>readArtifactImage({...image,dataBase64:'https://example.test/image.png'}),/base64/);assert.throws(()=>readArtifactImage({...image,width:ARTIFACT_IMAGE_LIMITS.dimension+1}));assert.throws(()=>readArtifactImage({...image,dataBase64:dataBase64+'=',byteLength:raw.length}),/base64/);});
