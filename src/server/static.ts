import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // serveStatic only ever runs against the bundled dist/index.cjs (see the
  // NODE_ENV branch in server/index.ts -- dev uses Vite's middleware
  // instead), so the native CJS __dirname here is always that bundle's own
  // directory, and "public" is always a sibling of it. This file used to
  // compute its own __dirname via import.meta.url (needed since the source
  // is ESM), but esbuild's --format=cjs bundling replaces `import.meta` with
  // an empty object, so that lookup always threw and silently fell back to
  // process.cwd(). That happens to equal the project root under
  // `npm start`/`npm run app:start` (a shell inherits its cwd), but a real
  // double-click/`open` launch of the packaged Electron app gets cwd "/"
  // from LaunchServices, which turned this into "/public" and made the
  // packaged app fail to find its own built client. The native __dirname
  // (ambient-typed by @types/node) sidesteps the whole problem.
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // index.html must always be revalidated -- it references content-hashed
  // JS/CSS filenames (e.g. index-CKMsfGV7.js) that change on every rebuild
  // and get deleted (emptyOutDir). A browser that cached an old index.html
  // will request an asset that no longer exists on disk -> 404 on a
  // <script> tag -> nothing renders, no visible error, just a blank/stuck
  // page. The hashed asset files themselves are safe to cache forever since
  // any content change gets a new filename.
  const noCacheHtml = { setHeaders: (res: express.Response, filePath: string) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  } };

  app.use(express.static(distPath, noCacheHtml));

  // fall through to index.html if the file doesn't exist
  app.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
