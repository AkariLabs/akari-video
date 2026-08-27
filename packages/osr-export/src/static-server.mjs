import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".mp4", "video/mp4"],
  [".mov", "video/quicktime"], [".webm", "video/webm"], [".wav", "audio/wav"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);

export async function startStaticServer({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath = null }) {
  const server = createServer(createStaticRequestHandler({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath }));
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise())),
  };
}

export function createStaticRequestHandler({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath = null }) {
  const root = resolve(projectRoot);
  return async (request, response) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/page.html") {
        return sendText(response, pageHtml, "text/html; charset=utf-8");
      }
      if (url.pathname === "/overlay-sheet.html") {
        return sendText(response, overlaySheetHtml, "text/html; charset=utf-8");
      }
      if (url.pathname === "/caption-font.ttf" && captionFontPath) {
        const info = await stat(captionFontPath);
        if (!info.isFile()) return sendStatus(response, 404);
        return sendFile(request, response, captionFontPath, info.size);
      }
      const rawPathname = String(request.url ?? "/").split("?", 1)[0];
      if (!rawPathname.startsWith("/media/")) return sendStatus(response, 404);
      let decoded;
      try { decoded = decodeURIComponent(rawPathname.slice("/media/".length)); } catch { return sendStatus(response, 400); }
      const path = resolve(root, decoded);
      const within = path === root || (!relative(root, path).startsWith(`..${sep}`) && relative(root, path) !== "..");
      if (!within) return sendStatus(response, 403);
      const info = await stat(path);
      if (!info.isFile()) return sendStatus(response, 404);
      return sendFile(request, response, path, info.size);
    } catch (error) {
      if (error?.code === "ENOENT") return sendStatus(response, 404);
      response.statusCode = 500;
      response.end(String(error?.message ?? error));
    }
  };
}

function sendText(response, text, type) {
  const body = Buffer.from(text);
  response.writeHead(200, { "Content-Type": type, "Content-Length": body.length });
  response.end(body);
}

function sendStatus(response, status) {
  response.statusCode = status;
  response.end();
}

function sendFile(request, response, path, size) {
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", MIME.get(extname(path).toLowerCase()) ?? "application/octet-stream");
  const header = request.headers.range;
  if (!header) {
    response.writeHead(200, { "Content-Length": size });
    createReadStream(path).pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match) return sendStatus(response, 416);
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] === "" ? size - 1 : Math.min(size - 1, match[2] === "" ? size - 1 : Number(match[2]));
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    response.setHeader("Content-Range", `bytes */${size}`);
    return sendStatus(response, 416);
  }
  response.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` });
  createReadStream(path, { start, end }).pipe(response);
}
