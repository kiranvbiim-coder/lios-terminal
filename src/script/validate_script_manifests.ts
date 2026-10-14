import fs from "node:fs";
import path from "node:path";

/**
 * Node's test runner silently ignores an explicitly named test file that does not exist, so a test manifest can go
 * stale (a deleted test still listed) while the quality gate stays green. This fails instead: every explicit file path
 * in a package.json script must exist, and every glob must match at least one file.
 */

const FILE_EXTENSION = /\.(?:test\.)?(?:ts|tsx|cts|mts|cjs|mjs|js|json|sh|py|yml|yaml)$/;
const GLOB_CHARACTERS = /[*?[\]{}]/;
/** Build output and installed packages do not exist in a fresh checkout before the build step, so they are not manifest entries. */
const GENERATED_PREFIX = /^(?:\.\/)?(?:dist|build|out|coverage|node_modules)\//;

export interface ManifestProblem {
  script: string;
  path: string;
  kind: "missing_file" | "empty_glob";
}

function pathTokens(command: string): string[] {
  const tokens = command.split(/\s+/).map((token) => token.replace(/^["'`]+|["'`;,]+$/g, ""));
  // `python -m unittest discover -s <dir> -p <pattern>`: the pattern is relative to <dir>, not to the package root.
  return tokens.filter((token, index) => token && tokens[index - 1] !== "-p" && !token.startsWith("-") && !/[=$<>|&]/.test(token) && !token.includes("://"));
}

export function findManifestProblems(scripts: Record<string, string>, cwd: string): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  for (const [script, command] of Object.entries(scripts)) {
    for (const token of pathTokens(command)) {
      if (GENERATED_PREFIX.test(token)) continue;
      if (GLOB_CHARACTERS.test(token)) {
        if (FILE_EXTENSION.test(token) && fs.globSync(token, { cwd }).length === 0) problems.push({ script, path: token, kind: "empty_glob" });
      } else if (FILE_EXTENSION.test(token) && !path.isAbsolute(token) && !fs.existsSync(path.resolve(cwd, token))) {
        problems.push({ script, path: token, kind: "missing_file" });
      }
    }
  }
  return problems;
}

/** Single-line `run:` commands of a workflow, keyed by "<file>:<line>" so a problem points at the exact step. */
export function workflowCommands(workflowDirectory: string): Record<string, string> {
  const commands: Record<string, string> = {};
  if (!fs.existsSync(workflowDirectory)) return commands;
  for (const file of fs.readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name))) {
    fs.readFileSync(path.join(workflowDirectory, file), "utf8").split("\n").forEach((line, index) => {
      const match = /^\s*(?:-\s+)?run:\s+(\S.*)$/.exec(line);
      if (match && !/^[|>][-+]?$/.test(match[1] as string)) commands[`${file}:${index + 1}`] = match[1] as string;
    });
  }
  return commands;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const cwd = process.cwd();
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const problems = [
    ...findManifestProblems(manifest.scripts ?? {}, cwd),
    ...findManifestProblems(workflowCommands(path.resolve(cwd, "..", ".github", "workflows")), cwd),
  ];
  if (problems.length) {
    for (const problem of problems) console.error(`${problem.script.includes(".yml:") ? "workflow step" : "package.json script"} "${problem.script}": ${problem.kind === "empty_glob" ? "glob matches no files" : "file does not exist"}: ${problem.path}`);
    process.exitCode = 1;
  } else {
    console.log(`Script manifests are consistent (${Object.keys(manifest.scripts ?? {}).length} scripts checked).`);
  }
}
