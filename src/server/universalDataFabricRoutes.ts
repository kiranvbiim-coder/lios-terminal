import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./auth";
import { tenantContext } from "./tenantContext";
import {
  browserConnectorPolicySchema,
  canonicalDataCapabilitySchema,
  canonicalDataRequestSchema,
  providerQuotaSchema,
  semanticMetricDefinitionSchema,
} from "@shared/universalDataFabric";
import { createProviderRegistryForUser, describeProviderRegistry } from "./providerRuntimeRegistry";
import {
  providerHealthSnapshot,
  searchProviderSdk,
} from "./providerSdk";
import {
  executeCanonicalDataRequestCached,
  prefetchCanonicalDataRequests,
  providerExecutionCacheStats,
} from "./providerExecutionCache";
import { buildCoverageLedgerSnapshot } from "./coverageLedgerService";
import {
  listCoverageLedgerSnapshots,
  listDataLineageReceipts,
  recordCoverageLedgerSnapshot,
} from "./universalDataFabricStore";
import { DataLineageBuilder } from "./dataLineageService";
import { auditDatasetQuality } from "./dataQualityEngine";
import { defineSemanticMetric, searchSemanticMetricCatalog } from "./semanticFinanceService";
import { discoverProviderSchema, confirmedMappingInputSchema } from "@shared/dataMapping";
import { dataMappingStore } from "./dataMappingStore";
import { discoverOpenApiJson } from "./openApiConnector";
import { resolveCredential } from "./credentialVault";
import { chooseHighVolumeInterop } from "./highVolumeInterop";
import { getProject } from "./projectStore";
import {
  externalRightsAssessmentInputSchema,
  externalRightsSubjectKindSchema,
  listExternalRightsAssessments,
  recordExternalRightsAssessment,
} from "./externalRightsStore";
import { buildProviderDepthReport } from "./providerDepthAudit";
import { liosMcpServerExposureContract } from "./externalMcpClient";
import { buildStreamingLifecycle } from "./streamingCoordinator";
import { executeBrowserConnector } from "./browserConnectorRuntime";
import { createPlaywrightBrowserAdapter } from "./playwrightBrowserAdapter";
import { assertWorkflowPointInTimePolicy } from "./workflowDataPolicy";

function ctx(req: Request){ return tenantContext(req.user!); }
function fail(res: Response,error:unknown){
  if(error instanceof z.ZodError){res.status(400).json({error:"Invalid data-fabric request.",issues:error.issues});return;}
  res.status(422).json({error:error instanceof Error?error.message:"Data-fabric request failed."});
}

const searchSchema=z.object({query:z.string().trim().min(1).max(500),capability:canonicalDataCapabilitySchema.optional(),limit:z.number().int().min(1).max(100).optional()});
const qualitySchema=z.object({
  datasetRef:z.string().trim().min(1).max(500),
  rows:z.array(z.record(z.unknown())).max(100_000),
  requiredFields:z.array(z.string().trim().min(1).max(500)).max(2_000).optional(),
  expectedTypes:z.record(z.enum(["number","boolean","date","string"])).optional(),
  uniqueKeyFields:z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  effectiveAtField:z.string().trim().max(500).optional(),
  publishedAtField:z.string().trim().max(500).optional(),
  availableAtField:z.string().trim().max(500).optional(),
  retrievedAt:z.string().datetime({offset:true}).optional(),
  asKnownOn:z.string().datetime({offset:true}).optional(),
}).strict();

export function registerUniversalDataFabricRoutes(app: Express):void{
  app.use("/api/data-fabric",requireAuth);

  app.get("/api/data-fabric/providers",async(req,res)=>{
    try{const registry=await createProviderRegistryForUser(ctx(req),req.user!);res.json(describeProviderRegistry(registry));}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/providers/health",async(req,res)=>{
    try{const registry=await createProviderRegistryForUser(ctx(req),req.user!);res.json(await providerHealthSnapshot(ctx(req),registry));}catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/search",async(req,res)=>{
    try{
      const parsed=searchSchema.parse(req.body);
      const registry=await createProviderRegistryForUser(ctx(req),req.user!);
      res.json(await searchProviderSdk(parsed,ctx(req),registry));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/execute",async(req,res)=>{
    try{
      const request=canonicalDataRequestSchema.parse(req.body);
      if(request.projectId!==null&&request.projectId<=0) throw new Error("Invalid Project scope.");
      const tenant=ctx(req);
      if(request.projectId!==null) await getProject(tenant,request.projectId);
      const registry=await createProviderRegistryForUser(tenant,req.user!);
      const workflowKind=request.parameters.workflowKind;
      if(workflowKind==="research"||workflowKind==="backtest") assertWorkflowPointInTimePolicy(workflowKind,request.pointInTime);
      const result=await executeCanonicalDataRequestCached(request,tenant,registry);
      const response=result.response;
      let lineageId:null|string=null;
      if(response.observation){
        const builder=new DataLineageBuilder({
          projectId:request.projectId,
          requestId:request.requestId,
          capability:request.capability,
          entityRef:request.entity.ref,
          pointInTime:request.pointInTime,
        });
        builder.add({
          stage:"connector",
          componentId:response.observation.providerId,
          inputRefs:[`request:${request.requestId}`],
          outputRefs:response.observation.sourceRefs,
          contentHash:null,
          metadata:{cache:result.cache,attempts:response.attempts.length},
        });
        if(response.observation.normalized){
          builder.add({
            stage:"normalization",
            componentId:"lios.provider-sdk.normalize",
            inputRefs:response.observation.sourceRefs,
            outputRefs:[`normalized:${request.requestId}`],
            contentHash:null,
            metadata:{providerId:response.observation.providerId},
          });
        }
        const saved=await builder.persist(tenant);
        lineageId=saved?.id??null;
      }
      res.json({...response,cache:result.cache,lineageId});
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/prefetch",async(req,res)=>{
    try{
      const requests=z.array(canonicalDataRequestSchema).min(1).max(100).parse(req.body);
      const registry=await createProviderRegistryForUser(ctx(req),req.user!);
      res.json(await prefetchCanonicalDataRequests(requests,ctx(req),registry,4));
    }catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/cache",(_req,res)=>res.json(providerExecutionCacheStats()));

  app.post("/api/data-fabric/coverage/refresh",async(req,res)=>{
    try{const snapshot=await buildCoverageLedgerSnapshot();const saved=await recordCoverageLedgerSnapshot(ctx(req),snapshot);res.json({snapshot,saved});}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/coverage",async(req,res)=>{
    try{res.json(await listCoverageLedgerSnapshots(ctx(req),Math.min(Math.max(Number(req.query.limit)||20,1),100)));}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/metrics",async(req,res)=>{
    try{res.json(await searchSemanticMetricCatalog(ctx(req),String(req.query.q??""),Math.min(Math.max(Number(req.query.limit)||80,1),500)));}catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/metrics",async(req,res)=>{
    try{
      const body=semanticMetricDefinitionSchema.omit({version:true}).extend({version:z.number().int().positive().optional()}).parse(req.body);
      res.json(await defineSemanticMetric(ctx(req),body));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/quality",async(req,res)=>{
    try{res.json(auditDatasetQuality(qualitySchema.parse(req.body)));}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/lineage",async(req,res)=>{
    try{
      const tenant=ctx(req);
      const projectId=req.query.projectId?z.coerce.number().int().positive().parse(req.query.projectId):undefined;
      if(projectId) await getProject(tenant,projectId);
      res.json(await listDataLineageReceipts(tenant,projectId,Math.min(Math.max(Number(req.query.limit)||100,1),500)));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/mappings/suggest",async(req,res)=>{
    try{
      const body=z.object({
        providerId:z.string().trim().min(1).max(120),datasetKey:z.string().trim().min(1).max(240),
        contractFamily:z.string().trim().max(120).nullable().optional(),
        fields:z.array(z.object({providerField:z.string().trim().min(1).max(512),inferredType:z.enum(["string","number","integer","boolean","date","timestamp","currency_amount","percentage","ratio","array","object"]).optional()})).min(1).max(2_000),
      }).strict().parse(req.body);
      res.json(discoverProviderSchema(body));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/mappings/confirm",async(req,res)=>{
    try{
      const body=confirmedMappingInputSchema.omit({ownerUserId:true,organizationId:true}).parse(req.body);
      res.json(await dataMappingStore.confirm({...body,ownerUserId:req.user!.id,organizationId:req.user!.organizationId??null}));
    }catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/mappings",async(req,res)=>{
    try{res.json(await dataMappingStore.list({ownerUserId:req.user!.id,organizationId:req.user!.organizationId??null}));}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/rights",async(req,res)=>{
    try{
      const subjectKind=req.query.subjectKind?externalRightsSubjectKindSchema.parse(req.query.subjectKind):undefined;
      const subjectId=req.query.subjectId?z.string().trim().min(1).max(500).parse(req.query.subjectId):undefined;
      res.json(await listExternalRightsAssessments(ctx(req),{subjectKind,subjectId,limit:Math.min(Math.max(Number(req.query.limit)||100,1),500)}));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/rights",async(req,res)=>{
    try{res.json(await recordExternalRightsAssessment(ctx(req),externalRightsAssessmentInputSchema.parse(req.body)));}catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/openapi/discover",async(req,res)=>{
    try{
      const body=z.object({url:z.string().url(),credentialRef:z.string().trim().max(200).nullable().optional()}).strict().parse(req.body);
      const bearer=body.credentialRef?resolveCredential("",body.credentialRef):null;
      res.json(await discoverOpenApiJson(body.url,bearer));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/high-volume/plan",async(req,res)=>{
    try{res.json(chooseHighVolumeInterop(z.object({rowCount:z.number().int().nonnegative(),estimatedBytes:z.number().int().nonnegative(),repeatedCrossProcessTransfer:z.boolean().optional(),dataframeTransforms:z.boolean().optional()}).strict().parse(req.body)));}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/provider-depth",(_req,res)=>{
    try{res.json(buildProviderDepthReport());}catch(error){fail(res,error);}
  });

  app.get("/api/data-fabric/mcp/server-contract",(_req,res)=>{
    res.json(liosMcpServerExposureContract());
  });

  app.post("/api/data-fabric/streaming/plan",async(req,res)=>{
    try{
      const body=z.object({
        providerId:z.string().trim().min(1).max(120),
        capability:canonicalDataCapabilitySchema,
        supportsStream:z.boolean(),
        streamHealthy:z.boolean(),
        quota:providerQuotaSchema.nullable().optional(),
        suggestedPollMs:z.number().int().min(1000).max(86_400_000).nullable().optional(),
        lastEventAt:z.string().datetime({offset:true}).nullable().optional(),
        reason:z.string().trim().max(1000).nullable().optional(),
      }).strict().parse(req.body);
      res.json(buildStreamingLifecycle(body));
    }catch(error){fail(res,error);}
  });

  app.post("/api/data-fabric/browser/execute",async(req,res)=>{
    try{
      const body=z.object({
        policy:browserConnectorPolicySchema,
        request:z.object({
          urls:z.array(z.string().url().max(2_000)).min(1).max(10),
          extraction:z.object({kind:z.enum(["text","links","json"]),selector:z.string().trim().max(1_000).nullable().optional()}).strict(),
          download:z.object({url:z.string().url().max(2_000),filename:z.string().trim().min(1).max(240)}).strict().nullable().optional(),
        }).strict(),
      }).strict().parse(req.body);
      await getProject(ctx(req),body.policy.projectId);
      const adapter=await createPlaywrightBrowserAdapter();
      res.json(await executeBrowserConnector(body.policy,body.request,adapter));
    }catch(error){fail(res,error);}
  });
}
