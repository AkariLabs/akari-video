import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

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
  assert.match(overlay.vars["--caption-text-shadow"], /3px 3px 0 #000000/);
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
