import crypto from "crypto";

export interface SourceIdentity { sha256:string; sizeBytes:number; fileName:string; mimeType:string|null; }
export interface ProvenanceRecord {
  id:string; source:SourceIdentity; organizationId:number|null; uploadedByUserId:number; datasetId:string; importedAt:string; parentVersionId:string|null;
  transformation:{ type:"source"|"normalized"|"derived"; operation:string; version:string; };
}
export function sha256Bytes(input:Buffer|Uint8Array):string{return crypto.createHash("sha256").update(input).digest("hex");}
export function sourceIdentity(input:Buffer|Uint8Array,fileName:string,mimeType?:string|null):SourceIdentity{return{sha256:sha256Bytes(input),sizeBytes:input.byteLength,fileName:fileName.replace(/[\\/\u0000-\u001f\u007f]/g,"_").slice(0,255),mimeType:mimeType??null};}
export function createProvenanceRecord(input:{source:SourceIdentity;organizationId:number|null;uploadedByUserId:number;datasetId:string;parentVersionId?:string|null;operation?:string;transformationVersion?:string;transformationType?:ProvenanceRecord["transformation"]["type"];}):ProvenanceRecord{
  if(input.organizationId!==null&&(!Number.isInteger(input.organizationId)||input.organizationId<=0))throw new Error("INVALID_ORGANIZATION_ID");
  if(!Number.isInteger(input.uploadedByUserId)||input.uploadedByUserId<=0)throw new Error("INVALID_USER_ID");
  if(!input.datasetId.trim())throw new Error("INVALID_DATASET_ID");
  return{id:crypto.randomUUID(),source:input.source,organizationId:input.organizationId,uploadedByUserId:input.uploadedByUserId,datasetId:input.datasetId,importedAt:new Date().toISOString(),parentVersionId:input.parentVersionId??null,transformation:{type:input.transformationType??"source",operation:input.operation??"source-import",version:input.transformationVersion??"1"}};
}
