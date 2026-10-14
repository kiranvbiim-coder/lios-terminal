import fs from "fs";
import path from "path";
import crypto from "crypto";
import { dataPath } from "../dataRoot";
export interface ModelVersion{id:string;modelId:string;cells:Record<string,string>;names:Record<string,string>;formats:Record<string,string>;savedAt:string;savedByUserId:number;}
const MAX_VERSIONS_PER_MODEL=20; function storeRoot(){return dataPath("model-versions");}
function ensureDir(){if(!fs.existsSync(storeRoot()))fs.mkdirSync(storeRoot(),{recursive:true});} function recordPath(modelId:string){return path.join(storeRoot(),`${modelId}.json`);} function writeFileAtomic(file:string,contents:string){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,contents,"utf8");fs.renameSync(tmp,file);}
export function listVersions(modelId:string,userId:number):ModelVersion[]{const f=recordPath(modelId);if(!fs.existsSync(f))return[];try{return(JSON.parse(fs.readFileSync(f,"utf8")) as ModelVersion[]).filter(v=>v.savedByUserId===userId).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));}catch{return[];}}
export function getVersion(modelId:string,versionId:string,userId:number):ModelVersion|null{return listVersions(modelId,userId).find(v=>v.id===versionId)??null;}
export function recordVersion(modelId:string,snapshot:{cells:Record<string,string>;names?:Record<string,string>;formats?:Record<string,string>},userId:number):ModelVersion{const version={id:crypto.randomUUID(),modelId,cells:snapshot.cells,names:snapshot.names??{},formats:snapshot.formats??{},savedAt:new Date().toISOString(),savedByUserId:userId};const existing=listVersions(modelId,userId);ensureDir();writeFileAtomic(recordPath(modelId),JSON.stringify([version,...existing].slice(0,MAX_VERSIONS_PER_MODEL),null,2));return version;}
export function deleteAllVersions(modelId:string,userId:number):void{const f=recordPath(modelId);if(!fs.existsSync(f))return;const remaining=(JSON.parse(fs.readFileSync(f,"utf8")) as ModelVersion[]).filter(v=>v.savedByUserId!==userId);if(remaining.length)writeFileAtomic(f,JSON.stringify(remaining,null,2));else fs.unlinkSync(f);}
