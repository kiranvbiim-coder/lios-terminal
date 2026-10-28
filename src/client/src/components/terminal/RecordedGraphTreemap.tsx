import {useEffect,useMemo,useRef} from "react";
import { init, use, type EChartsCoreOption } from "echarts/core";
import {TreemapChart} from "echarts/charts";
import {SVGRenderer} from "echarts/renderers";
import type {CrossDomainNodeDomain} from "@/lib/terminalCrossDomainGraph";

use([TreemapChart,SVGRenderer]);

const TITLES: Record<CrossDomainNodeDomain,string> = {
  finance:"Finance",market:"Market",macro:"Macro",policy:"Policy",
  "supply-chain":"Supply chain",sustainability:"Sustainability",
  portfolio:"Portfolio",research:"Research",
};

/** Decorative ECharts treemap backed only by visible, recorded local objects.
 * The source count list outside this component remains the accessible owner.
 */
export default function RecordedGraphTreemap({counts}:{
  counts:readonly {domain:CrossDomainNodeDomain;count:number}[];
}) {
  const host=useRef<HTMLDivElement>(null);
  const option=useMemo(()=>({
    animation:false,backgroundColor:"transparent",tooltip:{show:false},
    series:[{
      type:"treemap",roam:false,draggable:false,nodeClick:false,
      breadcrumb:{show:false},leafDepth:1,
      top:2,bottom:2,left:2,right:2,
      label:{show:true,formatter:"{b}",fontSize:12,color:"#f5f5f4"},
      upperLabel:{show:false},
      itemStyle:{borderColor:"#151515",borderWidth:2,gapWidth:2},
      data:counts.map(({domain,count})=>({name:TITLES[domain],value:count})),
    }],
  }),[counts]);
  useEffect(()=>{
    const element=host.current;if(!element)return;
    const plot=init(element,undefined,{renderer:"svg"});
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(()=>plot.resize()):null;
    observer?.observe(element);
    plot.setOption(option as unknown as EChartsCoreOption,{notMerge:true,lazyUpdate:false,silent:true});
    return()=>{observer?.disconnect();plot.dispose();};
  },[option]);
  return <div ref={host} className="h-full w-full" aria-hidden="true"
    data-testid="recorded-graph-treemap-svg"/>;
}
