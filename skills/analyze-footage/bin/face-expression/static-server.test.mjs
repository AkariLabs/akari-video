import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { contentTypeFor, resolveStaticFile } from "./static-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("static server route は render page と WASM を root 内へ解決し、正しい MIME を返す", () => {
  assert.equal(resolveStaticFile(here, "/"), join(here, "render.html"));
  const wasm = resolveStaticFile(
    here,
    "/vendor/tasks-vision-0.10.17/wasm/vision_wasm_internal.wasm",
  );
  assert.equal(wasm, join(here, "vendor/tasks-vision-0.10.17/wasm/vision_wasm_internal.wasm"));
  assert.equal(contentTypeFor(join(here, "render.html")), "text/html; charset=utf-8");
  assert.equal(contentTypeFor(wasm), "application/wasm");
});
