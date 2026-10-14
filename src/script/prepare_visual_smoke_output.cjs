const fs = require("node:fs");
const path = require("node:path");

function prepareVisualSmokeOutput(environmentVariable, defaultDirectory) {
  const configuredDirectory = process.env[environmentVariable] || defaultDirectory;
  const outputDirectory = path.resolve(process.cwd(), configuredDirectory);

  let exists = false;
  try {
    fs.lstatSync(outputDirectory);
    exists = true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
      throw error;
    }
  }
  if (exists) {
    throw new Error(
      `Refusing to overwrite existing visual-smoke output at ${outputDirectory}. ` +
      `Set ${environmentVariable} to a new directory to preserve existing evidence.`,
    );
  }

  fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
  // Keep the final creation non-recursive: if another process wins the race
  // after lstatSync, EEXIST must fail instead of reusing its evidence folder.
  fs.mkdirSync(outputDirectory);
  return outputDirectory;
}

module.exports = { prepareVisualSmokeOutput };
