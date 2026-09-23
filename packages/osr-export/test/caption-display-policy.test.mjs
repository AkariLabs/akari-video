import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildOsrPage, loadAndBuildOsrPage } from "../src/page-builder.mjs";

// captions.json の display_policy（1 行ずつ順送り）は edit-store の resolveCaptionDisplay が唯一の解決器。
// 書き出しが旧 generateCaptionOverlays で字幕を焼き直すと、読点の直後で必ず割られて
// プレビュー 1 行 / 納品物 2 行になる（プレビュー parity 違反）。このファイルはその退行を捕まえる。
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

const buildArgs = captions => ({
  edit, captions, overlays, projectRoot: "/unused", duration: 6,
  frameEngineBundle: "", pageRuntime: "",
});
const captionLines = html => (String(html).match(/<p class="akari-caption__line">/gu) ?? []).length;

test("display_policy の読点字幕は書き出しでも 1 行で焼く", () => {
  const captions = { display_policy: displayPolicy, default_text_style: { color: "#ffffff", size_px: 64 }, captions: [punctuated] };
  const resolved = buildOsrPage(buildArgs(captions));
  assert.equal(resolved.manifest.captionOverlayCount, 1);
  assert.equal(captionLines(resolved.overlaySheetHtml), 1);
  assert.match(resolved.overlaySheetHtml, /akari-caption--single-line/u);
  // 解決経路は font-family 別名も違う（字形・メトリクスまで食い違うので行数だけでは足りない）。
  assert.match(resolved.overlaySheetHtml, /AKARI Noto Sans JP/u);
  assert.match(resolved.overlaySheetHtml, /data-overlay-id="c-0007-occ-0001-part-1"/u);

  // 同じ文面を display_policy 抜きで通すと旧経路の splitCaptionLines が読点で割る = 退行時の姿。
  assert.equal(captionLines(buildOsrPage(buildArgs([punctuated])).overlaySheetHtml), 2);
});

test("display_policy の断片は順送りで、重ならない時間窓を持つ", () => {
  const captions = { display_policy: displayPolicy, captions: [punctuated, splitting] };
  const page = buildOsrPage(buildArgs(captions));
  assert.equal(page.manifest.captionOverlayCount, 3);
  assert.deepEqual((page.overlaySheetHtml.match(/data-overlay-id="c-[^"]*"/gu) ?? []), [
    'data-overlay-id="c-0007-occ-0001-part-1"',
    'data-overlay-id="c-0008-occ-0001-part-1"',
    'data-overlay-id="c-0008-occ-0001-part-2"',
  ]);
  assert.equal(captionLines(page.overlaySheetHtml), 3);
});

test("display_policy 未宣言のプロジェクトは現行の書き出しバイト列を保つ", () => {
  // 期待値は HEAD（4fa9143e）の buildOsrPage を同じ入力で走らせて採取した。
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
      html: "427e722174cab42959562359ccf7c1889926afe0efc0437e80bf5e6cc16bdcd9",
      sheet: "f01557e3c3265fe63bc529bcdcdb9291256f239067f57d1028a574ac11f82a7d",
    },
    legacyObject: {
      html: "427e722174cab42959562359ccf7c1889926afe0efc0437e80bf5e6cc16bdcd9",
      sheet: "49816d1dd33ecbb4a372cb0e54ecc90bac8e9b9e8cdaabe531c2ba3172f9e41d",
    },
  };
  for (const [name, captions] of Object.entries({ legacyArray, legacyObject })) {
    const page = buildOsrPage(buildArgs(captions));
    assert.equal(digest(page.html), expected[name].html, `${name}: ページ HTML が変わった`);
    assert.equal(digest(page.overlaySheetHtml), expected[name].sheet, `${name}: overlay シートが変わった`);
  }
});

test("単語帳の保護語は書き出しの行分割にも効く", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-osr-caption-word-book-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const captions = {
    display_policy: { ...displayPolicy, max_line_units: 14 },
    captions: [{ id: "c-term", src: "main", start: 0, end: 3, text: "この機能はフレームエンジンが担当します" }],
  };
  const sheet = root => buildOsrPage({ ...buildArgs(captions), projectRoot: root }).overlaySheetHtml;
  // 単語帳が無ければ「フレーム / エンジン」で割れる（= render-cut・preview-server との食い違い）。
  assert.doesNotMatch(sheet(projectRoot), /フレームエンジン/u);

  await mkdir(join(projectRoot, ".akari", "memory"), { recursive: true });
  await writeFile(join(projectRoot, ".akari", "memory", "word-book.json"), JSON.stringify({
    version: 0,
    entries: [{ surface: "フレームエンジン", kind: "term", protect_break: true }],
  }));
  assert.match(sheet(projectRoot), /フレームエンジン/u);
});

const animator = [{ id: "a", basis: "chars", shape: "ramp", start: 0, end: 1, offset: 0, amount: { y: 24, opacity: -1 } }];
const points = [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } }];
const configOf = page => JSON.parse(page.html.match(/window\.__AKARI_OSR_CONFIG__=(.*?);<\/script>/u)[1]);

test("袋 item の animator 宣言は display_policy で割れた断片にも届く", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-osr-caption-policy-"));
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
  const page = await loadAndBuildOsrPage({ projectRoot, duration: 6 });
  // animator 射影 → display 解決の順。宣言はタイムライン item が元 cue の id で選ぶので、
  // 解決後も generatedFrom（= 射影後の元 cue id）から宣言を引き直せる。
  const entries = configOf(page).captionAnimators;
  assert.deepEqual(Object.keys(entries), ["bag::c-0008-occ-0001-part-1", "bag::c-0008-occ-0001-part-2"]);
  for (const entry of Object.values(entries)) {
    assert.deepEqual(entry.animator, animator);
    assert.deepEqual(entry.keyframes, points);
  }
  // 断片は順送り（後の断片は前の断片の終わりから始まる）。
  const [first, second] = Object.values(entries);
  assert.equal(Number((first.start + first.duration).toFixed(6)), Number(second.start.toFixed(6)));
  assert.equal(captionLines(page.overlaySheetHtml), 2);
});
