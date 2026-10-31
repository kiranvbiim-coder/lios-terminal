import { useEffect, useState } from "react";
import { Eye, MousePointer2 } from "lucide-react";
import { setSignatureCursorEnabled } from "./SignatureCursor";
import { initializeLiosProductPalette } from "@/lib/liosProductPalette";

function readBoolean(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  try { return window.localStorage.getItem(key) === "true"; } catch { return fallback; }
}

export default function ThemeSwitcher() {
  const [colorblind, setColorblind] = useState<boolean>(() => readBoolean("limuria-colorblind"));
  const [signatureCursor, setSignatureCursor] = useState<boolean>(() => readBoolean("limuria-signature-cursor-v1"));

  useEffect(() => {
    initializeLiosProductPalette();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-colorblind", String(colorblind));
    try { window.localStorage.setItem("limuria-colorblind", String(colorblind)); } catch {}
  }, [colorblind]);

  const toggleCursor = () => {
    const next = !signatureCursor;
    setSignatureCursor(next);
    setSignatureCursorEnabled(next);
  };

  return (
    <div className="flex items-center gap-1 font-terminal text-[9px]" aria-label="LiOS visual accessibility controls">
      <button
        type="button"
        onClick={() => setColorblind((value) => !value)}
        title="Colorblind-safe mode swaps red/green directional signals for blue/vermillion"
        className={`flex items-center gap-1 border px-1.5 py-1 transition-colors ${colorblind ? "border-[hsl(207,90%,58%)]/60 bg-[hsl(207,90%,58%)]/10 text-[hsl(207,90%,65%)]" : "border-border text-muted-foreground hover:text-foreground"}`}
      >
        <Eye className="h-3 w-3" /> CB
      </button>
      <button
        type="button"
        onClick={toggleCursor}
        title="Toggle LiOS signature cursor; precise native cursors remain on inputs and charts"
        className={`flex items-center gap-1 border px-1.5 py-1 transition-colors ${signatureCursor ? "border-[hsl(38,100%,50%)/35%] bg-[hsl(38,100%,50%)/7%] text-[hsl(38,100%,58%)]" : "border-border text-muted-foreground hover:text-foreground"}`}
      >
        <MousePointer2 className="h-3 w-3" /> CURSOR
      </button>
    </div>
  );
}
