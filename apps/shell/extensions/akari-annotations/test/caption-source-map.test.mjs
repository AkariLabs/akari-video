import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCaptionSourceMappingWarning,
  readCaptionSourceMap,
  resolveCaptionSourceForMapping,
  shouldNotifyCaptionSourceMappingWarning,
} from "../lib/common/caption-source-map.js";

test("captions.json の配列ルートと object ルートから id ごとの src を読む", () => {
  const arraySources = readCaptionSourceMap(JSON.stringify([
    { id: "caption-a", src: "source-a" },
    { id: "caption-without-src" },
  ]));
  const objectSources = readCaptionSourceMap(JSON.stringify({
    captions: [{ id: "caption-b", src: "source-b" }],
  }));

  assert.deepEqual([...arraySources], [["caption-a", "source-a"]]);
  assert.deepEqual([...objectSources], [["caption-b", "source-b"]]);
});

test("明示 src を優先し、src 省略は単一 source のときだけ暗黙補完する", () => {
  const explicitSources = new Map([["caption-a", "source-a"]]);

  assert.equal(resolveCaptionSourceForMapping(
    "caption-a", explicitSources, ["source-a", "source-b"],
  ), "source-a");
  assert.equal(resolveCaptionSourceForMapping(
    "legacy-caption", explicitSources, ["source-a", "source-a"],
  ), "source-a");
  assert.equal(resolveCaptionSourceForMapping(
    "ambiguous-caption", explicitSources, ["source-a", "source-b"],
  ), null);
  assert.equal(resolveCaptionSourceForMapping(
    "uncut-caption", explicitSources, [],
  ), undefined);
});

test("複数 source で src が無い字幕だけを数え、必要な修正を 1 行で案内する", () => {
  const warning = computeCaptionSourceMappingWarning(
    [{ id: "caption-a" }, { id: "caption-b" }, { id: "caption-c" }],
    new Map([["caption-a", "source-a"]]),
    ["source-a", "source-b"],
  );

  assert.equal(
    warning,
    "出自を特定できない字幕 2 件を表示していません。"
      + "複数 source のプロジェクトでは captions.json の各字幕に src が必要です。",
  );
});

test("単一 source の src 省略字幕には警告を出さず、同じ警告も再通知しない", () => {
  const singleSourceWarning = computeCaptionSourceMappingWarning(
    [{ id: "legacy-caption" }],
    new Map(),
    ["source-a", "source-a"],
  );
  const multiSourceWarning = computeCaptionSourceMappingWarning(
    [{ id: "ambiguous-caption" }],
    new Map(),
    ["source-a", "source-b"],
  );

  assert.equal(singleSourceWarning, undefined);
  assert.equal(shouldNotifyCaptionSourceMappingWarning(undefined, singleSourceWarning), false);
  assert.equal(shouldNotifyCaptionSourceMappingWarning(undefined, multiSourceWarning), true);
  assert.equal(shouldNotifyCaptionSourceMappingWarning(multiSourceWarning, multiSourceWarning), false);
  assert.equal(shouldNotifyCaptionSourceMappingWarning(multiSourceWarning, undefined), false);
});

test("output-domain 字幕は src が無くても source 射影不能警告の対象にしない", () => {
  assert.equal(computeCaptionSourceMappingWarning(
    [{ id: "cross-cut", timeDomain: "output" }],
    new Map(),
    ["source-a", "source-b"],
  ), undefined);
});
