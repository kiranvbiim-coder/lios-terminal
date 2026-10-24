import { strToU8, zipSync } from "fflate";
import type { ExportSheet } from "./exportXlsx";
import type { ArtifactContent, ArtifactExportPlan } from "@shared/artifactContracts";
import { buildNativeArtifactPptx } from "./nativeArtifactPptx";

export interface GeneratedPptx { filename: string; bytes: Uint8Array; slideCount: number }
type PptxSlide = { title: string; lines: string[] };
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const blob = new Blob([bytes], { type });
  const href = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.click();
  } finally {
    // The browser can consume its Blob URL asynchronously after click().
    setTimeout(() => URL.revokeObjectURL(href), 1_500);
  }
}

function slideXml(title: string, lines: string[]): string {
  const body = lines.map((line) =>
    '<a:p><a:pPr><a:lnSpc><a:spcPts val="2000"/></a:lnSpc><a:spcAft><a:spcPts val="200"/></a:spcAft></a:pPr><a:r><a:rPr lang="en-US" sz="1600"/><a:t xml:space="preserve">' + xml(line) + '</a:t></a:r><a:endParaRPr lang="en-US" sz="1600"/></a:p>',
  ).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="10820400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800" b="1"/><a:t>' + xml(title) + '</a:t></a:r><a:endParaRPr lang="en-US" sz="2800"/></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="10820400" cy="4572000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' + body + '</p:txBody></p:sp>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function sheetLines(sheet: ExportSheet): string[] {
  return sheet.rows.map((row) => row.map((cell) => {
    if (typeof cell === "object" && cell !== null && "value" in cell) return String((cell as { value: unknown }).value ?? "");
    return String(cell ?? "");
  }).join("  |  "));
}

export function buildPptxBytes(title: string, sheets: ExportSheet[], metadata: { model: string; modelHash: string; provenance: string[] }): Uint8Array {
  const slides: Array<{ title: string; lines: string[] }> = [];
  slides.push({
    title,
    lines: [
      "LiOS deterministic export",
      "Model: " + metadata.model,
      "Model hash: " + metadata.modelHash,
      "Sources: " + (metadata.provenance.length ? metadata.provenance.join(", ") : "none recorded"),
    ],
  });
  for (const sheet of sheets) {
    const lines = sheetLines(sheet);
    for (let index = 0; index < Math.max(1, lines.length); index += 20) {
      slides.push({ title: sheet.name + (lines.length > 20 ? " · " + (Math.floor(index / 20) + 1) : ""), lines: lines.slice(index, index + 20) });
    }
  }

  return buildPptxPackage(title, slides);
}

function buildPptxPackage(title: string, slides: PptxSlide[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, body: string) => { files[path] = strToU8(body); };
  const overrides = slides.map((_, index) => '<Override PartName="/ppt/slides/slide' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join("");
  add("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' + overrides + '</Types>');
  add("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  add("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xml(title) + '</dc:title><dc:creator>LiOS Intelligence Terminal</dc:creator></cp:coreProperties>');
  add("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>LiOS Intelligence Terminal</Application><Slides>' + slides.length + '</Slides></Properties>');
  const slideIds = slides.map((_, index) => '<p:sldId id="' + (256 + index) + '" r:id="rId' + (index + 2) + '"/>').join("");
  add("ppt/presentation.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slideIds + '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
  const presRels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
    .concat(slides.map((_, index) => '<Relationship Id="rId' + (index + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (index + 1) + '.xml"/>')).join("");
  add("ppt/_rels/presentation.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + presRels + '</Relationships>');
  add("ppt/slideMasters/slideMaster1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>');
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
  add("ppt/slideLayouts/slideLayout1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>');
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const lineStyles = [9525, 25400, 38100].map((width) => `<a:ln w="${width}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`).join("");
  const effects = '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3);
  add("ppt/theme/theme1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LiOS"><a:themeElements><a:clrScheme name="LiOS"><a:dk1><a:srgbClr val="0B0D10"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="F4F4F4"/></a:lt2><a:accent1><a:srgbClr val="FF6A00"/></a:accent1><a:accent2><a:srgbClr val="707070"/></a:accent2><a:accent3><a:srgbClr val="A0A0A0"/></a:accent3><a:accent4><a:srgbClr val="D0D0D0"/></a:accent4><a:accent5><a:srgbClr val="404040"/></a:accent5><a:accent6><a:srgbClr val="202020"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="LiOS"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="LiOS"><a:fillStyleLst>' + fills + '</a:fillStyleLst><a:lnStyleLst>' + lineStyles + '</a:lnStyleLst><a:effectStyleLst>' + effects + '</a:effectStyleLst><a:bgFillStyleLst>' + fills + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>');
  slides.forEach((slide, index) => {
    add("ppt/slides/slide" + (index + 1) + ".xml", slideXml(slide.title, slide.lines));
    add("ppt/slides/_rels/slide" + (index + 1) + ".xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
  });
  return zipSync(files, { level: 6, mtime: ZIP_MTIME });
}

/** P4 owns content/version/provenance; PptxGenJS supplies native Office serialization only. */
export const buildArtifactPptx = buildNativeArtifactPptx;

export async function exportArtifactPptx(plan: ArtifactExportPlan, content: ArtifactContent, beforeDownload?: () => void): Promise<void> {
  const file = await buildArtifactPptx(plan, content);
  beforeDownload?.();
  downloadBytes(file.filename, file.bytes, PPTX_MIME);
}

export function exportPptxReport(filename: string, title: string, sheets: ExportSheet[], metadata: { model: string; modelHash: string; provenance: string[] }): void {
  downloadBytes(filename, buildPptxBytes(title, sheets, metadata), PPTX_MIME);
}
