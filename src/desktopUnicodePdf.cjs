"use strict";
/**
 * SI-04 native Chromium print renderer: trusted P4 content only, no remote
 * resources, no JS. Preserves exact verified captured PNG/JPEG bytes, typed
 * tables and chart observations, while system fonts shape Unicode scripts.
 * Only a publishing projection: canonical data and rights remain in P4.
 */
const crypto = require("node:crypto");
const MAX_ITEMS = 4_000;
const MAX_PARAGRAPHS = 4_000;
const MAX_CHARACTERS = 900_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_CHARTS = 8;
const STYLES = new Set(["title","heading1","heading2","body","quote","code","bullet","ordered","meta"]);
const COLORS = ["#2352a0","#b43232","#147855","#87419b","#a5690f","#1e8c8c","#5f5f5f","#b43c82"];
const TAGS = { title:"h1", heading1:"h2", heading2:"h3", body:"p",
  quote:"blockquote", code:"pre", bullet:"p", ordered:"p", meta:"p" };

function escapeHtml(value) {
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function validText(value, name) {
  if (typeof value !== "string" || value.length > 100_000) throw new Error("Invalid Unicode PDF " + name + ".");
  return value;
}
function paragraph(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)
    || !STYLES.has(entry.style)) throw new Error("Invalid Unicode PDF paragraph.");
  const text = validText(entry.text,"paragraph");
  if (entry.ordinal !== undefined && (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 1 || entry.ordinal > 100_000)) {
    throw new Error("Invalid Unicode PDF ordered-list ordinal.");
  }
  return { style: entry.style, text, ...(entry.ordinal ? { ordinal: entry.ordinal } : {}) };
}
function capturedImage(entry) {
  if (!["image/png","image/jpeg"].includes(entry.mimeType)
    || typeof entry.dataBase64 !== "string" || entry.dataBase64.length > 1_400_000
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.dataBase64)
    || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 1 || entry.byteLength > 1024 * 1024
    || !Number.isSafeInteger(entry.width) || entry.width < 1 || entry.width > 4096
    || !Number.isSafeInteger(entry.height) || entry.height < 1 || entry.height > 4096
    || entry.width * entry.height > 16 * 1024 * 1024
    || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error("Invalid bounded Unicode PDF image.");
  }
  const data = Buffer.from(entry.dataBase64, "base64");
  if (data.length !== entry.byteLength || data.toString("base64") !== entry.dataBase64
    || crypto.createHash("sha256").update(data).digest("hex") !== entry.sha256) {
    throw new Error("Unicode PDF image checksum/byte integrity failed.");
  }
  if (entry.mimeType === "image/png") {
    if (data.length < 24 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || data.toString("ascii",12,16) !== "IHDR"
      || data.readUInt32BE(16) !== entry.width || data.readUInt32BE(20) !== entry.height) {
      throw new Error("Unicode PDF PNG image dimensions or signature mismatch.");
    }
  } else if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8
    || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
    throw new Error("Unicode PDF JPEG signature mismatch.");
  }
  return { kind:"image", caption:validText(entry.caption,"image caption"),
    sourceRef:validText(entry.sourceRef,"image source"), mimeType:entry.mimeType,
    dataBase64:entry.dataBase64, byteLength:entry.byteLength,
    width:entry.width,height:entry.height,sha256:entry.sha256 };
}
function typedTable(entry) {
  if (!Array.isArray(entry.columns) || !entry.columns.length || entry.columns.length > 32
    || !Array.isArray(entry.rows) || entry.rows.length > 10_000
    || entry.columns.length * (entry.rows.length+1) > 10_000) {
    throw new Error("Unicode PDF table exceeds the bounded native layout.");
  }
  const columns = entry.columns.map(x => validText(x,"column label"));
  const rows = entry.rows.map(row => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error("Unicode PDF table row shape mismatch.");
    return row.map(x => validText(x,"table cell"));
  });
  return { kind:"table",columns,rows };
}
function chart(entry) {
  if (!["line","area","bar","scatter"].includes(entry.chartType)
    || !["number","category"].includes(entry.xKind)
    || !Array.isArray(entry.windows) || entry.windows.length < 1 || entry.windows.length > 30
    || !(entry.yDomain === null || (Array.isArray(entry.yDomain) && entry.yDomain.length === 2
      && entry.yDomain.every(Number.isFinite) && entry.yDomain[1] >= entry.yDomain[0]))) {
    throw new Error("Invalid Unicode PDF governed chart.");
  }
  let points = 0;
  const windows = entry.windows.map(window => {
    if (!window || !Array.isArray(window.xValues) || window.xValues.length > 24 || !Array.isArray(window.series)
      || window.series.length > COLORS.length || !window.series.length) {
      throw new Error("Invalid Unicode PDF chart window.");
    }
    const xValues = window.xValues.map(x => {
      if ((typeof x !== "number" || !Number.isFinite(x)) && (typeof x !== "string" || x.length > 300)) {
        throw new Error("Invalid Unicode PDF chart x observation.");
      }
      return x;
    });
    if (entry.xKind === "number" && (xValues.some(x => typeof x !== "number")
      || (xValues.length > 1 && !Number.isFinite(xValues[xValues.length-1] - xValues[0])))) {
      throw new Error("Unicode PDF numeric chart contains invalid x scale.");
    }
    const series = window.series.map(one => {
      const label = validText(one.label,"chart series");
      if (!Array.isArray(one.points) || one.points.length > 200) throw new Error("Unicode PDF series window exceeds plot budget.");
      const seen = new Set();
      const data = one.points.map(pt => {
        if (!pt || !Number.isInteger(pt.xIndex) || pt.xIndex < 0 || pt.xIndex >= xValues.length
          || !Number.isFinite(pt.y) || seen.has(pt.xIndex)) throw new Error("Invalid or duplicate Unicode PDF chart observation.");
        seen.add(pt.xIndex);
        return { xIndex:pt.xIndex,y:pt.y };
      });
      points += data.length;
      return { label,points:data };
    });
    return {xValues,series};
  });
  if (points > 3_000) throw new Error("Unicode PDF chart observations exceed the bound.");
  return { kind:"chart",caption:validText(entry.caption,"chart caption"),
    sourceRef:entry.sourceRef === null ? null : validText(entry.sourceRef,"chart source"),
    chartType:entry.chartType,xKind:entry.xKind,yDomain:entry.yDomain,windows };
}

function normalizeUnicodePdfPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid Unicode PDF request.");
  const {artifactId,version,contentHash,filename,paragraphs,items} = payload;
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
  let characters = 0, images = 0, charts = 0, tableCells = 0;
  const addText = value => {
    characters += value.length;
    if (characters > MAX_CHARACTERS) throw new Error("Unicode PDF exceeds the local publishing text budget.");
  };
  const safeParagraphs = paragraphs.map(value => {
    const result = paragraph(value);
    addText(result.text);
    return result;
  });
  let safeItems;
  if (items === undefined) {
    safeItems = safeParagraphs.map(item => ({kind:"paragraph",...item}));
  } else {
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) throw new Error("Unicode PDF print item count exceeds the budget.");
    safeItems = items.map(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Unicode PDF print item.");
      if (value.kind === "paragraph") {
        const text = paragraph(value);
        addText(text.text);
        return {kind:"paragraph",...text};
      }
      if (value.kind === "image") {
        const out = capturedImage(value);
        images += out.byteLength;
        if (images > MAX_IMAGE_BYTES) throw new Error("Unicode PDF total captured image size exceeds budget.");
        addText(out.caption); addText(out.sourceRef);
        return out;
      }
      if (value.kind === "table") {
        const out = typedTable(value);
        tableCells += out.columns.length * (out.rows.length + 1);
        if (tableCells > 10_000) throw new Error("Unicode PDF total table size exceeds budget.");
        for (const cell of [...out.columns,...out.rows.flat()]) addText(cell);
        return out;
      }
      if (value.kind === "chart") {
        if (++charts > MAX_CHARTS) throw new Error("Unicode PDF chart count exceeds budget.");
        const out = chart(value);
        addText(out.caption); if (out.sourceRef) addText(out.sourceRef);
        for (const window of out.windows) {
          for (const series of window.series) addText(series.label);
          for (const x of window.xValues) if (typeof x === "string") addText(x);
        }
        return out;
      }
      throw new Error("Unsupported Unicode PDF print item.");
    });
  }
  return {artifactId,version,contentHash,filename,paragraphs:safeParagraphs,items:safeItems};
}

function printParagraph(item) {
  const tag = TAGS[item.style];
  const prefix = item.style === "bullet" ? "• "
    : item.style === "ordered" ? String(item.ordinal ?? 1) + ". " : "";
  return "<" + tag + ' class="' + item.style + '">' + escapeHtml(prefix + item.text) + "</" + tag + ">";
}
function printTable(item) {
  return '<table><thead><tr>' + item.columns.map(x => "<th>" + escapeHtml(x) + "</th>").join("")
    + "</tr></thead><tbody>" + item.rows.map(row =>
      "<tr>" + row.map(cell => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("")
    + "</tbody></table>";
}
function printImage(item) {
  const uri = "data:" + item.mimeType + ";base64," + item.dataBase64;
  return '<figure class="captured"><img width="' + item.width + '" height="' + item.height
    + '" src="' + uri + '" alt="' + escapeHtml(item.caption || "Recorded source image") + '">'
    + '<figcaption>' + escapeHtml(item.caption) + ' · Source: ' + escapeHtml(item.sourceRef)
    + " · SHA-256: " + item.sha256 + "</figcaption></figure>";
}

function printChartWindow(chartInfo, window, index) {
  const box = {left:65,right:640,top:30,bottom:205};
  const [yMin,yMax] = chartInfo.yDomain ?? [0,1];
  const yRange = yMax - yMin;
  const py = value => yRange === 0 ? (box.top+box.bottom)/2
    : box.bottom - ((value-yMin)/yRange)*(box.bottom-box.top);
  const xValues = window.xValues;
  const minX = Number(xValues[0] ?? 0), maxX=Number(xValues[xValues.length-1] ?? 1);
  const px = i => chartInfo.xKind === "number" && xValues.length > 1 && maxX !== minX
    ? box.left+((Number(xValues[i])-minX)/(maxX-minX))*(box.right-box.left)
    : box.left+((i+0.5)/Math.max(1,xValues.length))*(box.right-box.left);
  const n = value => {
    if (!Number.isFinite(value)) throw new Error("Unicode PDF chart coordinates cannot be represented.");
    return value.toFixed(2);
  };
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 315" role="img" aria-label="'
      + escapeHtml(chartInfo.caption || "Recorded chart") + '">',
    '<rect x="0" y="0" width="680" height="315" fill="white"/>',
    '<path d="M'+n(box.left)+' '+n(box.top)+'V'+n(box.bottom)+'H'+n(box.right)+'" fill="none" stroke="#94a3b8"/>',
    '<line x1="'+n(box.left)+'" x2="'+n(box.right)+'" y1="'+n(py(0))+'" y2="'+n(py(0))+'" stroke="#64748b" stroke-dasharray="4 3"/>',
    '<text x="8" y="'+n(box.top+5)+'" font-size="10">'+escapeHtml(String(yMax))+'</text>',
    '<text x="8" y="'+n(box.bottom)+'" font-size="10">'+escapeHtml(String(yMin))+'</text>',
  ];
  const first = xValues[0],last=xValues[xValues.length-1];
  if (first !== undefined) parts.push('<text x="'+n(box.left)+'" y="224" font-size="10">'+escapeHtml(String(first))+'</text>');
  if (last !== undefined && xValues.length > 1) parts.push('<text x="'+n(box.right)+'" y="224" font-size="10" text-anchor="end">'+escapeHtml(String(last))+'</text>');
  const gap = xValues.length < 2 ? 32 : Math.min(32,(box.right-box.left)/xValues.length*0.65);
  window.series.forEach((series,seriesIndex) => {
    const color=COLORS[seriesIndex];
    const ordered = [...series.points].sort((a,b)=>a.xIndex-b.xIndex);
    const lookup=new Map(ordered.map(pt=>[pt.xIndex,pt.y]));
    if (chartInfo.chartType === "bar") {
      const width=Math.max(1,gap/window.series.length);
      for(const point of ordered) {
        const x=px(point.xIndex)+(seriesIndex-(window.series.length-1)/2)*width-width/2;
        const low=Math.min(py(point.y),py(0)),height=Math.abs(py(point.y)-py(0));
        parts.push('<rect x="'+n(x)+'" y="'+n(low)+'" width="'+n(width)
          +'" height="'+n(Math.max(height,0.6))+'" fill="'+color+'"/>');
      }
    } else {
      let run=[];
      const flush=()=>{
        if(!run.length)return;
        if(chartInfo.chartType==="area" && run.length>1){
          const start=run[0],end=run[run.length-1];
          parts.push('<path d="M'+n(start[0])+' '+n(py(0))+' '
            +run.map(pt=>'L'+n(pt[0])+' '+n(pt[1])).join(" ")
            +' L'+n(end[0])+' '+n(py(0))+' Z" fill="'+color+'" opacity="0.12"/>');
        }
        if(chartInfo.chartType!=="scatter" && run.length>1){
          parts.push('<polyline points="'+run.map(pt=>n(pt[0])+','+n(pt[1])).join(' ')
            +'" fill="none" stroke="'+color+'" stroke-width="1.8"/>');
        }
        for(const p of run) parts.push('<circle cx="'+n(p[0])+'" cy="'+n(p[1])
          +'" r="2.6" fill="'+color+'"/>');
        run=[];
      };
      for(let i=0;i<xValues.length;i++){
        if(!lookup.has(i)){flush();continue;}
        run.push([px(i),py(lookup.get(i))]);
        if(chartInfo.chartType==="scatter")flush();
      }
      flush();
    }
    const col = seriesIndex % 2, row = Math.floor(seriesIndex/2);
    const lx = 65+col*290,ly=243+row*15;
    parts.push('<rect x="'+lx+'" y="'+(ly-9)+'" width="9" height="9" fill="'+color+'"/>');
    parts.push('<text x="'+(lx+14)+'" y="'+ly+'" font-size="10">'
      +escapeHtml(series.label.slice(0,80))+'</text>');
  });
  parts.push('</svg>');
  const suffix = chartInfo.windows.length>1
    ? " · Window " +(index+1)+" of "+chartInfo.windows.length : "";
  return '<figure class="governed-chart">'+parts.join("")
    +'<figcaption>'+escapeHtml(chartInfo.caption)+' · '+escapeHtml(chartInfo.chartType)
    +suffix+(chartInfo.sourceRef?' · Source: '+escapeHtml(chartInfo.sourceRef):'')
    +'</figcaption></figure>';
}

function buildUnicodeReportHtml(raw) {
  const data=normalizeUnicodePdfPayload(raw);
  const blocks=data.items.map(item => {
    if(item.kind==="paragraph")return printParagraph(item);
    if(item.kind==="table")return printTable(item);
    if(item.kind==="image")return printImage(item);
    if(item.kind==="chart")return item.windows.map((window,i)=>printChartWindow(item,window,i)).join("\n");
    throw new Error("Unsupported Unicode PDF print item.");
  }).join("\n");
  return '<!doctype html><html lang="und"><head><meta charset="utf-8">'
    +'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; font-src &#39;none&#39;; img-src data:; connect-src &#39;none&#39;; script-src &#39;none&#39;; base-uri &#39;none&#39;">'
    +"<style>"
    +'@page{size:A4;margin:17mm 18mm 17mm 18mm;}'
    +'html{color:#182230;background:#fff;}'
    +'body{font-family:"Noto Sans Tamil","Nirmala UI","Tamil Sangam MN","Latha","Noto Sans Devanagari","Noto Sans",Arial,sans-serif;font-size:10.5pt;line-height:1.52;overflow-wrap:anywhere;}'
    +'h1,h2,h3{color:#172a44;line-height:1.28;break-after:avoid;page-break-after:avoid;}'
    +'h1{font-size:21pt;margin:0 0 15pt;}h2{font-size:14pt;margin:16pt 0 6pt;}h3{font-size:11pt;margin:12pt 0 5pt;}'
    +'p{margin:0 0 8pt;white-space:pre-wrap;}blockquote{border-left:3pt solid #8196ad;padding:5pt 9pt;margin:7pt 0 10pt;font-style:italic;white-space:pre-wrap;}'
    +'pre{font-family:"Noto Sans Mono","JetBrains Mono",monospace;font-size:9pt;white-space:pre-wrap;overflow-wrap:anywhere;}'
    +'.bullet,.ordered{padding-left:13pt;text-indent:-13pt;}.meta{font-size:8pt;color:#53657a;}'
    +'table{width:100%;border-collapse:collapse;margin:12pt 0;font-size:8pt;break-inside:auto;}'
    +'thead{display:table-header-group;}tr{break-inside:avoid;}'
    +'th,td{padding:5pt 6pt;border:0.5pt solid #cbd5e1;text-align:left;overflow-wrap:anywhere;}'
    +'th{background:#e2e8f0;color:#172a44;}'
    +'figure{margin:12pt 0 16pt;break-inside:avoid;}'
    +'figure img{display:block;max-width:100%;max-height:220mm;height:auto;object-fit:contain;}'
    +'figure svg{display:block;width:100%;height:auto;}'
    +'figcaption{font-size:8pt;color:#475569;margin-top:5pt;overflow-wrap:anywhere;}'
    +'</style></head><body>'+blocks+'</body></html>';
}
module.exports={normalizeUnicodePdfPayload,buildUnicodeReportHtml};
