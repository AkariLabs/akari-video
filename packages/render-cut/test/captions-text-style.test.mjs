import assert from "node:assert/strict";
import test from "node:test";

import { captionTextStyleVars, generateCaptionOverlays } from "../src/captions.mjs";

const caption = (textStyle) => ({
  id: "c-0001",
  start: 0,
  end: 2,
  text: "字幕",
  ...(textStyle ? { text_style: textStyle } : {}),
});

test("text_style 完全不在では overlay.vars が空のまま", () => {
  const [overlay] = generateCaptionOverlays([caption()], []);
  assert.deepEqual(overlay.vars, {});
});

test("defaultTextStyle と per-caption をネストもフィールド単位で合成する", () => {
  const [overlay] = generateCaptionOverlays([
    caption({
      color: "#AABBCC",
      stroke: { width_px: 3 },
      background: { radius_px: 12 },
      zone: "top-right",
    }),
  ], [], {
    defaultTextStyle: {
      color: "#112233",
      size_px: 42,
      stroke: { color: "#000000", width_px: 1 },
      background: { color: "#445566", opacity: 0.35, radius_px: 6 },
      zone: "bottom",
    },
  });

  assert.equal(overlay.vars["--caption-color"], "#AABBCC");
  assert.equal(overlay.vars["--caption-font-size"], "42px");
  // width_px=3（per-caption）+ color=#000000（default）→ 中心線 2 倍指定で外側 3px の実線ストローク
  assert.equal(overlay.vars["--caption-stroke"], "6px #000000");
  assert.equal(overlay.vars["--plate-bg"], "rgba(68,85,102,0.35)");
  assert.equal(overlay.vars["--plate-radius"], "12px");
  assert.deepEqual({
    top: overlay.vars["--caption-top"],
    bottom: overlay.vars["--caption-bottom"],
    left: overlay.vars["--caption-left"],
    right: overlay.vars["--caption-right"],
    justify: overlay.vars["--caption-justify-content"],
    align: overlay.vars["--caption-align-items"],
    textAlign: overlay.vars["--caption-text-align"],
  }, {
    top: "7%",
    bottom: "auto",
    left: "4%",
    right: "4%",
    justify: "flex-start",
    align: "flex-end",
    textAlign: "right",
  });
});

test("background.opacity は8桁hexのアルファより優先される", () => {
  const [hexAlpha] = generateCaptionOverlays([
    caption({ background: { color: "#FF000080" } }),
  ], []);
  assert.equal(hexAlpha.vars["--plate-bg"], "rgba(255,0,0,0.502)");

  const [explicitOpacity] = generateCaptionOverlays([
    caption({ background: { color: "#FF000080", opacity: 0.2 } }),
  ], []);
  assert.equal(explicitOpacity.vars["--plate-bg"], "rgba(255,0,0,0.2)");
});

test("zone bottom は既存CSS既定に委ね追加の位置varsを出さない", () => {
  const [overlay] = generateCaptionOverlays([caption({ zone: "bottom" })], []);
  assert.deepEqual(overlay.vars, {});
});

test("単語演出と text_style を同じ overlay 上で共存させる", () => {
  const [overlay] = generateCaptionOverlays([{
    ...caption({ color: "#00FF00", size_px: 48 }),
    style: "karaoke",
    words: [{ start: 0, end: 1, text: "字" }, { start: 1, end: 2, text: "幕" }],
  }], []);
  assert.match(overlay.html, /akari-caption__tok--karaoke/);
  assert.equal(overlay.vars["--caption-color"], "#00FF00");
  assert.equal(overlay.vars["--caption-font-size"], "48px");
});

test("background.mode 省略と per-line 明示は出力が完全同値", () => {
  const withoutMode = generateCaptionOverlays([
    caption({ background: { color: "#11223380", radius_px: 8 } }),
  ], [])[0];
  const explicitPerLine = generateCaptionOverlays([
    caption({ background: { color: "#11223380", radius_px: 8, mode: "per-line" } }),
  ], [])[0];
  assert.equal(explicitPerLine.html, withoutMode.html);
  assert.deepEqual(explicitPerLine.vars, withoutMode.vars);
});

test("background.mode block は複数行を単一 wrapper と block 専用 var で包む", () => {
  const [overlay] = generateCaptionOverlays([
    {
      ...caption({ background: { color: "#11223380", radius_px: 8, mode: "block" } }),
      text: "12345678901234567890二行目",
    },
  ], []);
  assert.match(overlay.html, /class="akari-caption__block"/);
  assert.equal((overlay.html.match(/class="akari-caption__line"/g) ?? []).length, 2);
  assert.match(overlay.html, /\.akari-caption__block \.akari-caption__line/);
  assert.equal(overlay.vars["--plate-block-bg"], "rgba(17,34,51,0.502)");
  assert.equal(overlay.vars["--plate-block-radius"], "8px");
  assert.equal(overlay.vars["--plate-bg"], undefined);
});

test("word-level 字幕も background.mode block の単一 wrapper を使う", () => {
  const [overlay] = generateCaptionOverlays([{
    ...caption({ background: { color: "#000000CC", mode: "block" } }),
    text: "12345678901234567890二行目",
    style: "karaoke",
    words: [
      { start: 0, end: 1, text: "12345678901234567890" },
      { start: 1, end: 2, text: "二行目" },
    ],
  }], []);
  assert.match(overlay.html, /akari-caption__block/);
  assert.match(overlay.html, /akari-caption__tok--karaoke/);
  assert.equal(overlay.vars["--plate-block-bg"], "rgba(0,0,0,0.8)");
});

// issue #40 §2（2026-09-01）: zone 方式の px 系フィールドは reference_height_px を宣言すると
// output.height / reference_height_px で追随する（GPU / OSR 両 page-builder が使う vars）。
test("reference_height_px は output.height 基準の scale を宣言済み px フィールド全部に掛け、宣言なしはバイト同一", () => {
  const style = {
    zone: "bottom", size_px: 36, reference_height_px: 720,
    stroke: { color: "#000000", width_px: 3 },
    shadow: { color: "#000000", blur_px: 6, distance_px: 2 },
    glow: { color: "#00E5FF", spread: 10, offset_x: 1, offset_y: 2 },
    background: { color: "#000000", radius_px: 8, padding_px: 4 },
  };
  const [hd] = generateCaptionOverlays([caption(style)], [], { output: { width: 1280, height: 720 } });
  assert.equal(hd.vars["--caption-font-size"], "36px");
  assert.equal(hd.vars["--caption-stroke"], "6px #000000");
  assert.equal(hd.vars["--plate-radius"], "8px");
  assert.equal(hd.vars["--plate-pad-x"], "4px");
  assert.equal(hd.vars["--caption-text-shadow"],
    "0px 2px 6px rgba(0,0,0,1), 1px 2px 10px rgba(0,229,255,0.8333), 1px 2px 20px rgba(0,229,255,0.5833)");

  const [uhd] = generateCaptionOverlays([caption(style)], [], { output: { width: 3840, height: 2160 } });
  assert.equal(uhd.vars["--caption-font-size"], "108px");
  assert.equal(uhd.vars["--caption-stroke"], "18px #000000");
  assert.equal(uhd.vars["--plate-radius"], "24px");
  assert.equal(uhd.vars["--plate-pad-x"], "12px");
  assert.equal(uhd.vars["--plate-pad-y"], "12px");
  assert.equal(uhd.vars["--caption-text-shadow"],
    "0px 6px 18px rgba(0,0,0,1), 3px 6px 30px rgba(0,229,255,0.8333), 3px 6px 60px rgba(0,229,255,0.5833)");

  // 拡張座布団（offset_x / offset_y / padding_px → --plate-ext-* / --plate-offset-*）と block 角丸も同じ scale
  const [block] = generateCaptionOverlays([caption({
    size_px: 36, reference_height_px: 720,
    background: { color: "#000000", radius_px: 8, mode: "block" },
  })], [], { output: { width: 3840, height: 2160 } });
  assert.equal(block.vars["--plate-block-radius"], "24px");
  const [extended] = generateCaptionOverlays([caption({
    size_px: 36, reference_height_px: 720,
    background: { color: "#000000", radius_px: 8, padding_px: 4, offset_x: 2, offset_y: -1 },
  })], [], { output: { width: 3840, height: 2160 } });
  assert.equal(extended.vars["--plate-ext-radius"], "24px");
  assert.equal(extended.vars["--plate-ext-width"], "12px");
  assert.equal(extended.vars["--plate-ext-height"], "12px");
  assert.equal(extended.vars["--plate-offset-x"], "6px");
  assert.equal(extended.vars["--plate-offset-y"], "-3px");

  // em / % / 比率系（letter_spacing_em / max_width_pct / width_pct / height_pct）は対象外
  const [unitless] = generateCaptionOverlays([caption({
    size_px: 36, reference_height_px: 720, letter_spacing_em: 0.1, max_width_pct: 80,
    background: { color: "#000000", width_pct: 20, height_pct: 10 },
  })], [], { output: { width: 3840, height: 2160 } });
  assert.equal(unitless.vars["--caption-letter-spacing"], "0.1em");
  assert.equal(unitless.vars["--caption-line-max-width"], "80%");
  assert.equal(unitless.vars["--plate-ext-width"], "20%");
  assert.equal(unitless.vars["--plate-ext-height"], "10%");

  // 宣言なしは 4K でも従来値（= 720p の vars とバイト同一）・output 無しでも同じ
  const { reference_height_px: _omitted, ...plain } = style;
  const [legacy] = generateCaptionOverlays([caption(plain)], [], { output: { width: 3840, height: 2160 } });
  assert.deepEqual(legacy.vars, hd.vars);
  const [legacyNoOutput] = generateCaptionOverlays([caption(plain)], []);
  assert.deepEqual(legacyNoOutput.vars, hd.vars);

  // default_text_style と cue のフィールド単位マージ（cue 側の reference_height_px が勝つ）
  const [merged] = generateCaptionOverlays([caption({ reference_height_px: 1080 })], [], {
    defaultTextStyle: { size_px: 36, reference_height_px: 720 },
    output: { width: 3840, height: 2160 },
  });
  assert.equal(merged.vars["--caption-font-size"], "72px");
  const [inherited] = generateCaptionOverlays([caption({ color: "#FFFFFF" })], [], {
    defaultTextStyle: { size_px: 36, reference_height_px: 720 },
    output: { width: 3840, height: 2160 },
  });
  assert.equal(inherited.vars["--caption-font-size"], "108px");

  // 基準は高さ: 縦型出力でも自然
  assert.equal(captionTextStyleVars({ size_px: 36, reference_height_px: 720 }, { width: 1080, height: 1920 })["--caption-font-size"], "96px");
  // output.height が無いと kernel と同型で fail
  assert.throws(() => generateCaptionOverlays([caption(style)], []), (error) => error.code === "INVALID_OUTPUT_GEOMETRY");
  // integer >= 1 以外の宣言は normalizeTextStyle が落とす（scale = 1）
  const [ignored] = generateCaptionOverlays([caption({ size_px: 36, reference_height_px: 720.5 })], [], { output: { width: 3840, height: 2160 } });
  assert.equal(ignored.vars["--caption-font-size"], "36px");
});
