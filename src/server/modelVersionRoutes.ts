import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listVersions, getVersion, recordVersion } from "./uideEngine/modelVersionStore";
import { getModel, updateModel } from "./uideEngine/modelStore";
const AUTHOR=["internal_admin","internal_analyst"] as const; const READ=["internal_admin","internal_analyst","internal_compliance"] as const;
export function registerModelVersionRoutes(app:Express):void{
 app.get("/api/models/:modelId/versions",requireRole(...READ),(req,res)=>{const modelId=String(req.params.modelId);const model=getModel(modelId,req.user!.id);if(!model)return res.status(404).json({error:"Model not found."});res.json(listVersions(modelId,req.user!.id));});
 app.post("/api/models/:modelId/versions/:versionId/restore",requireRole(...AUTHOR),async(req,res)=>{const modelId=String(req.params.modelId),versionId=String(req.params.versionId);const model=getModel(modelId,req.user!.id);if(!model)return res.status(404).json({error:"Model not found."});const version=getVersion(modelId,versionId,req.user!.id);if(!version)return res.status(404).json({error:"Version not found."});recordVersion(modelId,{cells:model.cells,names:model.names,formats:model.formats},req.user!.id);const restored=updateModel(modelId,req.user!.id,{cells:version.cells,names:version.names,formats:version.formats});if(!restored)return res.status(404).json({error:"Model not found."});await recordAuditEvent(req.user!.id,"model_version_restored",{modelId,versionId,savedAt:version.savedAt,...auditActor(req.user!)});res.json(restored);});
}
