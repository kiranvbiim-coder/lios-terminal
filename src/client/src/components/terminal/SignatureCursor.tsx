import { useEffect, useRef, useState } from "react";

type CursorMode = "default" | "action" | "inspect";

const CURSOR_KEY = "limuria-signature-cursor-v1";

function modeForTarget(target: EventTarget | null): CursorMode {
  if (!(target instanceof Element)) return "default";
  if (target.closest("input,textarea,select,[contenteditable='true'],canvas,[data-chart-root]")) return "inspect";
  if (target.closest("button,a,[role='button'],[draggable='true'],[data-terminal-object]")) return "action";
  return "default";
}

export default function SignatureCursor() {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: -100, y: -100 });
  const rendered = useRef({ x: -100, y: -100 });
  const raf = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<CursorMode>("default");

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (!finePointer) return;
    const root = document.querySelector<HTMLElement>(".terminal-root");
    if (!root) return;
    let enabled = false;
    try { enabled = window.localStorage.getItem(CURSOR_KEY) === "true"; } catch {}
    root.dataset.signatureCursor = enabled ? "true" : "false";
    if (!enabled) return;

    const tick = () => {
      rendered.current.x += (pointer.current.x - rendered.current.x) * 0.36;
      rendered.current.y += (pointer.current.y - rendered.current.y) * 0.36;
      const el = cursorRef.current;
      if (el) el.style.transform = `translate3d(${rendered.current.x - el.offsetWidth / 2}px,${rendered.current.y - el.offsetHeight / 2}px,0)`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const inside = Boolean((event.target as Element | null)?.closest?.(".terminal-root"));
      setVisible(inside);
      setMode(modeForTarget(event.target));
    };
    const leave = () => setVisible(false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", leave);
    document.addEventListener("mouseleave", leave);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", leave);
      document.removeEventListener("mouseleave", leave);
      delete root.dataset.signatureCursor;
    };
  }, []);

  return (
    <div ref={cursorRef} className="limuria-cursor fixed pointer-events-none" hidden={!visible} data-visible={visible ? "true" : "false"} data-mode={mode} aria-hidden="true">
      <span className="limuria-cursor-ring" />
      <span className="limuria-cursor-core">L</span>
    </div>
  );
}

export function setSignatureCursorEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CURSOR_KEY, enabled ? "true" : "false"); } catch {}
  const root = document.querySelector<HTMLElement>(".terminal-root");
  if (root) root.dataset.signatureCursor = enabled ? "true" : "false";
}
