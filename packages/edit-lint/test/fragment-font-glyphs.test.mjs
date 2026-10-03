import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { lintProject } from "../src/edit-lint.mjs";
import { resolveAssetLibraryRoots } from "../../creator-root/src/index.mjs";

const font = new URL("../../render-cut/test/fixtures/font-cmap/sample.ttf", import.meta.url);
const baseHtml = src => `<div><style>@font-face{font-family:Sample;src:url('${src}')}</style>字</div>`;

async function lintCase(t, html, { params, vars, items, library = false, missing = false, secondFont = false, outsideFont = false } = {}) {
  const project = await mkdtemp(join(tmpdir(), "font-glyph-lint-"));
  const isolatedHome = await mkdtemp(join(tmpdir(), "font-glyph-home-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  t.after(() => rm(isolatedHome, { recursive: true, force: true }));
  const env = { ...process.env, AKARI_HOME: isolatedHome };
  await mkdir(join(project, ".akari"));
  await mkdir(join(project, "overlays"));
  const path = library ? "assets/font/sample/fragment.html" : "overlays/fragment.html";
  const fragment = library ? join(resolveAssetLibraryRoots(env).write, "font/sample/fragment.html") : join(project, path);
  if (outsideFont) {
    const outside = join(dirname(project), `${basename(project)}-outside.ttf`);
    await copyFile(font, outside);
    t.after(() => rm(outside, { force: true }));
    html = baseHtml(`../../${basename(outside)}`).replace("字</div>", "𠮷</div>");
  }
  await mkdir(join(fragment, ".."), { recursive: true });
  await writeFile(fragment, html);
  if (library) {
    await writeFile(join(project, ".akari/asset-references.json"), JSON.stringify({ version: 0, references: [{ category: "font", id: "sample" }] }));
  }
  if (!missing) {
    const fontPath = library ? join(resolveAssetLibraryRoots(env).write, "font/sample/sample.ttf") : join(project, "sample.ttf");
    await copyFile(font, fontPath);
  }
  if (secondFont) await copyFile(new URL("../../../assets/font/shippori-mincho/ShipporiMincho-Regular.ttf", import.meta.url), join(project, "full.ttf"));
  const edit = {
    version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [],
    tracks: [{ id: "visual", lane: "visual", items: items ?? [{ id: "item", at: 0, duration: 1,
      source: { kind: "html", path, ...(params ? { params } : {}), ...(vars ? { vars } : {}) } }] }],
  };
  await writeFile(join(project, "edit.json"), JSON.stringify(edit));
  const result = await lintProject(project, { writeReports: false, env });
  return result.findings.filter(f => f.check === "overlays.fragment-font-glyphs");
}

test("one missing glyph produces one warning with paths and character", async t => {
  const findings = await lintCase(t, baseHtml("../sample.ttf").replace("字</div>", "𠮷</div>"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  for (const part of ["overlay:item fragment overlays/fragment.html", "𠮷(U+20BB7)", "sample.ttf", "1 件"]) assert.ok(findings[0].message.includes(part), findings[0].message);
});

test("fragments without a font face are excluded", async t => {
  assert.deepEqual(await lintCase(t, "<div>𠮷</div>"), []);
});

test("params are included in the glyph check", async t => {
  const findings = await lintCase(t, baseHtml("../sample.ttf"), { params: { title: "𠮷" } });
  assert.equal(findings.filter(f => f.severity === "warning").length, 1);
});

test("vars are included in the glyph check", async t => {
  const findings = await lintCase(t, baseHtml("../sample.ttf"), { vars: { label: "𠮷" } });
  assert.equal(findings.filter(f => f.severity === "warning").length, 1);
});

test("a shared fragment warning identifies the item", async t => {
  const path = "overlays/fragment.html";
  const items = ["plain", "changed"].map((id, index) => ({ id, at: index, duration: 1,
    source: { kind: "html", path, params: { title: index ? "𠮷" : "字" } } }));
  const findings = await lintCase(t, baseHtml("../sample.ttf"), { items });
  const warnings = findings.filter(f => f.severity === "warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /^overlay:changed fragment overlays\/fragment\.html:/u);
});

test("all referenced font cmaps form one union", async t => {
  const html = baseHtml("../sample.ttf").replace("</style>", "@font-face{font-family:Full;src:url('../full.ttf')}</style>").replace("字</div>", "𠮷</div>");
  assert.deepEqual(await lintCase(t, html, { secondFont: true }), []);
});

test("script gets info and declared dynamic characters are checked", async t => {
  const original = baseHtml("../sample.ttf").replace("</div>", "<script>void 0</script></div>");
  assert.ok((await lintCase(t, original)).some(f => f.severity === "info"));
  const declared = original.replace("<div>", '<div data-akari-font-chars="𠮷">');
  assert.ok((await lintCase(t, declared)).some(f => f.severity === "warning"));
});

test("shared library fragments use the same check", async t => {
  const html = baseHtml("sample.ttf").replace("字</div>", "𠮷</div>");
  const warning = (await lintCase(t, html, { library: true })).find(f => f.severity === "warning");
  assert.ok(warning);
  assert.match(warning.message, /^overlay:item fragment assets\/font\/sample\/fragment\.html:/u);
});

test("unreadable fonts report info", async t => {
  const info = (await lintCase(t, baseHtml("../missing.ttf"), { missing: true })).find(f => f.severity === "info");
  assert.ok(info);
  assert.equal(/[A-Z]:[\\/]/iu.test(info.message), false, info.message);
  assert.match(info.message, /見つからない/u);
});

test("fonts outside the project are not opened", async t => {
  const info = (await lintCase(t, "", { outsideFont: true })).find(f => f.severity === "info");
  assert.ok(info);
  assert.match(info.message, /プロジェクト外の参照なので読みません/u);
});

test("prototype attributes and invisible characters do not crash or warn", async t => {
  const html = baseHtml("../sample.ttf").replace("<div>", '<div constructor="雪">').replace("字</div>", "字\u200b\ufe0f\u00ad\u200d</div>");
  assert.deepEqual(await lintCase(t, html), []);
});

test("named references expose missing rendered glyphs", async t => {
  const html = baseHtml("../sample.ttf").replace("字</div>", "&rarr;</div>");
  const warning = (await lintCase(t, html)).find(f => f.severity === "warning");
  assert.ok(warning);
  assert.match(warning.message, /→\(U\+2192\)/u);
});

test("data URI fonts are read", async t => {
  const encoded = (await readFile(font)).toString("base64");
  const html = baseHtml(`data:font/ttf;base64,${encoded}`).replace("字</div>", "𠮷</div>");
  assert.ok((await lintCase(t, html)).some(f => f.severity === "warning"));
});

test("large two-byte fragment does not overflow lint", async t => {
  const html = baseHtml(`data:font/ttf;base64,${"A".repeat(9 * 1024 * 1024)}`);
  await assert.doesNotReject(() => lintCase(t, html));
});
