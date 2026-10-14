import path from "node:path";
import { clearDataRootPointer, moveDataRoot, resolveDataRoot } from "../dataRootCore.cjs";

const USAGE = `Usage:
  npm run data-root                      show where this install keeps its data
  npm run data-root -- move <new-dir>    copy everything to an EMPTY folder, verify every file, then use it from now on
  npm run data-root -- reset             go back to the default folder (does not move any data)

Quit LiOS before moving. The old folder is left in place until you delete it. LIOS_DATA_ROOT, when set, overrides this.`;

const [command, target] = process.argv.slice(2);
try {
  const current = resolveDataRoot();
  if (!command) {
    console.log(`${current.root}\n(chosen by: ${current.source})`);
  } else if (command === "move" && target) {
    const result = moveDataRoot({ from: current.root, to: path.resolve(target) });
    console.log(`Moved ${result.files} files (${result.bytes} bytes) to ${result.to}. Every file was verified. The old folder ${result.from} was kept.`);
  } else if (command === "reset") {
    clearDataRootPointer();
    console.log("This install will use its default data folder again.");
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
