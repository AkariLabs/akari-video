import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";

import { Agent, get } from "node:http";

import { createStaticRequestHandler, renderMediaReferencesPath, startStaticServer } from "../src/static-server.mjs";

test("library serving uses only resolved references, rechecks containment, and prefers project files", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "osr-library-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project");
  const library = join(temp, "library");
  const declared = "assets/broll/intro/clip.mp4";
  const absolute = join(library, "broll/intro/clip.mp4");
  await mkdir(projectRoot);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, "0123456789");
  await writeFile(join(dirname(absolute), "unlisted.mp4"), "private");
  const outside = join(temp, "library-neighbor", "secret.mp4");
  await mkdir(dirname(outside));
  await writeFile(outside, "secret");
  const mediaReferences = {
    [declared]: { absolute, library_root: library },
    "assets/broll/intro/escape.mp4": { absolute: outside, library_root: library },
    "assets/broll/intro/directory": { absolute: dirname(absolute), library_root: library },
  };
  const options = { pageHtml: "page", overlaySheetHtml: "sheet", projectRoot };
  const handler = createStaticRequestHandler({ ...options, mediaReferences });
  const request = async (url, headers = {}, serve = handler) => {
    const response = new MockResponse();
    const finished = once(response, "finish");
    await serve({ url, headers }, response);
    await finished;
    return { status: response.statusCode, body: Buffer.concat(response.chunks).toString(), headers: response.headers };
  };
  assert.equal((await request(`/media/${declared}`)).body, "0123456789");
  assert.equal((await request(`/media/${declared}`)).status, 200);
  const range = await request(`/media/${declared}`, { range: "bytes=2-5" });
  assert.equal(range.status, 206);
  assert.equal(range.body, "2345");
  assert.equal(range.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal((await request("/media/assets/broll/intro/unlisted.mp4")).status, 404);
  assert.equal((await request("/media/assets/broll/intro/escape.mp4")).status, 403);
  assert.equal((await request("/media/assets/broll/intro/directory")).status, 404);
  for (const url of [
    "/media/../page.html",
    "/media/assets/../assets/broll/intro/clip.mp4",
    "/media/assets/%2e%2e/assets/broll/intro/clip.mp4",
    "/media/assets%2f..%2fassets/broll/intro/clip.mp4",
    "/media/assets%5c..%5cbroll/intro/clip.mp4",
  ]) assert.equal((await request(url)).status, 403, url);

  // 読み込みはハンドラー生成時。明示表（空も含む）がサイドカーより優先する。
  const sidecar = renderMediaReferencesPath(projectRoot);
  await mkdir(dirname(sidecar), { recursive: true });
  const token = "test-render-token";
  const authenticatedOptions = { ...options, env: { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token } };
  await writeFile(sidecar, JSON.stringify({ token, references: mediaReferences }));
  const fromFile = createStaticRequestHandler(authenticatedOptions);
  await rm(sidecar);
  assert.equal((await request(`/media/${declared}`, {}, fromFile)).status, 200);
  assert.equal((await request(`/media/${declared}`, { range: "bytes=2-5" }, fromFile)).status, 206);
  assert.equal((await request("/media/assets/broll/intro/unlisted.mp4", {}, fromFile)).status, 404);
  assert.equal((await request("/media/assets/broll/intro/escape.mp4", {}, fromFile)).status, 403);
  await writeFile(sidecar, JSON.stringify({ token, references: mediaReferences }));
  assert.equal((await request(`/media/${declared}`, {}, createStaticRequestHandler({ ...authenticatedOptions, mediaReferences: {} }))).status, 404);

  // 表を作った後に実体を symlink へ差し替えても脱出を拒否する。
  await rm(absolute);
  await symlink(outside, absolute);
  assert.equal((await request(`/media/${declared}`)).status, 403);
  assert.equal((await request(`/media/${declared}`, {}, fromFile)).status, 403);
  const projectFile = join(projectRoot, declared);
  await mkdir(dirname(projectFile), { recursive: true });
  await writeFile(projectFile, "project wins");
  assert.equal((await request(`/media/${declared}`)).body, "project wins");
  assert.equal((await request(`/media/${declared}`, {}, fromFile)).body, "project wins");
  await rm(projectFile);
  await symlink(outside, projectFile);
  assert.equal((await request(`/media/${declared}`)).status, 403);
  await rm(projectFile);
  await rm(absolute);
  assert.equal((await request(`/media/${declared}`)).status, 404);
});

test("file reference tables require the inherited token", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "osr-untrusted-references-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project");
  const outside = join(temp, "secret.mp4");
  await writeFile(outside, "0123456789");
  const declared = "assets/broll/planted/clip.mp4";
  const references = { [declared]: { absolute: outside, library_root: "/" } };
  const sidecar = renderMediaReferencesPath(projectRoot, process.ppid);
  await mkdir(dirname(sidecar), { recursive: true });
  const token = "a".repeat(64);
  const cases = [
    ["no environment token", {}, { token, references }, 404],
    ["empty environment token", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: "" }, { token: "", references }, 404],
    ["different token", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, { token: "b".repeat(64), references }, 404],
    ["different byte length", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, { token: "é".repeat(64), references }, 404],
    ["non-string token", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, { token: 123, references }, 404],
    ["legacy flat table", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, references, 404],
    ["malformed JSON", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, `{"token":"${token}",`, 404],
    ["matching token", { AKARI_RENDER_MEDIA_REFERENCES_TOKEN: token }, { token, references }, 200],
  ];
  for (const [label, env, table, expected] of cases) {
    await t.test(label, async () => {
      await writeFile(sidecar, typeof table === "string" ? table : JSON.stringify(table));
      const handler = createStaticRequestHandler({ projectRoot, pageHtml: "page", overlaySheetHtml: "sheet", env });
      for (const headers of [{}, { range: "bytes=2-5" }]) {
        const response = new MockResponse();
        const finished = once(response, "finish");
        await handler({ url: `/media/${declared}`, headers }, response);
        await finished;
        const partial = expected === 200 && headers.range;
        assert.equal(response.statusCode, partial ? 206 : expected);
        assert.equal(Buffer.concat(response.chunks).toString(), expected === 200 ? (partial ? "2345" : "0123456789") : "");
        if (partial) assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
      }
    });
  }
});

test("standalone CLI server assembly ignores a planted reference table without an environment token", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "osr-standalone-references-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project");
  const outside = join(temp, "secret.mp4");
  await writeFile(outside, "secret");
  const declared = "assets/broll/planted/clip.mp4";
  const sidecar = renderMediaReferencesPath(projectRoot, process.ppid);
  await mkdir(dirname(sidecar), { recursive: true });
  await writeFile(sidecar, JSON.stringify({
    token: "planted-token", references: { [declared]: { absolute: outside, library_root: "/" } },
  }));
  // akari-osr-export → exportWithOsr → electron-main と同じ組み立て。
  // render-cut の準備も明示 mediaReferences も無い状態で HTTP 配信まで確かめる。
  const server = await startStaticServer({ projectRoot, pageHtml: "page", overlaySheetHtml: "sheet", env: {} });
  try {
    const response = await fetch(new URL(`/media/${declared}`, server.url));
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "");
  } finally {
    await server.close();
  }
});

test("static server は Range 206 と projectRoot 封じ込めを実装する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-static-"));
  const outside = join(root, "..", `outside-${Date.now()}.bin`);
  await writeFile(join(root, "media.bin"), Buffer.from("0123456789"));
  await writeFile(outside, "secret");
  const handler = createStaticRequestHandler({ pageHtml: "page", overlaySheetHtml: "sheet", projectRoot: root });
  try {
    const partial = new MockResponse();
    await handler({ url: "/media/media.bin", headers: { range: "bytes=2-5" } }, partial);
    await once(partial, "finish");
    assert.equal(partial.statusCode, 206);
    assert.equal(partial.headers.get("Content-Range"), "bytes 2-5/10");
    assert.equal(Buffer.concat(partial.chunks).toString(), "2345");
    const escaped = new MockResponse();
    await handler({ url: `/media/%2e%2e/${outside.split("/").at(-1)}`, headers: {} }, escaped);
    assert.equal(escaped.statusCode, 403);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
  }
  setHeader(name, value) { this.headers.set(name, String(value)); }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    return this;
  }
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
}

// 回帰: keep-alive の接続が 1 本残っているだけで `server.close()` は解決せず、呼び出し側の finally が
// `app.exit()` へ進めない（書き出しは完了しているのにアプリが終了しない）。経緯は非公開の内部記録（`akari-video-internal`）の 2026-09-07「OSR 出口のハング」に残している。
// 修正が外れたときはハングではなく 3 秒で fail するように Promise.race で測る。
test("static server の close は keep-alive の接続が残っていても有限時間で解決する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-static-close-"));
  await writeFile(join(root, "media.bin"), Buffer.from("0123456789"));
  const server = await startStaticServer({ pageHtml: "page", overlaySheetHtml: "sheet", projectRoot: root });
  const agent = new Agent({ keepAlive: true, maxSockets: 4 });
  try {
    // 1 本取得して読み切る。keep-alive なのでソケットは agent のプールに残る（destroy しない）。
    const response = await new Promise((resolvePromise, rejectPromise) => {
      const request = get(new URL("/media/media.bin", server.url), { agent }, resolvePromise);
      request.on("error", rejectPromise);
    });
    response.resume();
    await once(response, "end");
    const pooled = Object.values(agent.freeSockets).flat().length + Object.values(agent.sockets).flat().length;
    assert.ok(pooled >= 1, "keep-alive のソケットがプールに残っていること（前提条件）");

    const outcome = await Promise.race([
      server.close().then(() => "closed", (error) => `rejected: ${error?.code ?? error}`),
      new Promise((resolvePromise) => { setTimeout(() => resolvePromise("timeout"), 3_000).unref?.(); }),
    ]);
    assert.equal(outcome, "closed");
  } finally {
    agent.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
