import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as geometry from "../lib/common/filmstrip-geometry.js";

import {
  WAVEFORM_BAND_MIN_HEIGHT_PX,
  waveformBandLayout,
  waveformBucketsForDuration,
} from "../lib/common/waveform-band.js";

// Theia 全体を起動せず、コンパイル済みの実描画メソッドへ canvas 境界を注入する。
const widgetSource = readFileSync(new URL("../lib/browser/akari-annotations-widget.js", import.meta.url), "utf8");
function widgetMethod(name, nextName) {
  const start = widgetSource.indexOf(`    ${name}(`);
  const end = widgetSource.indexOf(`    ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return widgetSource.slice(start, end);
}

test("動画波形はDPRを上限2で描き、全入力が同じならcanvasを書き直さない", () => {
  const calls = [];
  const context = Object.fromEntries(["setTransform", "scale", "fill", "stroke"].map(name =>
    [name, (...args) => calls.push([name, ...args])]));
  class Path {
    points = [];
    moveTo(x, y) { this.points.push([x, y]); }
    lineTo(x, y) { this.points.push([x, y]); }
    closePath() { this.closed = true; }
  }
  const window = { devicePixelRatio: 2 };
  const widget = runInNewContext(`({${widgetMethod("updateWaveformCanvas", "segmentLabel")}})`, {
    window, Path2D: Path, CLIP_HEADER_HEIGHT: 14,
    waveform_band_1: { waveformBandLayout }, filmstrip_geometry_1: geometry,
  });
  const identities = new WeakMap();
  let identity = 0;
  widget.audioWaveformPeakIdentity = peaks => {
    if (!identities.has(peaks)) identities.set(peaks, ++identity);
    return identities.get(peaks);
  };
  const canvas = { style: {}, dataset: {}, getContext: () => context };
  let peaks = [0.1, 1, 0.2, 0.3];
  const placement = { clipLocalOffsetPx: 0, fullClipWidthPx: 2 };
  const paint = (width = 2, height = 48) => widget.updateWaveformCanvas(canvas, peaks, width, placement, height);
  paint();
  assert.equal(canvas.width, 4);
  assert.equal(canvas.height, 92);
  assert.equal(canvas.style.width, "2px");
  assert.equal(canvas.style.height, "46px");
  assert.equal(canvas.style.top, "1px");
  assert.equal(canvas.style.opacity, "1");
  assert.equal(calls.filter(([name]) => name === "fill").length, 1);
  const envelope = calls.find(([name]) => name === "fill")[1];
  assert.equal(envelope.closed, true);
  assert.deepEqual(envelope.points[0], [0, 0], "先頭px内の最大ピークを拾う");
  assert.deepEqual(envelope.points.at(-1), [0, 46], "上下対称の閉パス");
  assert.equal(context.lineWidth, 1);
  assert.ok(calls.find(([name]) => name === "stroke")[1].points.every(([, y]) => y % 1 === 0.5));
  let count = calls.length;
  paint();
  assert.equal(calls.length, count);
  for (const change of [
    () => { peaks = [...peaks]; },
    () => { peaks.push(0.5); },
    () => { placement.clipLocalOffsetPx = 0.25; },
    () => { placement.fullClipWidthPx = 3; },
    () => { window.devicePixelRatio = 1; },
  ]) {
    change();
    paint();
    assert.ok(calls.length > count);
    count = calls.length;
  }
  paint(3, 96);
  assert.equal(canvas.width, 3);
  assert.equal(canvas.height, 94);
  window.devicePixelRatio = 3;
  paint(3, 96);
  assert.equal(canvas.width, 6);
  assert.equal(canvas.height, 188);
  paint(3, 12);
  assert.equal(canvas.style.height, "12px");
  assert.equal(canvas.style.top, "0px");
  count = calls.length;
  paint(3, 13);
  assert.equal(canvas.style.height, "12px");
  assert.equal(canvas.style.top, "0.5px");
  assert.ok(calls.length > count, "帯高が同じでもtop変更で描き直す");
});

test("音声専用レーンはDPRごとのmaster高さと転送元を使いCSS配置を維持する", () => {
  const window = { devicePixelRatio: 1 };
  const calls = [];
  const masters = [];
  const context = Object.fromEntries(["setTransform", "scale", "drawImage"].map(name =>
    [name, (...args) => calls.push([name, ...args])]));
  const canvas = { style: {}, dataset: {}, getContext: () => context };
  const widget = runInNewContext(`({${widgetMethod("updateAudioWaveformCanvas", "audioWaveformMaster")}})`, {
    window, CLIP_HEADER_HEIGHT: 14, filmstrip_geometry_1: geometry,
  });
  widget.audioWaveformPeakIdentity = () => 1;
  widget.audioWaveformMaster = (key, factory, height) => {
    masters.push({ key, height });
    return { width: factory().length, height };
  };
  widget.audioWaveformPaintState = c => c.dataset.akariWaveformPaintState
    ? JSON.parse(c.dataset.akariWaveformPaintState) : undefined;
  const element = { querySelector: () => canvas };
  const peaks = [0.1, 1, 0.2];
  const placement = { canvasWidthPx: 100, canvasLeftPx: 0, waveformFullWidthPx: 200, waveformOffsetPx: 50 };
  const paint = () => widget.updateAudioWaveformCanvas(element, peaks, "slice", () => peaks, 48, placement);
  paint();
  const band = geometry.audioWaveformBandLayout(48, 14);
  const count = calls.length;
  paint();
  assert.equal(calls.length, count);
  window.devicePixelRatio = 2;
  paint();
  assert.notEqual(masters[0].key, masters.at(-1).key);
  assert.equal(masters.at(-1).height, Math.round(band.heightPx * 2));
  assert.equal(canvas.width, 200);
  assert.equal(canvas.height, Math.round(band.heightPx * 2));
  assert.equal(canvas.style.height, `${band.heightPx}px`);
  const draw = calls.filter(([name]) => name === "drawImage").at(-1);
  assert.equal(draw[5], canvas.height, "sourceはmasterのデバイスpx高");
  assert.deepEqual(draw.slice(6), [0, 0, 100, band.heightPx], "転送先はCSS px");
});

test("波形帯はヘッダーを引かずアイテム中央でトラック高さいっぱいに拡大する", () => {
  assert.equal(WAVEFORM_BAND_MIN_HEIGHT_PX, 12);
  assert.deepEqual(waveformBandLayout(28, 14), { topPx: 1, heightPx: 26 });
  assert.deepEqual(waveformBandLayout(48, 14), { topPx: 1, heightPx: 46 });
  assert.deepEqual(waveformBandLayout(96, 14), { topPx: 1, heightPx: 94 });
  assert.deepEqual(waveformBandLayout(48.5, 14.25), { topPx: 1, heightPx: 46.5 });
});

test("波形帯は上下1pxの余白を取り、狭いクリップでは最低高12pxを優先する", () => {
  assert.deepEqual(waveformBandLayout(24, 14), { topPx: 1, heightPx: 22 });
  assert.deepEqual(waveformBandLayout(12, 14), { topPx: 0, heightPx: 12 });
  assert.deepEqual(waveformBandLayout(10, 14), { topPx: 0, heightPx: 12 });
  assert.deepEqual(waveformBandLayout(48, 100), { topPx: 1, heightPx: 46 });
});

test("非有限・負のクリップ高は0として扱い、ヘッダー高はレイアウトに使わない", () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0]) {
    assert.deepEqual(waveformBandLayout(value, 14), { topPx: 0, heightPx: 12 });
    assert.deepEqual(waveformBandLayout(48, value), { topPx: 1, heightPx: 46 });
  }
});

test("バケット数は40/秒で四捨五入し256〜16384に収める", () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 0, 1, 6.4]) {
    assert.equal(waveformBucketsForDuration(value), 256);
  }
  assert.equal(waveformBucketsForDuration(10.011), 400);
  assert.equal(waveformBucketsForDuration(10.014), 401);
  assert.equal(waveformBucketsForDuration(180), 7200);
  assert.equal(waveformBucketsForDuration(409.6), 16384);
  assert.equal(waveformBucketsForDuration(3600), 16384);
  assert.equal(waveformBucketsForDuration(Number.MAX_VALUE), 16384);
});
