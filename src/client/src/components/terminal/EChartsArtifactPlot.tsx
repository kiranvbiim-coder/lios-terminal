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
  const option=useMemo(()=>buildArtifactEChartsOption(
    props.projection,props.viewport,props.chartType,props.visibleIndices,
  ),[props.projection,props.viewport,props.chartType,props.visibleIndices]);
  useEffect(()=>{
    const element=div.current;
    if(!element)return;
    const chart=init(element,undefined,{renderer:"svg"});
    const resize=()=>chart.resize();
    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    chart.setOption(option as unknown as EChartsCoreOption,{notMerge:true,lazyUpdate:false,silent:true});
    return ()=>{observer?.disconnect();chart.dispose();};
  },[option]);
  return <div ref={div} className="h-full w-full" aria-hidden="true" data-testid="artifact-chart-echarts-runtime"/>;
}
