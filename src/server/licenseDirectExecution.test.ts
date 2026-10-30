import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lios-license-direct-'));
process.env.LIMURIA_DATA_DIR = root;
process.env.LIOS_LICENSE_CACHE_DIR = path.join(root, 'license');
process.env.LIOS_DESKTOP_PACKAGED = 'true';
process.env.LIOS_EXECUTION_ISOLATION = 'strict';
delete process.env.DATABASE_URL;
delete process.env.HOST;
const {default:express} = await import('express');
const {default:session} = await import('express-session');
const {default:passport} = await import('passport');
const {eq} = await import('drizzle-orm');
const {initDb,getDb,closeDb} = await import('./db');
const {organizations,organizationLicenses,users} = await import('@shared/schema');
const {configurePassport,registerAuthRoutes} = await import('./auth');
const {registerLicenseRoutes} = await import('./licenseRoutes');
const {registerVoiceRoutes} = await import('./voiceRoutes');
const {registerUniversalDataFabricRoutes} = await import('./universalDataFabricRoutes');
const {registerTranscriptionProvider,unregisterTranscriptionProvider} = await import('./p12VoiceRuntime');
const {createProject} = await import('./projectStore');

// The one installed STT fixture stands in for native model work; expiry must refuse before entering it.
let recognitionCalls = 0;
registerTranscriptionProvider({descriptor:{id:'test.license-stt',label:'License STT fixture',local:true,languages:['en'],maxAudioBytes:64*1024,acceptedMimeTypes:['audio/wav'],optionalRuntimePackId:null},async transcribe(){recognitionCalls++;return {text:'Inspect my retained report',language:'en',confidence:1};}});
const app=express();
app.use(express.json());
app.use(session({secret:'isolated-license-direct-session',resave:false,saveUninitialized:false}));
app.use(passport.initialize());app.use(passport.session());configurePassport();
registerAuthRoutes(app);registerLicenseRoutes(app);registerVoiceRoutes(app);registerUniversalDataFabricRoutes(app);
const server=app.listen(0,'127.0.0.1');
let cookie='';
async function request(url:string,body?:unknown){
  const address=server.address();assert.ok(address && typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}`;
  const response=await fetch(`${base}${url}`,{method:body===undefined?'GET':'POST',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Cookie:cookie,Origin:base},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  return {status:response.status,body:await response.json()};
}
function recording(){
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  const form=new FormData();form.append('audio',new Blob([wav],{type:'audio/wav'}),'speech.wav');form.append('providerId','test.license-stt');return form;
}

test('expired managed access refuses direct speech inference and browser work but retains discovery and saved Project reads',async t=>{
  await initDb();
  t.after(async()=>{unregisterTranscriptionProvider('test.license-stt');server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await closeDb();fs.rmSync(root,{recursive:true,force:true});});
  const bootstrap=await request('/api/auth/bootstrap/complete',{email:'license-direct@example.invalid',name:'Direct execution owner',password:'Only-Synthetic-Direct!2026'});
  assert.equal(bootstrap.status,201);
  const [owner]=await getDb().select().from(users).where(eq(users.email,'license-direct@example.invalid'));
  assert.ok(owner);
  assert.equal((await request('/api/license/trial/start',{})).status,200);
  const active=await request('/api/voice/transcribe',recording());assert.equal(active.status,200);assert.equal(recognitionCalls,1);
  const project=await createProject({userId:owner.id,organizationId:null,role:'internal_admin'},{name:'Retained licensed Project'});
  const [installation]=await getDb().select().from(organizations).where(eq(organizations.slug,'lios-installation'));
  await getDb().update(organizationLicenses).set({trialEndsAt:new Date(Date.now()-86400000)}).where(eq(organizationLicenses.organizationId,installation!.id));
  assert.equal((await request('/api/license/access')).body.reason,'trial_expired');
  await t.test('transcription refuses before model work',async()=>{
    const denied=await request('/api/voice/transcribe',recording());assert.equal(denied.status,402);assert.equal(denied.body.code,'license_read_only');assert.equal(recognitionCalls,1);
  });
  await t.test('browser execution refuses before runtime preparation',async()=>{
    const denied=await request('/api/data-fabric/browser/execute',{policy:{projectId:project.id,allowedDomains:['example.invalid']},request:{urls:['https://example.invalid/'],extraction:{kind:'text'}}});
    assert.equal(denied.status,402);assert.equal(denied.body.code,'license_read_only');
  });
  const {getProject}=await import('./projectStore');assert.equal((await getProject({userId:owner.id,organizationId:null,role:'internal_admin'},project.id)).name,'Retained licensed Project');
  assert.equal((await request('/api/voice/providers')).status,200);
});
