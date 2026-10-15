import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// Regression: the hidden measure root of a GPU caption unit is configured through
// element.style.cssText. The caption CSS variables must reach it verbatim. XML-escaping
// them (&quot;) is only correct inside a serialized style="..." attribute; in cssText it made
// --caption-font-family invalid, so the measure root laid out with a fallback font while the
// raster used "AKARI Noto Sans". Outline (stroke) SVGs and word tiles are baked from the
// measured layout, so text after a per-character run drifted from its fill, and karaoke tiles
// were cut at the wrong x.
const source = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("caption measure root receives CSS variables unescaped", () => {
  const names = ["escapeAttributeValue", "varsCss", "varsCssText", "captionRoot"]
    .filter((name) => source.includes(`function ${name}(`));
  const created = [];
  const document = {
    createElement() {
      const root = { className: "", style: { cssText: "" }, innerHTML: "" };
      created.push(root);
      return root;
    },
    body: { appendChild() {} },
  };
  const build = new Function("document", "CAPTION_MEASURE_ROOT_CLASS",
    `${names.map(functionSource).join("\n")}\nreturn captionRoot;`);
  const captionRoot = build(document, "akari-measure-root");
  const family = '"AKARI Noto Sans", "Noto Sans", sans-serif';
  captionRoot({ vars: { "--caption-font-family": family, "--caption-font-size": "56px" } },
    { width: 1280, height: 720 }, "<p>x</p>", "");
  const css = created[0].style.cssText;
  assert.ok(css.includes(`--caption-font-family:${family}`), css);
  assert.ok(!css.includes("&quot;") && !css.includes("&amp;"), css);
  assert.ok(css.includes("--caption-font-size:56px"), css);
});

test("raster attribute path keeps XML-escaped variables", () => {
  const build = new Function(`${["escapeAttributeValue", "varsCss"].map(functionSource).join("\n")}\nreturn varsCss;`);
  assert.equal(build()({ "--caption-font-family": '"A"' }), "--caption-font-family:&quot;A&quot;");
});
