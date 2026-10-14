import type { Express } from "express";
import { requireRole } from "./auth";
import { recordAuditEvent, auditActor } from "./auditEvents";
import { listAssumptions, setAssumption, deleteAssumption, isValidAssumptionName } from "./uideEngine/assumptionStore";
import { getWorkspace } from "./uideEngine/workspaceStore";
const AUTHOR=["internal_admin","internal_analyst"] as const; const READ=["internal_admin","internal_analyst","internal_compliance"] as const;
function ownedWorkspace(req:any,res:any){const workspace=getWorkspace(String(req.params.workspaceId),req.user!.id);if(!workspace){res.status(404).json({error:"Workspace not found."});return null;}return workspace;}
export function registerAssumptionRoutes(app:Express):void{
 app.get("/api/workspaces/:workspaceId/assumptions",requireRole(...READ),(req,res)=>{if(!ownedWorkspace(req,res))return;res.json(listAssumptions(String(req.params.workspaceId)));});
 app.post("/api/workspaces/:workspaceId/assumptions",requireRole(...AUTHOR),async(req,res)=>{if(!ownedWorkspace(req,res))return;const {name,value}=req.body as {name?:string;value?:number};if(!name||typeof name!=="string"||!isValidAssumptionName(name))return res.status(400).json({error:"name must be a valid identifier (letters, digits, underscore; can't start with a digit)."});if(typeof value!=="number"||!Number.isFinite(value))return res.status(400).json({error:"value must be a finite number."});const workspaceId=String(req.params.workspaceId);const list=setAssumption(workspaceId,name,value,req.user!.id);await recordAuditEvent(req.user!.id,"assumption_set",{workspaceId,name:name.trim().toUpperCase(),value,...auditActor(req.user!)});res.json(list);});
 app.delete("/api/workspaces/:workspaceId/assumptions/:name",requireRole(...AUTHOR),async(req,res)=>{if(!ownedWorkspace(req,res))return;const workspaceId=String(req.params.workspaceId),name=String(req.params.name);const list=deleteAssumption(workspaceId,name);await recordAuditEvent(req.user!.id,"assumption_deleted",{workspaceId,name:name.toUpperCase(),...auditActor(req.user!)});res.json(list);});
}
