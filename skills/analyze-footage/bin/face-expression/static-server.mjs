import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

export function resolveStaticFile(root, requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname === "/" ? "/render.html" : url.pathname);
  const candidate = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return candidate;
}

export function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";
}

function handler(root, request, response) {
  let filePath;
  try {
    filePath = resolveStaticFile(root, request.url);
  } catch {
    response.writeHead(400).end("bad request\n");
    return;
  }
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end("not found\n");
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("method not allowed\n");
    return;
  }
  const size = statSync(filePath).size;
  response.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

/**
 * Emscripten の WASM loader は fetch() を使うため、file:// ではなく loopback の同一 origin で
 * render page と vendor assets を配信する。port 0 の実値は実行環境だけの transport detail で、
 * track/sample の入力には使わないため出力の決定論へ影響しない。
 */
export async function startStaticServer({ root }) {
  const absoluteRoot = path.resolve(root);
  const server = http.createServer((request, response) => handler(absoluteRoot, request, response));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("loopback static server の port を取得できません");
  }
  let closed = false;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeIdleConnections?.();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
