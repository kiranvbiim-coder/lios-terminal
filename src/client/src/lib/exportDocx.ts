import { strToU8, zipSync, type Zippable } from "fflate";

import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { buildOfficeArtifactMetadataXml } from "@shared/officeArtifactRoundtrip";
import { buildNativeDocxDocument, DOCX_STYLES_XML, docxXmlEscape as xmlEscape } from "./nativeArtifactDocx";

export interface GeneratedDocx {
  filename: string;
  bytes: Uint8Array;
}


const DOCX_KINDS: Partial<Record<ArtifactContent["kind"], true>> = { research: true, report: true, decision: true, thesis: true };
// DOS ZIP timestamps use local calendar fields, not UTC.
const ZIP_MTIME = new Date(1980, 0, 1);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";


function filenameSafe(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "LiOS-Artifact";
}


const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;


function corePropsXml(plan: ArtifactExportPlan): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(plan.filenameStem)}</dc:title><dc:creator>LiOS</dc:creator><dc:subject>${xmlEscape(`${plan.kind} Artifact v${plan.version}`)}</dc:subject><dc:identifier>${xmlEscape(plan.artifactId)}</dc:identifier><cp:keywords>${xmlEscape(plan.contentHash)}</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">1980-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;
}

const APP_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>LiOS</Application><AppVersion>1.0</AppVersion></Properties>`;

export function buildArtifactDocx(plan: ArtifactExportPlan, content: ArtifactContent): GeneratedDocx {
  if (!DOCX_KINDS[content.kind]) throw new Error(`DOCX export is not supported for Artifact kind "${content.kind}".`);
  if (plan.kind !== content.kind) throw new Error(`Artifact export plan kind "${plan.kind}" does not match content kind "${content.kind}".`);
  if (!plan.formats.includes("docx" as ArtifactExportPlan["formats"][number])) throw new Error("DOCX is not enabled in this Artifact export plan.");
  const native = buildNativeDocxDocument(plan, content);

  const entries: Zippable = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES_XML.replace("</Types>", `${native.contentTypes}<Override PartName="/customXml/liosArtifact.xml" ContentType="application/xml"/></Types>`)),
    "_rels/.rels": strToU8(ROOT_RELS_XML),
    "docProps/core.xml": strToU8(corePropsXml(plan)),
    "docProps/app.xml": strToU8(APP_PROPS_XML),
    "word/document.xml": strToU8(native.documentXml),
    "word/styles.xml": strToU8(DOCX_STYLES_XML),
    "word/numbering.xml": strToU8(native.numberingXml),
    "word/_rels/document.xml.rels": strToU8(native.relationshipsXml),
    "customXml/liosArtifact.xml": strToU8(buildOfficeArtifactMetadataXml(plan, content, "docx", native.bindings)),
    ...native.media,
  };

  return {
    filename: `${filenameSafe(plan.filenameStem)}-v${plan.version}.docx`,
    bytes: zipSync(entries, { level: 6, mtime: ZIP_MTIME }),
  };
}

export function downloadDocxFile(file: GeneratedDocx): void {
  const blob = new Blob([file.bytes], { type: DOCX_MIME });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = file.filename;
  // Keep the actual native DOCX bytes available through browser download dispatch.
  try { anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(href), 1_500); }
}

export function exportArtifactDocx(plan: ArtifactExportPlan, content: ArtifactContent): void {
  downloadDocxFile(buildArtifactDocx(plan, content));
}
