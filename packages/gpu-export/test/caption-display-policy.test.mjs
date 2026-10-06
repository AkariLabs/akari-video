import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildOsrPage } from "../../osr-export/src/page-builder.mjs";
import { resolveCaptionPlan } from "../../render-cut/src/caption-resolve.mjs";
import { buildGpuPage, loadAndBuildGpuPage } from "../src/page-builder.mjs";

// captions.json の display_policy（1 行ずつ順送り）は edit-store の resolveCaptionDisplay が唯一の解決器。
// 書き出しが display_policy を通さず generateCaptionOverlays で字幕を焼き直すと、
// 20 字の既定上限で 2 行になり、プレビュー 1 行 / 納品物 2 行になる。この退行を捕まえる。
const displayPolicy = {
  mode: "single_line_sequential",
  algorithm: "a4-ja-two-fragment-v1",
  unit_metric: "ascii-half-other-one-v1",
  max_line_units: 19,
  minimum_fragment_duration_seconds: 0.4,
  locale: "ja",
  lines: 1,
  wrap: "multi",
};

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut-1", src: "main", in: 0, out: 6 }],
  overlays: [],
};
const overlays = [{ id: "ov", start: 0, duration: 2, html: "<div>overlay</div>" }];

// 読点を含む実データ由来の cue（19 単位に収まるので解決経路では 1 行）。
const punctuated = { id: "c-0007", src: "main", start: 0, end: 3, text: "実際に動くのは、入力8B・出力16Bだけ。" };
const splitting = { id: "c-0008", src: "main", start: 3, end: 5.5, text: "長いほうの字幕は、二つの断片に割れて順番に出ます。" };
const policyRoot = captions => ({ display_policy: displayPolicy, default_text_style: { color: "#ffffff", size_px: 64 }, captions });

const buildArgs = captions => ({
  edit, captions, overlays, projectRoot: "/unused", duration: 6,
  frameEngineBundle: "", pageRuntime: "",
});
const gpuPage = captions => buildGpuPage({ ...buildArgs(captions), slotParamsRuntime: "", itemKeyframesRuntime: "" });
const captionLines = html => (String(html).match(/<p class="akari-caption__line">/gu) ?? []).length;

test('rich caption metadata reaches GPU fallback and v0 manifest stays unchanged', async () => {
  const richStyle = { size_px: 86, reference_height_px: 1080,
    fill: { type: 'solid', color: '#ef4444' },
    strokes: [{ color: '#210c0c', width_px: 31, offset_y: 9 }] };
  const rich = gpuPage({ default_text_style: richStyle, captions: [punctuated] });
  const sprite = rich.spriteManifest.captions[0];
  assert.deepEqual(sprite.richTextStyle, richStyle);
  assert.match(sprite.html, /akari-caption__rich-fill/u);
  assert.equal(Object.hasOwn(gpuPage([punctuated]).spriteManifest.captions[0], 'richTextStyle'), false);
  const runtime = await readFile(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /captionRichInkExtentEm\(value\.richTextStyle, unitMeasurement\.emPx\)/u);
  assert.match(runtime, /x: 0, y: 0, width: config\.width, height: config\.height/u);
  assert.match(runtime, /captionRichPhaseHtml\(value, config, html/u);
  assert.match(runtime, /hasColor && hasGeometry && !value\.richTextStyle/u);
  assert.match(runtime, /const richBaseCss = value\.richTextStyle[\s\S]*?-webkit-text-fill-color:var\(--caption-color,#fff\)!important;background-image:none!important/u);
  assert.match(runtime, /const richHighlightCss = value\.richTextStyle[\s\S]*?-webkit-text-fill-color:var\(--caption-highlight-color,#ffd94a\)!important;background-image:none!important/u);
  assert.match(runtime, /\$\{settleCss\}\$\{baseCss\}\$\{richBaseCss\}/u);
  assert.match(runtime, /\$\{settleCss\}\$\{highlightCss\}\$\{richHighlightCss\}/u);
});

test("display_policy の読点字幕は書き出しでも 1 行で焼く", () => {
  const resolved = gpuPage(policyRoot([punctuated]));
  assert.equal(resolved.spriteManifest.captions.length, 1);
  const sprite = resolved.spriteManifest.captions[0];
  assert.equal(captionLines(sprite.html), 1);
  assert.match(sprite.html, /akari-caption--single-line/u);
  // 解決経路は font-family 別名も違う（字形・メトリクスまで食い違うので行数だけでは足りない）。
  assert.match(sprite.html, /AKARI Noto Sans JP/u);
  assert.equal(sprite.id, "c-0007-occ-0001-part-1");

  // display_policy 抜きでは同じ文面が既定の 20 字上限を超え、読点を優先して折れる。
  const legacy = gpuPage([punctuated]);
  assert.equal(captionLines(legacy.spriteManifest.captions[0].html), 2);
});

test('karaoke token timings are identical in GPU, OSR, and the shared preview/render plan', () => {
  const words = ['あいう', 'えおか', 'きくけ', 'こさし'].map((text, index) => ({
    text, start: index * 0.5, end: (index + 1) * 0.5,
  }));
  const captions = { display_policy: { ...displayPolicy, max_line_units: 12, lines: 2, word_style: 'karaoke' },
    captions: [{ id: 'c-karaoke', src: 'main', start: 0, end: 2,
      text: words.map(word => word.text).join(''), display_fragments: ['あいうえおか', 'きくけこさし'], words }] };
  const gpu = gpuPage(captions);
  const osr = buildOsrPage(buildArgs(captions));
  const shared = resolveCaptionPlan({ captionsRoot: captions, edit });
  const tokens = html => [...String(html).matchAll(/<span class="akari-caption__tok akari-caption__tok--karaoke" style="([^"]+)">([^<]+)<\/span>/gu)]
    .map(([, timing, text]) => [timing.replace(/\s+/gu, ''), text]);
  const expected = tokens(shared.overlays[0].html);
  assert.equal(expected.length, 4);
  assert.deepEqual(tokens(gpu.spriteManifest.captions[0].html), expected);
  assert.deepEqual(tokens(osr.overlaySheetHtml), expected);
  assert.deepEqual(shared.layout.display_cues[0].display_lines, captions.captions[0].display_fragments);
});

test("display_policy 下の字幕スプライトは静的に焼き切る（語タイルを名乗らない）", () => {
  const sprite = gpuPage(policyRoot([punctuated])).spriteManifest.captions[0];
  // 解決済みの断片は HTML に強調・語スタイルまで畳み込まれている。元 cue で判定すると
  // 断片ではなく cue 全体の words / テキストを見てしまい、焼いた HTML に無い語モードを名乗る。
  assert.equal(sprite.wordMode, "sprite");
  assert.equal(sprite.styleId, null);
  assert.deepEqual(sprite.emphasisStyles, []);
  assert.equal(sprite.sourceWordCount, 0);
  // 実効フォント px は解決済み vars（--caption-font-size）から取る。
  assert.equal(sprite.vars["--caption-font-size"], "64px");
  assert.equal(sprite.emPx, 64);
});

test("GPU と OSR は display_policy 下でも同じ字幕 HTML と同じ本数を出す", () => {
  const captions = policyRoot([punctuated, splitting]);
  // 自由 HTML の overlay も同じシートへ載るので、字幕だけを比べるためここでは外す。
  const gpu = buildGpuPage({ ...buildArgs(captions), overlays: [], slotParamsRuntime: "", itemKeyframesRuntime: "" });
  const osr = buildOsrPage({ ...buildArgs(captions), overlays: [] });
  const sprites = gpu.spriteManifest.captions;
  assert.deepEqual(sprites.map(sprite => sprite.id), [
    "c-0007-occ-0001-part-1", "c-0008-occ-0001-part-1", "c-0008-occ-0001-part-2",
  ]);
  assert.equal(osr.manifest.captionOverlayCount, sprites.length);
  assert.deepEqual(
    (osr.overlaySheetHtml.match(/data-overlay-id="[^"]*"/gu) ?? []),
    sprites.map(sprite => `data-overlay-id="${sprite.id}"`),
  );
  // OSR のシートは GPU のスプライトと同一の字幕 HTML をそのまま載せる。
  for (const sprite of sprites) {
    assert.equal(captionLines(sprite.html), 1);
    assert.ok(osr.overlaySheetHtml.includes(sprite.html), `${sprite.id} の字幕 HTML が OSR 側と違う`);
  }
});

test("display_policy 未宣言の字幕スプライトは既存バイト列を保ち、ページは R·S 順を使う", () => {
  // 字幕スプライトは既存値を維持。ページ HTML は文字送りの共通遅延関数を含む値を固定する。
  // 埋め込みフォントの絶対 file URL は機械依存なので落としてから固定する。
  const digest = value => createHash("sha256")
    .update(String(value).replace(/file:[^"')]+/gu, "file:FONT")).digest("hex");
  const legacyArray = [punctuated, { id: "c-0008", src: "main", start: 3, end: 5, text: "短い字幕" }];
  const legacyObject = {
    default_text_style: { color: "#ffffff", size_px: 64, weight: 700 },
    emphasis_words: [{ id: "e-0001", src: "main", t_start: 0, t_end: 1, word: "AKARI", emotion: "joy" }],
    captions: [
      { id: "c-0001", src: "main", start: 0, end: 1, text: "AKARI", style: "karaoke", words: [{ start: 0, end: 1, text: "AKARI" }] },
      { ...punctuated, start: 1 },
    ],
  };
  const expected = {
    legacyArray: {
      html: "fb2376246a499dea945fe96ef324a61832c01c6e3e87495edb64c6acf56e0480",
      sprites: "aca1fac99554eda262bd16e2e27e812c5b69bed2b599eaaebda8f4bee0f2d109",
    },
    legacyObject: {
      html: "88c2b0c9cc8dbffe58537c89213d6a9812aafb40db20e0a0a6d3c01a911d2b85",
      sprites: "7661a2b3df123c611aef2cd8187cf9934642c898aa683ce0549731dd3a83ce63",
    },
  };
  for (const [name, captions] of Object.entries({ legacyArray, legacyObject })) {
    const page = gpuPage(captions);
    assert.equal(digest(page.html), expected[name].html, `${name}: ページ HTML が変わった`);
    assert.equal(digest(JSON.stringify(page.spriteManifest.captions)), expected[name].sprites,
      `${name}: 字幕スプライトが変わった`);
  }
});

test("単語帳の保護語は書き出しの行分割にも効く", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-gpu-caption-word-book-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const captions = {
    display_policy: { ...displayPolicy, max_line_units: 14 },
    captions: [{ id: "c-term", src: "main", start: 0, end: 3, text: "この機能はフレームエンジンが担当します" }],
  };
  const fragments = root => buildGpuPage({
    ...buildArgs(captions), projectRoot: root, slotParamsRuntime: "", itemKeyframesRuntime: "",
  }).spriteManifest.captions.map(sprite => sprite.html);
  const intact = htmls => htmls.some(html => html.includes("フレームエンジン"));

  // 単語帳が無ければ「フレーム / エンジン」で割れる（= render-cut・preview-server との食い違い）。
  assert.equal(intact(fragments(projectRoot)), false);

  await mkdir(join(projectRoot, ".akari", "memory"), { recursive: true });
  await writeFile(join(projectRoot, ".akari", "memory", "word-book.json"), JSON.stringify({
    version: 0,
    entries: [{ surface: "フレームエンジン", kind: "term", protect_break: true }],
  }));
  assert.equal(intact(fragments(projectRoot)), true);
});

const animator = [{ id: "a", basis: "chars", shape: "ramp", start: 0, end: 1, offset: 0, amount: { y: 24, opacity: -1 } }];
const points = [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } }];

test("袋 item の animator 宣言は display_policy で割れた断片にも届く", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-gpu-caption-policy-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const source = {
    version: 2,
    output: edit.output,
    sources: [{ id: "s", path: "source.mp4" }],
    tracks: [
      { id: "video", lane: "visual", items: [{ id: "cut", at: 0, duration: 180, source: { kind: "media", src: "s", in: 0, out: 6 } }] },
      { id: "subtitles", lane: "visual", items: [{ id: "bag", at: 0, duration: 180, animator, keyframes: points,
        source: { kind: "captions", path: "captions.json", exclude: [] } }] },
    ],
  };
  await writeFile(join(projectRoot, "edit.json"), JSON.stringify(source));
  await writeFile(join(projectRoot, "captions.json"), JSON.stringify({
    display_policy: displayPolicy,
    captions: [{ id: "c-0008", start: 0, end: 2.5, text: splitting.text, time_domain: "output" }],
  }));
  const page = await loadAndBuildGpuPage({ projectRoot, duration: 6 });
  // animator 射影 → display 解決の順。宣言は元 cue の id で選ぶので、解決後も
  // generatedFrom（= 射影後の元 cue id）から宣言を引き直せる。
  assert.deepEqual(page.spriteManifest.captions.map(sprite => sprite.id), [
    "bag::c-0008-occ-0001-part-1", "bag::c-0008-occ-0001-part-2",
  ]);
  for (const sprite of page.spriteManifest.captions) {
    assert.deepEqual(sprite.animator, animator);
    assert.deepEqual(sprite.animatorKeyframes, points);
    assert.equal(captionLines(sprite.html), 1);
  }
});
