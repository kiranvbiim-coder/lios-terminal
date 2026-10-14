import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUILD_HEAP_MB = 4096;
const BUILD_HEAP_ENV = "LIOS_BUILD_HEAP_CONFIGURED";

function ensureBuildHeap(): void {
  if (process.env[BUILD_HEAP_ENV] === "1") return;

  const result = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${BUILD_HEAP_MB}`,
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        [BUILD_HEAP_ENV]: "1",
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

ensureBuildHeap();

const [{ build: esbuild }, { build: viteBuild }, { rm, readFile }] =
  await Promise.all([
    import("esbuild"),
    import("vite"),
    import("node:fs/promises"),
  ]);

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
  "axios",
  "bcryptjs",
  "fast-xml-parser",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "fflate",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  console.log("building desktop restore worker...");
  await esbuild({
    entryPoints: ["script/desktop_restore.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/desktop-restore.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
