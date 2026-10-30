import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lios-license-cancel-'));
process.env.LIMURIA_DATA_DIR=root;process.env.LIOS_LICENSE_CACHE_DIR=path.join(root,'license');process.env.LIOS_DESKTOP_PACKAGED='true';delete process.env.DATABASE_URL;
const {default:express}=await import('express');
const {eq}=await import('drizzle-orm');
const {initDb,getDb,closeDb}=await import('./db');
const {users,organizationLicenses,calculationJobs,quantExperiments,quantRuns}=await import('@shared/schema');
const {guardExecutionRoutes,ensureInstallationTrialRecord}=await import('./accessMode');
const {registerCalculationJobRoutes}=await import('./calculationJobRoutes');
const {registerQuantLabRoutes}=await import('./quantLabRoutes');
const {initializeCalculationJobService,shutdownCalculationJobServiceForTests}=await import('./calculationJobService');
const {initializeQuantLabRuntime}=await import('./quantLabRuntime');

test('license expiry permits owned calculation and Quant Lab cancellation without reopening execution or another owner job',async t=>{
  await initDb();const db=getDb();
  const [owner,other]=await db.insert(users).values([1,2].map(i=>({email:`cancel-${i}@example.invalid`,name:`Owner ${i}`,passwordHash:'unused-test-hash',role:'internal_admin' as const}))).returning();assert.ok(owner && other);
  const {organizationId}=await ensureInstallationTrialRecord();
  await db.update(organizationLicenses).set({billingState:'trial',trialEndsAt:new Date(Date.now()-86400000)}).where(eq(organizationLicenses.organizationId,organizationId));
  await initializeCalculationJobService();
  await initializeQuantLabRuntime();
  const jobId=crypto.randomUUID(),foreignId=crypto.randomUUID(),experimentId=crypto.randomUUID(),runId=crypto.randomUUID();
  await db.insert(calculationJobs).values([{id:jobId,kind:'license-cancel-fixture',input:{},status:'queued',ownerUserId:owner.id},{id:foreignId,kind:'license-cancel-fixture',input:{},status:'queued',ownerUserId:other.id}]);
  await db.insert(quantExperiments).values({id:experimentId,name:'Owned pending analysis',workspace:'statistics',modelId:'python.stats.normality',modelVersion:'1',ownerUserId:owner.id});
  await db.insert(quantRuns).values({id:runId,experimentId,sequence:1,status:'queued',modelId:'python.stats.normality',modelVersion:'1',engine:'python_sidecar',engineEndpoint:'/stats/normality',parameters:{},timeoutMs:30000,inputHash:'fixture',cacheKey:'fixture',environment:{},environmentHash:'fixture',libraryVersions:{},ownerUserId:owner.id});
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:owner.id,email:owner.email,name:owner.name,role:'internal_admin',organizationId:null,mustChangePassword:false};req.isAuthenticated=(()=>true) as typeof req.isAuthenticated;next();});
  guardExecutionRoutes(app,['/api/calculation-jobs','/api/quant-lab'],'analysis');registerCalculationJobRoutes(app);registerQuantLabRoutes(app);
  const server=app.listen(0,'127.0.0.1');
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await shutdownCalculationJobServiceForTests();await closeDb();fs.rmSync(root,{recursive:true,force:true});});
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const post=async(route:string)=>{const res=await fetch(`http://127.0.0.1:${address.port}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return {status:res.status,body:await res.json()};};
  const cancelled=await post(`/api/calculation-jobs/${jobId}/cancel?review=expired`);assert.equal(cancelled.status,200);assert.equal(cancelled.body.status,'cancelled');
  const quant=await post(`/api/quant-lab/runs/${runId}/cancel`);assert.equal(quant.status,200);assert.equal(quant.body.status,'cancelled');
  assert.equal((await post(`/api/calculation-jobs/${foreignId}/cancel`)).status,404);
  for(const route of ['/api/calculation-jobs',`/api/quant-lab/runs/${runId}/rerun`,'/api/calculation-jobs/cancel/extra','/api/quant-lab/experiments/cancel']){
    const denied=await post(route);assert.equal(denied.status,402,route);assert.equal(denied.body.code,'license_read_only');
  }
  const [foreign]=await db.select().from(calculationJobs).where(eq(calculationJobs.id,foreignId));assert.equal(foreign?.status,'queued');
});
