import { useEffect, useMemo, useRef } from "react";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type {
  ArtifactChartProjection, ArtifactChartType, ArtifactChartViewport,
} from "@/lib/artifactChartProjection";
import { buildArtifactEChartsOption } from "@/lib/artifactEChartsOption";

// Loaded only after a Chart Artifact explicitly selects rendererPreference=echarts.
use([BarChart, LineChart, ScatterChart, GridComponent, SVGRenderer]);

export default function EChartsArtifactPlot(props:{
  projection:ArtifactChartProjection;
  viewport:ArtifactChartViewport;
  chartType:ArtifactChartType;
  visibleIndices:readonly number[];
}) {
  const div=useRef<HTMLDivElement>(null);
  const chartRef=useRef<ReturnType<typeof init> | null>(null);
  const option=useMemo(()=>buildArtifactEChartsOption(
    props.projection,props.viewport,props.chartType,props.visibleIndices,
  ),[props.projection,props.viewport,props.chartType,props.visibleIndices]);
  // B08/B09: stable SVG renderer lifetime; switching chart family or viewport
  // updates recorded P4 option data without tearing down the DOM/chart instance.
  useEffect(()=>{
    const element=div.current;
    if(!element)return;
    const chart=init(element,undefined,{renderer:"svg"});
    chartRef.current=chart;
    const resize=()=>chart.resize();
    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    return ()=>{observer?.disconnect();chartRef.current=null;chart.dispose();};
  },[]);
  useEffect(()=>{
    chartRef.current?.setOption(option as unknown as EChartsCoreOption,{notMerge:true,lazyUpdate:false,silent:true});
  },[option]);
  return <div ref={div} className="h-full w-full" aria-hidden="true" data-testid="artifact-chart-echarts-runtime"/>;
}
