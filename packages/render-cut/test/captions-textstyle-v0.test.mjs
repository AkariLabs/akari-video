// captions-textstyle-v0.test — textstyle v0 語彙（2026-08-03）のレンダラ対応検証。
// (1) 新フィールド → CSS 変数への変換
// (2) アニメーション 3 スロット（in/out/loop・presets/textanim 語彙）の合成
// (3) presets/textstyle の全プリセットが default_text_style としてそのまま通る接続契約
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCaptionAnimation,
  captionTextStyleVars,
  generateCaptionOverlays,
  mergeCaptionTextStyles,
  CAPTION_ANIMATION_RECIPES,
} from "../src/captions.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const CAPTIONS = [{ id: "c-0001", text: "テスト字幕です", start: 0, end: 3 }];
const CUTS = [];

function overlaysWith(style) {
  return generateCaptionOverlays(CAPTIONS, CUTS, { defaultTextStyle: style });
}

test("新語彙が CSS 変数へ変換される", () => {
  const vars = captionTextStyleVars(mergeCaptionTextStyles({
    font_family: "'Shippori Mincho', 'Noto Serif JP', serif",
    weight: 300,
    italic: true,
    underline: true,
    letter_spacing_em: 0.08,
    line_height: 1.6,
    text_transform: "upper",
    max_width_pct: 80,
    vertical: true,
    background: { color: "#112233", opacity: 0.8, padding_px: 12 },
    shadow: { color: "#000000", opacity: 0.5, blur_px: 6, distance_px: 4, angle_deg: 90 },
    glow: { color: "#00e5ff", density: 60, spread: 30 },
  }, undefined));
  assert.equal(vars["--caption-font-family"], "'Shippori Mincho', 'Noto Serif JP', serif");
  assert.equal(vars["--caption-font-weight"], "300");
  assert.equal(vars["--caption-font-style"], "italic");
  assert.equal(vars["--caption-text-decoration"], "underline");
  assert.equal(vars["--caption-letter-spacing"], "0.08em");
  assert.equal(vars["--caption-line-height"], "1.6");
  assert.equal(vars["--caption-text-transform"], "uppercase");
  assert.equal(vars["--caption-line-max-width"], "80%");
  assert.equal(vars["--caption-writing-mode"], "vertical-rl");
  assert.equal(vars["--plate-pad-x"], "12px");
  assert.equal(vars["--plate-pad-y"], "12px");
  // 影: angle 90° = 真下 / グロー: 2 層のぼかし影
  assert.match(vars["--caption-text-shadow"], /^0px 4px 6px rgba\(0,0,0,0\.5\), /);
  assert.match(vars["--caption-text-shadow"], /rgba\(0,229,255,1\)/);
});

test("align / text_anchor / position が配置変数になる", () => {
  const aligned = captionTextStyleVars({ align: "left" });
  assert.equal(aligned["--caption-text-align"], "left");
  assert.equal(aligned["--caption-align-items"], "flex-start");

  const anchored = captionTextStyleVars({ text_anchor: "tr" });
  assert.equal(anchored["--caption-top"], "7%");
  assert.equal(anchored["--caption-bottom"], "auto");
  assert.equal(anchored["--caption-align-items"], "flex-end");

  const positioned = captionTextStyleVars({ position: { y: 0.38 } });
  assert.equal(positioned["--caption-top"], "38%");
  assert.equal(positioned["--caption-bottom"], "auto");
});

test("アニメーション: in / loop / out が合成され keyframes が埋まる", () => {
  const built = buildCaptionAnimation(
    { in: { id: "fade-up", duration_sec: 0.4 }, loop: { id: "float" }, out: { id: "fade-up" } },
    3,
  );
  assert.match(built.animationCss, /akari-anim-fade-up 0\.4s ease-out 0s 1 normal both paused/);
  assert.match(built.animationCss, /akari-anim-float 1\.6s linear 0s infinite both paused/);
  // out: 表示 3 秒 − 既定 0.6 秒 = 2.4 秒遅延の時間反転
  assert.match(built.animationCss, /akari-anim-fade-up 0\.6s ease-out 2\.4s 1 reverse forwards paused/);
  assert.match(built.keyframesCss, /@keyframes akari-anim-fade-up/);
  assert.match(built.keyframesCss, /@keyframes akari-anim-float/);

  const [overlay] = overlaysWith({ animation: { in: { id: "zoom-pop" } } });
  assert.match(overlay.html, /akari-anim-zoom-pop/);
  assert.match(overlay.html, /@keyframes akari-anim-zoom-pop/);
  assert.doesNotMatch(overlay.html, /akari-caption-fade 180ms/);
});

test("未知のアニメ id は警告して無視・既定フェードを維持する", () => {
  const warnings = [];
  const overlays = generateCaptionOverlays(CAPTIONS, CUTS, {
    defaultTextStyle: { animation: { in: { id: "no-such-anim" } } },
    onWarning: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown textanim id "no-such-anim"/);
  assert.match(overlays[0].html, /akari-caption-fade 180ms/);
});

test("amp ツマミが振幅変数として埋まる", () => {
  const built = buildCaptionAnimation({ in: { id: "fade-up", amp: 2 } }, 3);
  assert.equal(built.ampCss, "--akari-anim-amp: 2;");
  const [overlay] = overlaysWith({ animation: { in: { id: "fade-up", amp: 2 } } });
  assert.match(overlay.html, /--akari-anim-amp: 2;/);
});

test("textstyle 指定時は同梱フォント全宣言・未指定時は従来の Noto 単独", () => {
  const [styled] = overlaysWith({ color: "#ffffff" });
  assert.match(styled.html, /font-family: "Klee One"/);
  assert.match(styled.html, /font-family: "BIZ UDGothic"/);
  const [plain] = generateCaptionOverlays(CAPTIONS, CUTS, {});
  assert.doesNotMatch(plain.html, /Klee One/);
});

test("presets/textanim の全語彙にレシピが存在する（索引との 1:1 契約）", () => {
  const lines = readFileSync(join(repoRoot, "presets/textanim/index.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim());
  assert.equal(lines.length, 47);
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.ok(CAPTION_ANIMATION_RECIPES[entry.id], `レシピ未定義: ${entry.id}`);
  }
});

test("presets/textstyle の全プリセットが default_text_style としてそのまま通る", () => {
  const dir = join(repoRoot, "presets/textstyle");
  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  assert.ok(files.length >= 11);
  for (const file of files) {
    const preset = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const overlays = generateCaptionOverlays(
      [{ id: "c-0001", text: preset.sample_text ?? "サンプル", start: 0, end: 2 }],
      CUTS,
      { defaultTextStyle: { ...preset.style, ...(preset.position ? { position: preset.position } : {}) } },
    );
    assert.equal(overlays.length, 1, preset.id);
    // スタイルが 1 つ以上の CSS 変数へ実際に変換されていること（語彙の取りこぼし検知）
    assert.ok(Object.keys(overlays[0].vars).length > 0, `${preset.id} produced no vars`);
  }
});
