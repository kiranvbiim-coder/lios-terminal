/** UIDE Scenario Fixture Bank. Fixtures contain derived metadata from uploaded client files and are therefore owner-scoped. */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { WorkbookProfile } from "./profiler";
import type { ClassificationResult } from "./domainClassifier";
import { dataPath } from "../dataRoot";
export interface FixtureMeta{id:string;fileName:string;fileExt:string;sheetCount:number;totalRows:number;uploadedByUserId:number;uploadedAt:string;provenanceId?:string;sourceSha256?:string;sourceSizeBytes?:number;organizationId?:number|null;topDomain?:string;topDomainConfidence?:number;}
export interface FixtureRecord extends FixtureMeta{profile:WorkbookProfile;classification?:ClassificationResult;}
function sumRows(profile:WorkbookProfile){return profile.sheets.reduce((sum,sheet)=>sum+(sheet.tabular?.rowCount??sheet.layout?.rowCount??0),0);}
function isLegacyProfile(profile:any){return!!profile&&Array.isArray(profile.columns)&&!Array.isArray(profile.sheets);}
function upgradeLegacyProfile(legacy:any):WorkbookProfile{return{fileName:legacy.fileName,fileExt:legacy.fileExt,sheetNames:["Sheet1"],sheets:[{sheetName:"Sheet1",shape:"tabular",tabular:{rowCount:legacy.rowCount,columnCount:legacy.columnCount,columns:legacy.columns,duplicateOrBlankHeaderWarning:false},layout:null}],crossSheetReferences:[],parsedAt:legacy.parsedAt??new Date().toISOString()};}
function isLegacyMeta(entry:any){return typeof entry.sheetCount!=="number"||typeof entry.totalRows!=="number";}
function upgradeLegacyMeta(entry:any):FixtureMeta{const{rowCount,columnCount,...rest}=entry;return{...rest,sheetCount:1,totalRows:typeof rowCount==="number"?rowCount:0};}
function baseDir(){return dataPath("uide-fixtures");}
function manifestPath(){return path.join(baseDir(),"manifest.json");}function recordPath(id:string){return path.join(baseDir(),`${id}.json`);}function ensureDir(){if(!fs.existsSync(baseDir()))fs.mkdirSync(baseDir(),{recursive:true});}
function writeFileAtomic(file:string,contents:string){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,contents,"utf8");fs.renameSync(tmp,file);}
function readManifest():FixtureMeta[]{ensureDir();const file=manifestPath();if(!fs.existsSync(file))return[];let entries:any[];try{entries=JSON.parse(fs.readFileSync(file,"utf8"));}catch{return[];}const anyLegacy=entries.some(isLegacyMeta);const upgraded=entries.map(e=>isLegacyMeta(e)?upgradeLegacyMeta(e):e);if(anyLegacy)writeManifest(upgraded);return upgraded;}
function writeManifest(entries:FixtureMeta[]){ensureDir();writeFileAtomic(manifestPath(),JSON.stringify(entries,null,2));}
function owned(entry:FixtureMeta|FixtureRecord,userId:number){return entry.uploadedByUserId===userId;}
export function saveFixture(profile:WorkbookProfile,uploadedByUserId:number, provenance?:{provenanceId?:string;sourceSha256?:string;sourceSizeBytes?:number;organizationId?:number|null}):FixtureMeta{ensureDir();const id=crypto.randomUUID();const meta={id,fileName:profile.fileName,fileExt:profile.fileExt,sheetCount:profile.sheetNames.length,totalRows:sumRows(profile),uploadedByUserId,uploadedAt:new Date().toISOString(),...(provenance??{})};writeFileAtomic(recordPath(id),JSON.stringify({...meta,profile},null,2));const manifest=readManifest();manifest.unshift(meta);writeManifest(manifest);return meta;}
export function listFixtures(userId:number):FixtureMeta[]{return readManifest().filter(f=>owned(f,userId));}
export function getFixture(id:string,userId:number):FixtureRecord|null{const file=recordPath(id);if(!fs.existsSync(file))return null;let record:any;try{record=JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}if(!owned(record,userId))return null;const needsProfileUpgrade=isLegacyProfile(record.profile),needsMetaUpgrade=isLegacyMeta(record);if(needsProfileUpgrade||needsMetaUpgrade){const upgradedMeta=needsMetaUpgrade?upgradeLegacyMeta(record):record;const upgradedProfile=needsProfileUpgrade?upgradeLegacyProfile(record.profile):record.profile;record={...upgradedMeta,profile:upgradedProfile};writeFileAtomic(file,JSON.stringify(record,null,2));}return record;}
export function saveClassification(id:string,userId:number,classification:ClassificationResult):FixtureRecord|null{const record=getFixture(id,userId);if(!record)return null;const updated={...record,classification};writeFileAtomic(recordPath(id),JSON.stringify(updated,null,2));const top=classification.candidates[0];const manifest=readManifest();const idx=manifest.findIndex(m=>m.id===id&&owned(m,userId));if(idx!==-1&&top){manifest[idx]={...manifest[idx],topDomain:top.slug,topDomainConfidence:top.confidence};writeManifest(manifest);}return updated;}
