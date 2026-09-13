import assert from "node:assert/strict";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findModel, loadCatalog } from "../../src/cli/catalog.mjs";
import { resolveFalKey } from "../../src/cli/credentials.mjs";
import { MAX_INLINE_BYTES, makeReference, resolveMedia } from "../../src/cli/media-ref.mjs";

test("catalog は正本を読み id でモデルを引く", async () => {
  const catalog = await loadCatalog();
  assert.equal(catalog.version, 1);
  assert.equal(findModel(catalog, "fal:h3-i2v").endpoint, "minimax/h3/image-to-video");
  assert.equal(findModel(catalog, "missing"), null);
});

test("FAL_KEY は env を credentials.env より優先する", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "credentials.env");
  await writeFile(file, `${["FAL_KEY", "file-secret"].join("=")}\n`);
  assert.deepEqual(resolveFalKey({ env: { FAL_KEY: " env-secret " }, credentialsFile: file }), {
    key: "env-secret", key_source: "env:FAL_KEY",
  });
});

test("credentials.env の鍵は値を露出せず file source で返す", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-credentials-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "credentials.env");
  await writeFile(file, `# comment\n${["FAL_KEY", "'file-secret'"].join("=")}\n`);
  assert.deepEqual(resolveFalKey({ env: {}, credentialsFile: file }), {
    key: "file-secret", key_source: "file:credentials.env",
  });
  assert.throws(
    () => resolveFalKey({ env: {}, credentialsFile: path.join(root, "missing.env") }),
    (error) => error.exitCode === 2 && error.message === "FAL_KEY が env にも credentials.env にもありません",
  );
});

test("20 MB 超の参照は data URI にせず契約メッセージで拒否する", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-media-ref-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "large.png");
  await writeFile(file, Buffer.alloc(1));
  await truncate(file, MAX_INLINE_BYTES + 1);
  const reference = makeReference(root, "large.png");
  assert.throws(
    () => resolveMedia(reference, { projectDir: root }),
    /20 MB 超の参照は未対応（fal storage は後日）/u,
  );
});
