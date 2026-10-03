import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { lintProject, runOverlayFragmentFontGlyphCheck } from "../src/edit-lint.mjs";
import { resolveAssetLibraryRoots } from "../../creator-root/src/index.mjs";

const font = new URL("../../render-cut/test/fixtures/font-cmap/sample.ttf", import.meta.url);
const baseHtml = src => `<div><style>@font-face{font-family:Sample;src:url('${src}')}</style>字</div>`;

async function lintCase(t, html, { params, vars, items, library = false, missing = false, brokenFont = false, secondFont = false, secondBrokenFont = false, outsideFont = false } = {}) {
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
    if (brokenFont) await writeFile(fontPath, "not a font");
    else await copyFile(font, fontPath);
  }
  if (secondFont) await copyFile(new URL("../../../assets/font/shippori-mincho/ShipporiMincho-Regular.ttf", import.meta.url), join(project, "full.ttf"));
  if (secondBrokenFont) await writeFile(join(project, "bad.ttf"), "not a font");
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

test("missing glyph warning lists only the first twenty sorted code points", async t => {
  const glyphs = Array.from({ length: 21 }, (_, i) => String.fromCodePoint(0x20000 + i));
  const html = baseHtml("../sample.ttf").replace("字</div>", `${glyphs.toReversed().join("")}</div>`);
  const warnings = (await lintCase(t, html)).filter(f => f.severity === "warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /21 件/u);
  for (let i = 0; i < 20; i++) {
    const mark = `U+${(0x20000 + i).toString(16).toUpperCase()}`;
    assert.ok(warnings[0].message.includes(mark), mark);
    if (i > 0) assert.ok(warnings[0].message.indexOf(mark) > warnings[0].message.indexOf(`U+${(0x20000 + i - 1).toString(16).toUpperCase()}`));
  }
  assert.equal(warnings[0].message.includes("U+20014"), false);
});

test("a corrupt font reports info and suppresses the warning", async t => {
  const html = baseHtml("../sample.ttf").replace("字</div>", "𠮷</div>");
  const findings = await lintCase(t, html, { brokenFont: true });
  assert.equal(findings.filter(f => f.severity === "info").length, 1);
  assert.equal(findings.some(f => f.severity === "warning"), false);
});

test("one unreadable font suppresses a warning even when another is readable", async t => {
  const html = baseHtml("../sample.ttf").replace("</style>", "@font-face{font-family:Bad;src:url('../bad.ttf')}</style>").replace("字</div>", "𠮷</div>");
  const findings = await lintCase(t, html, { secondBrokenFont: true });
  assert.equal(findings.filter(f => f.severity === "info").length, 1);
  assert.equal(findings.some(f => f.severity === "warning"), false);
});

test("CSS selectors named content do not add font family text", async t => {
  const html = baseHtml("../sample.ttf").replace("</style>", '.content:first-child{font-family:"游明朝"}#content:hover{font-family:"游明朝"}</style>');
  assert.deepEqual(await lintCase(t, html), []);
});

test("a font face after İ is still checked", async t => {
  const html = `<div>𠮷<style>.a::before{content:"İİİ"}@font-face{font-family:Sample;src:url('../sample.ttf')}</style></div>`;
  const findings = await lintCase(t, html);
  assert.equal(findings.filter(f => f.severity === "warning").length, 1);
  assert.match(findings[0].message, /𠮷\(U\+20BB7\)/u);
});

test("unexpected glyph check errors become one sanitized info", () => {
  const findings = [{ check: "earlier" }];
  const overlay = { id: "item", html: "overlays/fragment.html" };
  assert.doesNotThrow(() => runOverlayFragmentFontGlyphCheck("<div></div>", overlay, { projectRoot: "." }, findings,
    (_html, _overlay, _paths, output) => {
      output.push({ severity: "warning", check: "overlays.fragment-font-glyphs" });
      throw new TypeError("sensitive absolute path");
    }));
  assert.equal(findings.length, 2);
  assert.equal(findings[1].severity, "info");
  assert.equal(findings[1].check, "overlays.fragment-font-glyphs");
  assert.match(findings[1].message, /TypeError/u);
  assert.equal(findings[1].message.includes("sensitive absolute path"), false);
});

test("the same font in two font faces appears once", async t => {
  const html = baseHtml("../sample.ttf").replace("</style>", "@font-face{font-family:Again;src:url('../sample.ttf')}</style>").replace("字</div>", "𠮷</div>");
  const findings = await lintCase(t, html);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.equal((findings[0].message.match(/sample\.ttf/gu) ?? []).length, 1);
  const unreadable = await lintCase(t, html, { brokenFont: true });
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].severity, "info");
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
