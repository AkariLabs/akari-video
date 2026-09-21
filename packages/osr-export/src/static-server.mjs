import { timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MIME = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".mp4", "video/mp4"],
  [".mov", "video/quicktime"], [".webm", "video/webm"], [".wav", "audio/wav"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);

// close() を待てる上限。書き出しは既に終わっているので、ここで待ち続けるより打ち切って終了させる方がよい。
export const STATIC_SERVER_CLOSE_TIMEOUT_MS = 5_000;

// Electron は render-cut の直接の子。プロセスごとに分け、並行 CLI の表を混ぜない。
export function renderMediaReferencesPath(projectRoot, parentPid = process.ppid) {
  return join(projectRoot, ".akari", "render-tmp", `media-references-${parentPid}.json`);
}

function readMediaReferences(projectRoot, env) {
  const token = env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
  if (typeof token !== "string" || !token) return {};
  try {
    const table = JSON.parse(readFileSync(renderMediaReferencesPath(projectRoot), "utf8"));
    if (typeof table?.token !== "string") return {};
    const expected = Buffer.from(token), actual = Buffer.from(table.token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return {};
    return table.references && typeof table.references === "object" && !Array.isArray(table.references)
      ? table.references : {};
  } catch (error) {
    // JSON の構文エラーには入力の一部（合言葉）が含まれ得るため外へ出さない。
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function startStaticServer({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath = null, mediaReferences, env = process.env }) {
  const server = createServer(createStaticRequestHandler({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath, mediaReferences, env }));
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: (timeoutMs = STATIC_SERVER_CLOSE_TIMEOUT_MS) => closeStaticServer(server, timeoutMs),
  };
}

// `server.close()` は新規受付を止めるだけで、**開いている接続がすべて閉じるまでコールバックを呼ばない**。
// OSR / GPU のページはレンダラーから /media/* を keep-alive で取りに来るので、ウィンドウを destroy した後も
// ソケットがプールに残ることがあり、その 1 本のせいで close() が永久に解決しないことがある。呼び出し側は
// finally で `await server.close()` してから `app.exit()` に進むため、**書き出しは完了しているのにプロセスが
// 終了しない**状態になる（解決しない Promise には .catch() も効かない）。
// そこで (1) 残った接続を明示的に落とし、(2) それでも解決しなければ時間で打ち切る。
export function closeStaticServer(server, timeoutMs = STATIC_SERVER_CLOSE_TIMEOUT_MS) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error); else resolvePromise();
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    server.close((error) => finish(error ?? null));
    server.closeAllConnections?.();
  });
}

export function createStaticRequestHandler({ pageHtml, overlaySheetHtml, projectRoot, captionFontPath = null, mediaReferences, env = process.env }) {
  const root = resolve(projectRoot);
  const references = mediaReferences ?? readMediaReferences(root, env);
  return async (request, response) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      // URL() の dot-segment 正規化より前のパスで検査する。
      const rawPathname = String(request.url ?? "/").split("?", 1)[0];
      if (rawPathname === "/" || rawPathname === "/page.html") {
        return sendText(response, pageHtml, "text/html; charset=utf-8");
      }
      if (rawPathname === "/overlay-sheet.html") {
        return sendText(response, overlaySheetHtml, "text/html; charset=utf-8");
      }
      if (rawPathname === "/caption-font.ttf" && captionFontPath) {
        const info = await stat(captionFontPath);
        if (!info.isFile()) return sendStatus(response, 404);
        return sendFile(request, response, captionFontPath, info.size);
      }
      if (!rawPathname.startsWith("/media/")) return sendStatus(response, 404);
      let decoded;
      try { decoded = decodeURIComponent(rawPathname.slice("/media/".length)); } catch { return sendStatus(response, 400); }
      if (decoded.split(/[\\/]/u).includes("..")) return sendStatus(response, 403);
      const path = resolve(root, decoded);
      if (!isWithin(root, path)) return sendStatus(response, 403);
      // lstat で既存の実体（壊れた symlink を含む）を優先し、表への迂回を防ぐ。
      const local = await lstat(path).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      let actual;
      if (local !== null) {
        actual = await realpath(path);
        if (!isWithin(await realpath(root), actual)) return sendStatus(response, 403);
      } else {
        const entry = Object.hasOwn(references, decoded) ? references[decoded] : null;
        if (!entry) return sendStatus(response, 404);
        if (typeof entry.absolute !== "string" || !isAbsolute(entry.absolute)
            || typeof entry.library_root !== "string" || !isAbsolute(entry.library_root)
            || !isWithin(entry.library_root, entry.absolute)) return sendStatus(response, 403);
        actual = await realpath(entry.absolute);
        if (!isWithin(await realpath(entry.library_root), actual)) return sendStatus(response, 403);
      }
      const info = await stat(actual);
      if (!info.isFile()) return sendStatus(response, 404);
      return sendFile(request, response, actual, info.size);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return sendStatus(response, 404);
      response.statusCode = 500;
      response.end(String(error?.message ?? error));
    }
  };
}

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
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
