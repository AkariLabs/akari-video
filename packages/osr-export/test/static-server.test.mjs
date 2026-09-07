import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";

import { Agent, get } from "node:http";

import { createStaticRequestHandler, startStaticServer } from "../src/static-server.mjs";

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
// `app.exit()` へ進めない（書き出しは完了しているのにアプリが終了しない）。tasks/2026-09-07-osr-exit-hang。
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
