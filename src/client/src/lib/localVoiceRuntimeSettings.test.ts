import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Master AI and local voice runtime controls are mounted in reachable Connection Center settings", () => {
  const connectionCenter = read("../pages/DataConnectionCenter.tsx");
  const voiceSettings = read("../components/settings/LocalVoiceRuntimeSettings.tsx");
  const masterAiSettings = read("../components/settings/MasterAiSettings.tsx");

  assert.match(connectionCenter, /<LocalVoiceRuntimeSettings\s*\/>/);
  assert.match(connectionCenter, /<MasterAiSettings[\s\S]*providerAvailable=\{selectedAiProvider\?\.available === true\}/);
  assert.match(connectionCenter, /data-testid="connection-runtime-ai-settings"/);
  assert.match(voiceSettings, /queryKey:\s*\["\/api\/voice\/setup"\]/);
  assert.match(voiceSettings, /configureVoiceRuntimeFile\(kind\)/);
  assert.match(voiceSettings, /POST",\s*"\/api\/voice\/setup\/refresh"/);
  assert.match(voiceSettings, /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/voice\/providers"\]/);
  assert.match(voiceSettings, /LIOS_WHISPER_CPP_BIN, LIOS_WHISPER_MODEL and LIOS_FFMPEG_BIN/);
  assert.match(connectionCenter, /Runtime & Python packs/);
  assert.match(connectionCenter, /data-testid="connect-ai"[\s\S]*<MasterAiSettings[\s\S]*data-testid="connect-voice"[\s\S]*<LocalVoiceRuntimeSettings\s*\/>/);
  assert.ok(
    connectionCenter.indexOf('data-testid="connect-voice"') < connectionCenter.indexOf('data-testid="connection-runtime-ai-settings"'),
    "Voice controls must stay reachable on the main screen, not behind the runtime accordion",
  );
  assert.match(masterAiSettings, /role="switch"/);
  assert.match(masterAiSettings, /aria-checked=\{enabled \?\? false\}/);
  assert.match(masterAiSettings, /api\/wave-c\/ai\/state/);
  assert.match(masterAiSettings, /only context permitted for the active project/);
  assert.match(masterAiSettings, /Deterministic finance tools remain available while AI is off/);
});
