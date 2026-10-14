// Imported from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// Upstream path: src/process/pty-terminal-name.ts
// LiOS (GM-10b): unchanged.
const DEFAULT_PTY_TERMINAL_NAME = "xterm-256color";

export function resolvePtyTerminalName(value: string | undefined): string {
  const normalized = value?.trim();
  return !normalized || normalized.toLowerCase() === "dumb"
    ? DEFAULT_PTY_TERMINAL_NAME
    : normalized;
}

export function setPtyTerminalName(params: {
  env: NodeJS.ProcessEnv;
  name: string;
  platform: NodeJS.Platform;
}): void {
  if (params.platform === "win32") {
    for (const key of Object.keys(params.env)) {
      if (key !== "TERM" && key.toLowerCase() === "term") {
        delete params.env[key];
      }
    }
  }
  params.env.TERM = params.name;
}
