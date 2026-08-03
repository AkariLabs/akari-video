import assert from "node:assert/strict";
import test from "node:test";

import { generateCaptionOverlays } from "../src/captions.mjs";

const CAPTION = { id: "c-0001", text: "座布団テスト", start: 0, end: 2 };

function overlayWithDefault(style) {
  return generateCaptionOverlays([CAPTION], [], { defaultTextStyle: style })[0];
}

function overlayWithCaptionStyle(style) {
  return generateCaptionOverlays([{ ...CAPTION, text_style: style }], [])[0];
}

test("background.height_pct は自然高の両端へ追加され padding を両軸とも無視する", () => {
  const overlay = overlayWithDefault({
    background: { color: "#112233", padding_px: 12, height_pct: 150 },
  });

  // 旧式: 自然高 * (1 + 150 / 100 * 2) = 自然高の 4 倍。
  assert.equal(overlay.vars["--plate-ext-height"], "150%");
  assert.equal(overlay.vars["--plate-ext-width"], "0%");
  assert.equal(overlay.vars["--plate-pad-x"], undefined);
  assert.equal(overlay.vars["--plate-pad-y"], undefined);
  assert.equal(overlay.vars["--plate-ext-bg"], "rgba(17,34,51,1)");
  assert.equal(overlay.vars["--plate-bg"], undefined);
  assert.match(
    overlay.html,
    /inset: calc\(0px - var\(--plate-ext-height, 0px\)\) calc\(0px - var\(--plate-ext-width, 0px\)\);/,
  );
});

test("background.width_pct は自然幅の両端へ追加される", () => {
  const overlay = overlayWithCaptionStyle({
    background: { color: "#000000", width_pct: 25 },
  });

  // 自然幅 * (1 + 25 / 100 * 2) = 自然幅の 1.5 倍。
  assert.equal(overlay.vars["--plate-ext-width"], "25%");
  assert.equal(overlay.vars["--plate-ext-height"], "0%");
  assert.match(overlay.html, /\.akari-caption__line::before \{/);
});

test("background.offset_x は padding 方式の座布団レイヤーだけを横へ動かす", () => {
  const overlay = overlayWithDefault({
    background: { color: "#000000", padding_px: 9, offset_x: 18 },
  });

  assert.equal(overlay.vars["--plate-ext-width"], "9px");
  assert.equal(overlay.vars["--plate-ext-height"], "9px");
  assert.equal(overlay.vars["--plate-offset-x"], "18px");
  assert.equal(overlay.vars["--caption-left"], undefined);
  assert.equal(overlay.vars["--caption-top"], undefined);
  assert.match(
    overlay.html,
    /\.akari-caption__line::before \{[\s\S]*transform: translate\(var\(--plate-offset-x, 0px\), var\(--plate-offset-y, 0px\)\);/,
  );
});

test("background.offset_y は padding 方式の座布団レイヤーだけを縦へ動かす", () => {
  const overlay = overlayWithCaptionStyle({
    background: { color: "#000000", padding_px: 7, offset_y: -11 },
  });

  assert.equal(overlay.vars["--plate-ext-width"], "7px");
  assert.equal(overlay.vars["--plate-ext-height"], "7px");
  assert.equal(overlay.vars["--plate-offset-y"], "-11px");
  assert.equal(overlay.vars["--caption-left"], undefined);
  assert.equal(overlay.vars["--caption-top"], undefined);
});

test("vertical_align は単独で効き text_anchor の縦成分が優先される", () => {
  const bottom = overlayWithDefault({ vertical_align: "bottom" });
  assert.equal(bottom.vars["--caption-top"], "auto");
  assert.equal(bottom.vars["--caption-bottom"], "7%");

  const anchored = overlayWithCaptionStyle({ vertical_align: "bottom", text_anchor: "tc" });
  assert.equal(anchored.vars["--caption-top"], "7%");
  assert.equal(anchored.vars["--caption-bottom"], "auto");
  assert.equal(anchored.vars["--caption-align-items"], "center");
});
