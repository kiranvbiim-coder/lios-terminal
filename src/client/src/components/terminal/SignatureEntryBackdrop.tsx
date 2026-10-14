import { useEffect, useMemo, useState } from "react";

const SIGNATURE_SCENES = [
  { id: "neutral", label: "LiOS Intelligence", path: "/visual-environments/neutral.svg" },
  { id: "global-intelligence", label: "Global Intelligence", path: "/visual-environments/global-intelligence.svg" },
  { id: "research-knowledge", label: "Research & Knowledge", path: "/visual-environments/research-knowledge.svg" },
  { id: "markets", label: "Markets", path: "/visual-environments/markets.svg" },
] as const;

const ROTATION_MS = 28_000;

export default function SignatureEntryBackdrop() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [motionAllowed, setMotionAllowed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionAllowed(!query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    if (!motionAllowed || typeof window === "undefined") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setActiveIndex((index) => (index + 1) % SIGNATURE_SCENES.length);
    }, ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [motionAllowed]);

  const nextScene = useMemo(
    () => SIGNATURE_SCENES[(activeIndex + 1) % SIGNATURE_SCENES.length],
    [activeIndex],
  );

  useEffect(() => {
    if (typeof Image === "undefined") return;
    const image = new Image();
    image.decoding = "async";
    image.src = nextScene.path;
  }, [nextScene.path]);

  return (
    <div
      className="lios-signature-entry-backdrop"
      aria-hidden="true"
      data-signature-entry="true"
      data-motion={motionAllowed ? "true" : "false"}
    >
      {SIGNATURE_SCENES.map((scene, index) => (
        <div
          key={scene.id}
          className="lios-signature-entry-backdrop__scene"
          data-active={index === activeIndex ? "true" : "false"}
          style={{ backgroundImage: `url("${scene.path}")` }}
        />
      ))}
      <div className="lios-signature-entry-backdrop__depth" />
      <div className="lios-signature-entry-backdrop__horizon" />
      <div className="lios-signature-entry-backdrop__veil" />
      <div className="lios-signature-entry-backdrop__grain" />
      <div className="lios-signature-entry-backdrop__scene-index">
        {SIGNATURE_SCENES.map((scene, index) => (
          <span key={scene.id} data-active={index === activeIndex ? "true" : "false"} title={scene.label} />
        ))}
      </div>
    </div>
  );
}
