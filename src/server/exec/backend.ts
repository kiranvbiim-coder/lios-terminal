// Imported from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// Upstream path: src/gateway/terminal/backend.ts
// LiOS (GM-10a): unchanged except import specifiers (extensionless, flattened into server/exec).
export type TerminalBackendExit = {
  exitCode?: number;
  signal?: number;
  error?: string;
};

export interface TerminalBackend {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exit: TerminalBackendExit) => void): void;
}
