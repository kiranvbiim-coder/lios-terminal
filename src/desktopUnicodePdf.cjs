"use strict";
/**
 * SI-04: bounded local-only Unicode PDF print payload and inert HTML.
 * Chromium/Electron handles Indic shaping through installed OS fonts.
 * Never load remote fonts, arbitrary HTML, scripts, files or URLs.
 * This is a publishing projection, NOT an Artifact/editor state store.
 */
const MAX_PARAGRAPHS = 4_000;
const MAX_CHARACTERS = 900_000;
const STYLES = new Set(["title","heading1","heading2","body","quote","code","bullet","ordered","meta"]);

function escapeHtml(value) {
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

function normalizeUnicodePdfPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid Unicode PDF request.");
  const { artifactId, version, contentHash, filename, paragraphs } = payload;
  if (typeof artifactId !== "string" || !artifactId.startsWith("artifact:") || artifactId.length > 200
    || !Number.isSafeInteger(version) || version < 1
    || typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error("Unicode PDF requires an exact saved Artifact revision.");
  }
  if (typeof filename !== "string" || filename.length > 200 || filename.length < 5
    || !/^[\p{L}\p{N}_. ()-]+\.pdf$/u.test(filename)
    || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Unsafe Unicode PDF filename.");
  }
  if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > MAX_PARAGRAPHS) {
    throw new Error("Unicode PDF paragraph count exceeds the local publishing budget.");
  }
  let characters = 0;
  const safeParagraphs = paragraphs.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.text !== "string" || !STYLES.has(entry.style)) {
      throw new Error("Invalid Unicode PDF paragraph.");
    }
    characters += entry.text.length;
    if (entry.text.length > 100_000 || characters > MAX_CHARACTERS) {
      throw new Error("Unicode PDF exceeds the local publishing text budget.");
    }
    if (entry.ordinal !== undefined && (!Number.isSafeInteger(entry.ordinal)
      || entry.ordinal < 1 || entry.ordinal > 100_000)) {
      throw new Error("Invalid Unicode PDF ordered-list ordinal.");
    }
    return { style: entry.style, text: entry.text, ...(entry.ordinal ? { ordinal: entry.ordinal } : {}) };
  });
  return { artifactId, version, contentHash, filename, paragraphs: safeParagraphs };
}

function buildUnicodeReportHtml(raw) {
  const payload = normalizeUnicodePdfPayload(raw);
  const tags = {
    title:"h1", heading1:"h2", heading2:"h3", body:"p",
    quote:"blockquote", code:"pre", bullet:"p", ordered:"p", meta:"p",
  };
  const blocks = payload.paragraphs.map(item => {
    const tag = tags[item.style];
    const prefix = item.style === "bullet" ? "• "
      : item.style === "ordered" ? String(item.ordinal ?? 1) + ". " : "";
    return "<" + tag + ' class="' + item.style + '">' + escapeHtml(prefix + item.text) + "</" + tag + ">";
  }).join("\n");
  return '<!doctype html><html lang="und"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; font-src &#39;none&#39;; img-src &#39;none&#39;; connect-src &#39;none&#39;; script-src &#39;none&#39;; base-uri &#39;none&#39;">'
    + "<style>"
    + '@page{size:A4;margin:17mm 18mm 17mm 18mm;}'
    + 'html{color:#182230;background:#fff;}'
    + 'body{font-family:"Noto Sans Tamil","Nirmala UI","Tamil Sangam MN","Latha","Noto Sans Devanagari","Noto Sans",Arial,sans-serif;font-size:10.5pt;line-height:1.52;overflow-wrap:anywhere;}'
    + 'h1,h2,h3{color:#172a44;line-height:1.28;break-after:avoid;page-break-after:avoid;}'
    + 'h1{font-size:21pt;margin:0 0 15pt;}h2{font-size:14pt;margin:16pt 0 6pt;}h3{font-size:11pt;margin:12pt 0 5pt;}'
    + 'p{margin:0 0 8pt;white-space:pre-wrap;}blockquote{border-left:3pt solid #8196ad;padding:5pt 9pt;margin:7pt 0 10pt;font-style:italic;white-space:pre-wrap;}'
    + 'pre{font-family:"Noto Sans Mono","JetBrains Mono",monospace;font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere;}'
    + '.bullet,.ordered{padding-left:13pt;text-indent:-13pt;}.meta{font-size:8pt;color:#53657a;}'
    + '</style></head><body>' + blocks + '</body></html>';
}

module.exports = { normalizeUnicodePdfPayload, buildUnicodeReportHtml };
