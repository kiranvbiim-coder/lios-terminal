import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { init, use, type EChartsCoreOption } from "echarts/core";
import { SankeyChart } from "echarts/charts";
import { SVGRenderer } from "echarts/renderers";
import type { RecordedEvidenceFlow } from "@/lib/recordedEvidenceFlow";

// Already installed ECharts 6; use the existing source-owned SVG renderer.
// No new chart package, network import, timers or additional data source.
use([SankeyChart, SVGRenderer]);

export default function RecordedEvidenceSankey({ projection }: { projection: RecordedEvidenceFlow }) {
  const container = useRef<HTMLDivElement>(null);
  const option = useMemo(() => ({
    animation: false,
    backgroundColor: "transparent",
    tooltip: { show: false },
    series: [{
      type: "sankey",
      left: 12, right: 16, top: 12, bottom: 16,
      nodeAlign: "justify",
      nodeWidth: 10,
      nodeGap: 10,
      layoutIterations: 24,
      draggable: false,
      emphasis: { disabled: true },
      label: { show: false },
      lineStyle: { color: "source", opacity: 0.35, curveness: 0.45 },
      data: projection.nodes,
      links: projection.links,
    }],
  }), [projection]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const plot = init(element, undefined, { renderer: "svg" });
    const resize = () => plot.resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    plot.setOption(option as unknown as EChartsCoreOption, { notMerge: true, lazyUpdate: false, silent: true });
    return () => { observer?.disconnect(); plot.dispose(); };
  }, [option]);

  return <div ref={container} className="h-full w-full" data-testid="recorded-evidence-sankey-svg"
    aria-hidden="true" />;
}
