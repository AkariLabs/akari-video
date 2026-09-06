import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { describeFragmentAssetHint, embedFragmentAssets, extractFragmentAssetReferences, rewriteFragmentAssetUrls } from "../src/fragment-assets.mjs";
import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs, RenderInputError } from "../src/render-inputs.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const data = `data:image/png;base64,${png.toString("base64")}`;

test("preview URLs resolve from nested and direct fragment directories and are idempotent", () => {
  for (const [htmlPath, raw, expected] of [
    ["overlays/lower-third/fragment.html", "../../assets/logo.png", "/assets/logo.png"],
    ["overlays/lower-third/fragment.html", "../assets/logo.png", "/overlays/assets/logo.png"],
    ["overlays/x.html", "../assets/logo.png", "/assets/logo.png"],
    ["overlays/x.html", "../assets/日本 語.png", `/assets/${encodeURIComponent("日本 語.png")}`],
  ]) {
    const html = `<img src="${raw}"><video poster="${raw}"><source src="${raw}"></video>`;
    const result = rewriteFragmentAssetUrls(html, { htmlPath, urlPrefix: "/" });
    assert.equal(result, html.replaceAll(raw, expected));
    assert.equal(rewriteFragmentAssetUrls(result, { htmlPath, urlPrefix: "/" }), result);
  }
});

test("preview rewrites srcset and CSS URL tokens while leaving excluded text unchanged", () => {
  const untouched = `<!-- <img src="missing.png"> --><script type="application/json">{"html":"<img src='missing.png'>"}</script>
<style>/* url(missing.png) */ .label { content: "url(missing.png)" }</style>
${[data, "https://example.test/logo.png", "http://example.test/logo.png", "/media/logo.png", "/assets/logo.png", "#logo", "file:logo.png", "blob:logo", "../assets\\logo.png"].map(src => `<img src="${src}">`).join("")}`;
  const html = `<img srcset="../assets/logo.png 1x, ../assets/large.png 2x" style="background:url('../assets/logo.png')"><style>@font-face{src:url(../assets/type.woff2)}</style>${untouched}`;
  const expected = html.replaceAll("../assets/logo.png", "/assets/logo.png").replaceAll("../assets/large.png", "/assets/large.png").replaceAll("../assets/type.woff2", "/assets/type.woff2");
  assert.equal(rewriteFragmentAssetUrls(html, { htmlPath: "overlays/x.html", urlPrefix: "/" }), expected);
  assert.equal(rewriteFragmentAssetUrls(untouched, { htmlPath: "overlays/x.html", urlPrefix: "/" }), untouched);
  assert.equal(rewriteFragmentAssetUrls('<img src="logo.png">', {
    htmlPath: "overlays/x.html", urlPrefix: "/", resolveUrl: () => "http://127.0.0.1:4567/asset/logo.png",
  }), '<img src="http://127.0.0.1:4567/asset/logo.png">');
});

test("missing fragment assets share a project-relative correction hint with export", async t => {
  const { projectRoot, put } = await fixture(t);
  const htmlPath = "overlays/lower-third/fragment.html";
  const raw = "../assets/logo.png";
  const path = "overlays/assets/logo.png";
  const hint = describeFragmentAssetHint({ projectRoot, htmlPath, raw, path });
  assert.match(hint, /^断片ファイル基準では/u);
  assert.match(hint, /`overlays\/assets\/logo.png`/u);
  assert.match(hint, /project の `assets\/logo.png`/u);
  assert.match(hint, /`\.\.\/\.\.\/assets\/logo.png` に直してください/u);
  assert.throws(() => embedFragmentAssets(`<img src="${raw}">`, { projectRoot, htmlPath, overlayId: "logo" }), error => error instanceof RenderInputError && error.message.endsWith(` ${hint}`));
  assert.equal(describeFragmentAssetHint({ projectRoot, htmlPath, raw: "missing.png", path: "overlays/lower-third/missing.png" }), "");
  assert.equal(describeFragmentAssetHint({ projectRoot, htmlPath, raw: "../../../assets/logo.png", path: "../assets/logo.png" }), "");
  await put(path);
  assert.equal(describeFragmentAssetHint({ projectRoot, htmlPath, raw, path }), "");
});

async function fixture(t) {
  const projectRoot = await mkdtemp(join(tmpdir(), "fragment-assets-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const put = async (path, value = png) => {
    await mkdir(dirname(join(projectRoot, path)), { recursive: true });
    await writeFile(join(projectRoot, path), value);
  };
  await put("assets/logo.png");
  await put("assets/large.png");
  return { projectRoot, put, options: { projectRoot, htmlPath: "overlays/fragment.html", overlayId: "logo" } };
}

test("relative images resolve from the fragment directory, including nested fragments", async (t) => {
  const { options, put } = await fixture(t);
  const html = '<img class="logo" src="../assets/logo.png" alt="logo">';
  assert.deepEqual(extractFragmentAssetReferences(html, options.htmlPath), [
    { role: "still-image", attribute: "src", raw: "../assets/logo.png", path: "assets/logo.png" },
  ]);
  assert.equal(embedFragmentAssets(html, options), html.replace("../assets/logo.png", data));
  await put("overlays/assets/logo.png", "nested");
  const nested = { ...options, htmlPath: "overlays/lower-third/fragment.html" };
  assert.equal(extractFragmentAssetReferences(html, nested.htmlPath)[0].path, "overlays/assets/logo.png");
  assert.match(embedFragmentAssets(html, nested), /data:image\/png;base64,bmVzdGVk/u);
  assert.equal(embedFragmentAssets(html.replace("../assets", "../../assets"), nested), html.replace("../assets/logo.png", data));
});

test("srcset embeds every img and source candidate while retaining descriptors", async (t) => {
  const { options } = await fixture(t);
  const html = '<picture><source srcset="../assets/logo.png 320w,../assets/large.png 640w"><img srcset="../assets/logo.png 1x, ../assets/large.png 2x"></picture>';
  assert.equal(extractFragmentAssetReferences(html, options.htmlPath).length, 4);
  assert.equal(embedFragmentAssets(html, options), html.replaceAll("../assets/logo.png", data).replaceAll("../assets/large.png", data));
  const mixed = `<img srcset="${data} 1x, ../assets/logo.png 2x">`;
  const embedded = mixed.replace("../assets/logo.png", data);
  assert.equal(embedFragmentAssets(mixed, options), embedded);
  assert.equal(embedFragmentAssets(embedded, options), embedded);
});

test("style blocks embed quoted and unquoted URLs and font-face sources", async (t) => {
  const { options, put } = await fixture(t);
  await put("assets/type.woff2", "font");
  const html = `<style>/* url(missing.png) */ .a { background: url( ../assets/logo.png ); content: "url(missing.png)" } .b{mask:url('../assets/logo.png')} @font-face {font-family:demo; src: url( "../assets/type.woff2" ) format("woff2")}</style>`;
  const refs = extractFragmentAssetReferences(html, options.htmlPath);
  assert.deepEqual(refs.map(ref => ref.role), ["still-image", "still-image", "font"]);
  assert.equal(embedFragmentAssets(html, options), html.replaceAll("../assets/logo.png", data).replace("../assets/type.woff2", "data:font/woff2;base64,Zm9udA=="));
});

test("style attributes preserve surrounding whitespace, quotes, and other attributes", async (t) => {
  const { options } = await fixture(t);
  const html = `<div title="a > b" style = "background: URL( '../assets/logo.png' ); color:red" data-src="missing.png"></div><div style='mask:url(  "../assets/logo.png"  )'></div>`;
  assert.equal(embedFragmentAssets(html, options), html.replaceAll("../assets/logo.png", data));
});

test("comments, absolute references, and JSON raw text remain byte-identical", async (t) => {
  const { options } = await fixture(t);
  const untouched = `<!-- <img src="missing.png"><style>x{background:url(missing.png)}</style> -->
<script type="application/json" data-akari-3d-scene>{"html":"<img src='missing.png'>", "css":"url(missing.png)"}</script>
<script type=application/json>{"backdrop":"missing.png"}</script>
<script>const html = '<img src="missing.png">';</script>
<textarea><img src="missing.png"></textarea>
<link rel="stylesheet" href="missing.css"><iframe src="missing.html"></iframe><object data="missing.svg"></object><embed src="missing.png">
${[data, "blob:local", "http://example.test/a.png", "https://example.test/a.png", "file:local.png", "javascript:void(0)", "#local", "", "/assets/logo.png", "/media/assets/logo.png", "..\\assets\\logo.png"].map(src => `<img src="${src}">`).join("\n")}`;
  assert.deepEqual(extractFragmentAssetReferences(untouched, options.htmlPath), []);
  assert.equal(embedFragmentAssets(untouched, options), untouched);
});

test("missing references report the overlay, fragment path, and original URL", async (t) => {
  const { options } = await fixture(t);
  assert.throws(() => embedFragmentAssets('<img src="../assets/missing.png">', options), error => {
    assert.ok(error instanceof RenderInputError);
    for (const value of ["overlay:logo", options.htmlPath, "../assets/missing.png"]) assert.ok(error.message.includes(value));
    return true;
  });
});

test("relative references escaping the project are rejected", async (t) => {
  const { options } = await fixture(t);
  assert.throws(() => embedFragmentAssets('<img src="../../outside.png">', options), error => error instanceof RenderInputError && /escapes the project root/u.test(error.message));
});

test("embedded files over 16 MiB are rejected before reading their contents", async (t) => {
  const { options, projectRoot } = await fixture(t);
  const file = await open(join(projectRoot, "assets", "large.png"), "w");
  try { await file.truncate(16 * 1024 * 1024 + 1); } finally { await file.close(); }
  assert.throws(() => embedFragmentAssets('<img src="../assets/large.png">', options), error => {
    assert.ok(error instanceof RenderInputError);
    for (const value of ["overlay:logo", options.htmlPath, "../assets/large.png", "16.000001 MiB", "縮小するか video として扱う"]) assert.ok(error.message.includes(value));
    return true;
  });
});

test("video and audio use segment-encoded media paths and poster images embed", async (t) => {
  const { options, put } = await fixture(t);
  await put("assets/movie clip.mp4", "video");
  await put("assets/音声.mp3", "audio");
  const html = '<video src="../assets/movie clip.mp4" poster="../assets/logo.png"><source src="../assets/movie clip.mp4"></video><audio src="../assets/音声.mp3"></audio>';
  assert.equal(embedFragmentAssets(html, options), html.replaceAll("../assets/movie clip.mp4", "/media/assets/movie%20clip.mp4").replace("../assets/logo.png", data).replace("../assets/音声.mp3", `/media/assets/${encodeURIComponent("音声.mp3")}`));
});

test("embedding is idempotent across attributes and CSS URLs", async (t) => {
  const { options } = await fixture(t);
  const html = '<img src=../assets/logo.png style="background:url(../assets/logo.png)">';
  const embedded = embedFragmentAssets(html, options);
  assert.equal(embedded, html.replaceAll("../assets/logo.png", data));
  assert.equal(embedFragmentAssets(embedded, options), embedded);
});

test("roles follow file extensions and unknown files use an octet-stream data URI", async (t) => {
  const { options, put } = await fixture(t);
  for (const [ext, role] of Object.entries({ PNG: "still-image", svg: "still-image", otf: "font", mkv: "video", flac: "audio", bin: "file" })) {
    assert.equal(extractFragmentAssetReferences(`<source src="asset.${ext}">`, options.htmlPath)[0].role, role);
  }
  await put("assets/icon.svg", "<svg/>");
  await put("assets/payload.bin", "file");
  assert.equal(embedFragmentAssets('<img src="../assets/icon.svg"><source src="../assets/payload.bin">', options), '<img src="data:image/svg+xml;base64,PHN2Zy8+"><source src="data:application/octet-stream;base64,ZmlsZQ==">');
});

test("declared fragment assets participate in input hashes and missing input diagnostics", async (t) => {
  const { options, put, projectRoot } = await fixture(t);
  const edit = { sources: [], cuts: [], overlays: [{ id: options.overlayId, html: options.htmlPath }] };
  await put("edit.json", JSON.stringify(edit));
  await put(options.htmlPath, '<img src="../assets/logo.png"><style>.logo {background:url(../assets/large.png)}</style>');
  const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit });
  assert.equal(inputs.filter(input => input.role === "overlay:logo:fragment-asset").length, 2);
  const before = await hashDeclaredRenderInputs(inputs);
  await put("assets/logo.png", "changed");
  const after = await hashDeclaredRenderInputs(inputs);
  const logo = hashes => hashes.find(input => input.path.replaceAll("\\", "/") === "assets/logo.png").sha256;
  assert.notEqual(logo(before), logo(after));
  await put(options.htmlPath, '<img src="../assets/missing.png">');
  await assert.rejects(enumerateDeclaredRenderInputs({ projectRoot, edit }), error => error instanceof RenderInputError && ["overlay:logo", options.htmlPath, "../assets/missing.png"].every(value => error.message.includes(value)));
});

test("library fallback embeds images but refuses video and audio outside the project", async (t) => {
  const { options, put } = await fixture(t);
  const libraryHome = await mkdtemp(join(tmpdir(), "fragment-library-"));
  const previous = process.env.AKARI_HOME;
  process.env.AKARI_HOME = libraryHome;
  t.after(async () => {
    if (previous === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = previous;
    await rm(libraryHome, { recursive: true, force: true });
  });
  await put(".akari/asset-references.json", JSON.stringify({ version: 0, references: [{ category: "still", id: "logo" }, { category: "broll", id: "clip" }] }));
  for (const [category, id, filename] of [["still", "logo", "logo.png"], ["broll", "clip", "clip.mp4"], ["broll", "clip", "clip.mp3"]]) {
    const directory = join(libraryHome, "assets", category, id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), png);
    const html = `<source src="../assets/${category}/${id}/${filename}">`;
    if (category === "still") assert.equal(embedFragmentAssets(html, options), `<source src="${data}">`);
    else assert.throws(() => embedFragmentAssets(html, options), error => error instanceof RenderInputError && /動画・音声はプロジェクト内に置く/u.test(error.message));
  }
});
