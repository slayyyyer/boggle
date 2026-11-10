// Tiny dependency-free static server for local preview.
// Run: node tools/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 4173);
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const target = path.resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(target, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Not found: ${pathname}\n`);
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(target).pipe(response);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Boggle Lab: http://${HOST}:${PORT}/`);
  console.log("Press Ctrl+C to stop.");
});
