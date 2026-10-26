/*
 * Single CSS entry point for production and every rendered acceptance harness.
 * Keep feature-specific layers above terminal-shell.css; the canonical shell
 * is the final structural arbiter, and VisualCanvas is intentionally last.
 */
import "./index.css";
import "./immersive-terminal-innovation.css";
import "./terminal-visualization-v5.css";
import "./terminal-workstation-v7.css";
import "./terminal-workstation-v8.css";
import "./terminal-canvas-v10.css";
import "./terminal-analytics-v11.css";
import "./terminal-quant-trust-v8.css";
import "./terminal-ux-phase1.css";
import "./terminal-shell.css";
import "./lios-product-palettes.css";
import "./visual-intelligence-canvas.css";
// Palette-specific type overrides load last, but only affect conversation UX.
import "./lios-product-typography.css";
// User-selected Chat skin: semantic surfaces, accessibility and composition.
import "./lios-product-experience.css";
