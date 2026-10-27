import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("Home discovery is mounted only for non-temporary empty conversations", () => {
  const composer = source("../components/terminal/ProjectExperienceShell.tsx");
  assert.match(composer, /import \{ HomeAttentionPanel \} from "\.\/HomeAttentionPanel"/);
  assert.match(composer, /chatMode !== "temporary" && !displayMessages\.length && !streaming && <HomeAttentionPanel onAsk=\{stageRecordedIntelligenceToChat\} \/>/);
  assert.match(composer, /<ChatTerminalControl audience=\{audience\}/);
});

test("Home actions call existing Wave D Inbox and never authorize agent execution", () => {
  const home = source("../components/terminal/HomeAttentionPanel.tsx");
  assert.match(home, /apiRequest\("GET", "\/api\/wave-d\/pulse"\)/);
  assert.match(home, /apiRequest\("POST", `\/api\/wave-d\/action-inbox\/\$\{encodeURIComponent\(id\)\}`/);
  assert.match(home, /if \(disableWrite \|\| !entry\.inbox\) return;/);
  assert.match(home, /invalidateQueries\(\{ queryKey: \["\/api\/wave-d\/pulse"\] \}\)/);
  assert.doesNotMatch(home, /\/api\/wave-d\/pulse\/cards|grantPermission|onApprove\(/);
});

test("Home has no parallel source or preference database", () => {
  const home = source("../components/terminal/HomeAttentionPanel.tsx");
  assert.match(home, /safePulseSourceUrl\(source\.url\)/);
  assert.match(home, /homeAttentionReasons\(card\)/);
  assert.doesNotMatch(home, /localStorage|sessionStorage|indexedDB|fakeData|mockStories/);
});
