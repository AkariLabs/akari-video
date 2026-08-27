import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";

import { createStaticRequestHandler } from "../src/static-server.mjs";

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
