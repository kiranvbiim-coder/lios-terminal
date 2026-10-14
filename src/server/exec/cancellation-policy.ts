// Adapted from OpenClaw src/process/supervisor/cancellation-policy.ts (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// LiOS (GM-10a) modifications: none besides this header.
// Every adapter must preserve the same graceful-cancel window before escalation.
export const GRACEFUL_CANCEL_TIMEOUT_MS = 5_000;
