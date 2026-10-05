import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// page-runtime.js is a browser IIFE. Extract the same functions used by the GPU sprite path.
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

const moduleSource = `
  class DOMParser {
    parseFromString(markup) { return { body: { markup } }; }
  }
  class XMLSerializer {
    serializeToString(body) { return body.markup; }
  }
  ${functionSource("serializeHtmlToXhtml")}
  ${functionSource("escapeAttributeValue")}
  ${functionSource("varsCss")}
  ${functionSource("foreignObjectSvg")}
  export { foreignObjectSvg };
`;
const { foreignObjectSvg } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

const arrow = '<svg xmlns="http://www.w3.org/2000/svg" overflow="visible" width="120" height="80" viewBox="0 0 120 80"><polyline points="10,-10.4 0,0 10,10.4" fill="none" stroke="red" stroke-width="29"/></svg>';

test("GPU sprite root does not clip a thick chevron above its SVG box", () => {
  const output = foreignObjectSvg(arrow, 1920, 1080, "", { "--x": "40px" });
  const rootStyle = output.match(/class="akari-sprite-root" style="([^"]*)"/)?.[1];
  assert.ok(rootStyle, "sprite root style must be present");
  assert.doesNotMatch(rootStyle, /(?:^|;)overflow:hidden(?:;|$)/u);
  assert.match(rootStyle, /(?:^|;)overflow:visible(?:;|$)/u);
});

test("GPU sprite SVG retains its namespaces and foreignObject structure without a DOM parser", () => {
  const output = foreignObjectSvg(arrow, 1920, 1080, "", {});
  assert.match(output, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1920" height="1080" viewBox="0 0 1920 1080">/u);
  assert.match(output, /<foreignObject width="100%" height="100%">/u);
  assert.match(output, /<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" class="akari-sprite-root"/u);
  assert.ok(output.includes(arrow), "the overhanging arrow SVG must survive serialization");
  assert.match(output, /<\/div>\s*<\/foreignObject>\s*<\/svg>$/u);
});
