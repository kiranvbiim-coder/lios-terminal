import assert from "node:assert/strict";
import test from "node:test";
import { prepareArtifactChart, selectArtifactChartViewport } from "./artifactChartProjection";
import { buildArtifactEChartsOption } from "./artifactEChartsOption";
import type { ChartArtifactContent } from "./artifactChartProjection";

function chart(chartType:"line"|"area"|"bar"|"scatter", series:ChartArtifactContent["series"]): ChartArtifactContent {
  return {kind:"chart",rendererPreference:"echarts",chartType,series,
    options:{xAxis:{data:["FORGED"]},series:[{data:[12345]}]}};
}
function view(content:ChartArtifactContent){
  const p=prepareArtifactChart(content);
  assert.equal(p.status,"ready");
  if(p.status!=="ready")throw Error(p.message);
  return {p,v:selectArtifactChartViewport(p,{offset:0,limit:250})};
}

test("ECharts real adapter preserves finite numeric X, negative Y and exact null gaps",()=>{
  const original=chart("line",[
    {id:"a",label:"A",points:[{x:-2,y:-3},{x:2,y:7}]},
    {id:"b",label:"B",points:[{x:0,y:20},{x:2,y:0}]},
  ]);
  const before=structuredClone(original);
  const {p,v}=view(original);
  const out=buildArtifactEChartsOption(p,v,"line",[0,1]);
  assert.equal(out.xAxis.type,"value");
  assert.deepEqual(out.yAxis,{type:"value",min:-3,max:20,scale:true});
  assert.deepEqual(out.series[0].data,[[-2,-3],[0,null],[2,7]]);
  assert.deepEqual(out.series[1].data,[[-2,null],[0,20],[2,0]]);
  assert.equal(out.series[0].connectNulls,false);
  assert.equal(out.animation,false);
  assert.equal(JSON.stringify(out).includes("FORGED"),false,"raw options never gain executable/override authority");
  assert.deepEqual(original,before,"canonical stored content must remain unchanged");
});

test("ECharts categorical mode distinguishes text and numeric x; bars preserve missing observations",()=>{
  const {p,v}=view(chart("bar",[
    {id:"one",label:"First",points:[{x:1,y:-2},{x:"1",y:4}]},
    {id:"two",label:"Second",points:[{x:"1",y:8}]},
  ]));
  const out=buildArtifactEChartsOption(p,v,"bar",[1]);
  assert.equal(out.xAxis.type,"category");
  assert.deepEqual(out.xAxis.data,["1",'"1"']);
  assert.deepEqual(out.series.map(x=>x.type),["bar"]);
  assert.deepEqual(out.series[0].data,[null,8]);
  assert.deepEqual(out.yAxis,{type:"value",min:-2,max:8,scale:true});
  assert.equal(out.series[0].id,"series_1");
});

test("ECharts area and scatter use exactly the same Project chart observations",()=>{
  for(const chartType of ["area","scatter"] as const){
    const {p,v}=view(chart(chartType,[{id:"a",label:"A",points:[{x:"A",y:0},{x:"B",y:2}]}]));
    const result=buildArtifactEChartsOption(p,v,chartType,[0]);
    assert.equal(result.series[0].type,"scatter"===chartType?"scatter":"line");
    assert.deepEqual(result.series[0].data,chartType==="scatter"?[[0,0],[1,2]]:[0,2]);
    if(chartType==="area")assert.deepEqual(result.series[0].areaStyle,{opacity:0.16});
  }
});

test("ECharts supports unsaved chart-type preview while refusing invalid indices and bounding the source window",()=>{
 const {p,v}=view(chart("line",[{id:"x",label:"x",points:Array.from({length:300},(_,i)=>({x:i,y:i}))}]));
 assert.equal(v.rows.length,250);
 const out=buildArtifactEChartsOption(p,v,"line",[0]);
 assert.equal(out.series[0].data.length,250);
 const preview=buildArtifactEChartsOption(p,v,"bar",[0]);
 assert.equal(preview.series[0].type,"bar");
 assert.equal(preview.series[0].data.length,250);
 assert.equal(p.chartType,"line","unsaved preview must not mutate the canonical recorded chart type");
 assert.throws(()=>buildArtifactEChartsOption(p,v,"line",[0,0]),/exact visible/);
 assert.throws(()=>buildArtifactEChartsOption(p,v,"line",[1]),/exact visible/);
});
