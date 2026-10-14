import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  VISUAL_CONTEXT_EVENT,
  VISUAL_ENVIRONMENT_CHANGED_EVENT,
  getVisualEnvironment,
  inferVisualSemanticContext,
  loadVisualEnvironmentRuntimeState,
  resolveVisualEnvironment,
  type VisualContextDetail,
  type VisualIntensity,
} from "@/lib/visualEnvironment";
import type { TerminalUxPreferences } from "@/lib/terminalUxPreferences";
import { ambientMotionAllowed, isSoftwareRendered } from "@/lib/desktopRendering";

interface Props {
  surface: string;
  activeView: string;
  focusMode: boolean;
  presentationMode: boolean;
  preferences: TerminalUxPreferences;
}

const defaultContext = (activeView: string): VisualContextDetail => ({
  projectId: null,
  intensity: "immersive",
  semanticContext: inferVisualSemanticContext(activeView),
});

export default function VisualCanvas({
  surface,
  activeView,
  focusMode,
  presentationMode,
  preferences,
}: Props) {
  const [context, setContext] = useState<VisualContextDetail>(() => {
    const restored = loadVisualEnvironmentRuntimeState();
    return restored
      ? {
          projectId: restored.projectId,
          intensity: restored.intensity,
          semanticContext: restored.semanticContext,
        }
      : defaultContext(activeView);
  });
  const [, forceEnvironmentRefresh] = useState(0);

  useEffect(() => {
    const handleContext = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as VisualContextDetail : null;
      if (!detail) return;
      setContext({
        projectId: detail.projectId ? String(detail.projectId) : null,
        projectName: detail.projectName ?? null,
        intensity: detail.intensity,
        semanticContext: detail.semanticContext,
      });
    };
    const handleEnvironment = () => forceEnvironmentRefresh((value) => value + 1);
    window.addEventListener(VISUAL_CONTEXT_EVENT, handleContext);
    window.addEventListener(VISUAL_ENVIRONMENT_CHANGED_EVENT, handleEnvironment);
    return () => {
      window.removeEventListener(VISUAL_CONTEXT_EVENT, handleContext);
      window.removeEventListener(VISUAL_ENVIRONMENT_CHANGED_EVENT, handleEnvironment);
    };
  }, []);

  const semanticContext = surface === "projects"
    ? context.semanticContext
    : inferVisualSemanticContext(activeView);

  const environmentId = resolveVisualEnvironment({
    projectId: context.projectId,
    semanticContext,
  });
  const environment = getVisualEnvironment(environmentId);

  const intensity: VisualIntensity = useMemo(() => {
    if (focusMode || presentationMode || surface === "workbench") return "focus";
    if (surface === "projects") return context.intensity;
    return "contextual";
  }, [context.intensity, focusMode, presentationMode, surface]);

  const asset = preferences.lowResourceMode ? environment.lowResourceAssetPath : environment.assetPath;
  const likelyNextEnvironment = getVisualEnvironment(resolveVisualEnvironment({
    projectId: null,
    semanticContext: inferVisualSemanticContext(activeView),
  }));
  const likelyNextAsset = preferences.lowResourceMode
    ? likelyNextEnvironment.lowResourceAssetPath
    : likelyNextEnvironment.assetPath;

  useEffect(() => {
    if (!preferences.visualEnvironmentsEnabled || preferences.lowResourceMode || typeof Image === "undefined") return;
    const assets = [...new Set([asset, likelyNextAsset])].slice(0, 2);
    const preloads = assets.map((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image;
    });
    return () => {
      for (const image of preloads) image.src = "";
    };
  }, [asset, likelyNextAsset, preferences.lowResourceMode, preferences.visualEnvironmentsEnabled]);

  if (!preferences.visualEnvironmentsEnabled) {
    return <div className="lios-visual-canvas lios-visual-canvas--solid" aria-hidden="true" data-intensity="focus" />;
  }

  const motionEnabled = ambientMotionAllowed(preferences, isSoftwareRendered());

  return (
    <div
      className="lios-visual-canvas"
      aria-hidden="true"
      data-environment={environment.id}
      data-intensity={intensity}
      data-motion={motionEnabled ? "true" : "false"}
      style={{ "--lios-visual-environment-image": `url("${asset}")` } as CSSProperties}
    >
      <div className="lios-visual-canvas__image" />
      <div className="lios-visual-canvas__veil" />
      <div className="lios-visual-canvas__light" />
      <div className="lios-visual-canvas__grain" />
    </div>
  );
}
