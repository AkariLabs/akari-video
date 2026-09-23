import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { enumerateDeclaredRenderInputs, RenderInputError } from "../src/render-inputs.mjs";

test("CSS data URIs containing nested url text do not become undeclared inputs", async t => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-inputs-css-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(join(projectRoot, "overlays"));
  const edit = { sources: [], cuts: [], overlays: [{ id: "neutral", html: "overlays/fragment.html" }] };
  await writeFile(join(projectRoot, "edit.json"), JSON.stringify(edit));

  for (const quote of ["", '"', "'"]) {
    for (const innerUrl of ["url(ghost.png)", "url(%23g)"]) {
      const attributeQuote = quote === '"' ? "'" : '"';
      const data = `data:image/svg+xml;utf8,<svg transform=${attributeQuote}rotate(45)${attributeQuote} fill=${attributeQuote}rgb(1,2,3)${attributeQuote} data-note=${attributeQuote}${innerUrl}${attributeQuote}></svg>`;
      const html = `<style>.neutral{background:url(${quote}${data}${quote})}</style>`;
      await writeFile(join(projectRoot, "overlays/fragment.html"), html);
      const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit });
      assert.deepEqual(inputs.map(input => input.path), ["edit.json", "overlays/fragment.html"]);
    }
  }

  await writeFile(join(projectRoot, "overlays/fragment.html"),
    `<div style="background:url(data:image/svg+xml;utf8,<svg transform='rotate(45)' data-note='url(ghost.png)'></svg>)"></div>`);
  assert.deepEqual((await enumerateDeclaredRenderInputs({ projectRoot, edit })).map(input => input.path),
    ["edit.json", "overlays/fragment.html"]);

  await writeFile(join(projectRoot, "overlays/fragment.html"), "<style>.neutral{background:url(x.png)}</style>");
  await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error =>
    error instanceof RenderInputError && error.message.includes("x.png"));

  await writeFile(join(projectRoot, "overlays/fragment.html"), '<script>document.body.style.background="url(secret.png)"</script>');
  await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error =>
    error instanceof RenderInputError && error.message.includes("undeclared local/network asset reference: secret.png"));

  await writeFile(join(projectRoot, "overlays/fragment.html"), "<p>url(text.png)</p>");
  await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error =>
    error instanceof RenderInputError && error.message.includes("undeclared local/network asset reference: text.png"));

  for (const html of [
    '<svg><rect fill="url(%23g)"/></svg>',
    '<img src="data:image/svg+xml;utf8,<svg fill=\'url(%23g)\'></svg>">',
  ]) {
    await writeFile(join(projectRoot, "overlays/fragment.html"), html);
    await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error =>
      error instanceof RenderInputError && error.message.includes("undeclared local/network asset reference: %23g"));
  }

  await writeFile(join(projectRoot, "overlays/fragment.html"), "<style>.neutral{background:url(open.png</style>");
  await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error =>
    error instanceof RenderInputError && error.message.includes("undeclared local/network asset reference: open.png</style>"));
});
