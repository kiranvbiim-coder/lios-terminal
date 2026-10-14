import { useEffect, useState } from "react";

function readHues(): { upHue: number; downHue: number } {
  if (typeof document === "undefined") return { upHue: 142, downHue: 0 };
  const style = getComputedStyle(document.documentElement);
  const upHue = parseFloat(style.getPropertyValue("--up").trim().split(" ")[0]);
  const downHue = parseFloat(style.getPropertyValue("--down").trim().split(" ")[0]);
  return {
    upHue: Number.isFinite(upHue) ? upHue : 142,
    downHue: Number.isFinite(downHue) ? downHue : 0,
  };
}

/**
 * Live up/down hue pair, tracking the colorblind-safe toggle (ThemeSwitcher.tsx
 * / index.css [data-colorblind]) and the active theme. For magnitude-driven
 * gradients (e.g. a heatmap tile whose saturation/lightness scales with
 * %change) the fixed --up/--down CSS variables aren't enough on their own --
 * this exposes just the hue so the gradient math can still vary s/l per cell
 * while staying colorblind-safe.
 */
export function useSemanticHues() {
  const [hues, setHues] = useState(readHues);

  useEffect(() => {
    const update = () => setHues(readHues());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-colorblind", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return hues;
}
