import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWhisperMarker,
  clipSpansToRange,
  detectUnrecognizedSpans,
  subtractSilences,
  UNRECOGNIZED_ALGO_VERSION,
  UNRECOGNIZED_DEFAULTS,
} from "../src/media/unrecognized-spans.mjs";

for (const marker of ["[BLANK_AUDIO]", "[_BEG_]", "[_TT_42]", "[_SOT_]", "[_EOT_]", "[_TRANSCRIPT_]"]) {
  test(`${marker} は control marker`, () => {
    assert.equal(classifyWhisperMarker(marker), "control");
  });
}

for (const marker of ["[inaudible]", "[音楽]", "[拍手]", "(unintelligible)", "（雑音）"]) {
  test(`${marker} は non-speech marker`, () => {
    assert.equal(classifyWhisperMarker(marker), "non-speech");
  });
}

test("通常語と閉じていない括弧は marker にしない", () => {
  assert.equal(classifyWhisperMarker("通常語"), null);
  assert.equal(classifyWhisperMarker("[unfinished"), null);
});

test("既定値は契約値で固定される", () => {
  assert.deepEqual(UNRECOGNIZED_DEFAULTS, {
    minGapSec: 0.8, minVoicedSec: 0.3, silenceDb: -35, silenceMinSec: 0.2,
  });
});

test("較正済み minGapSec は 0.8 秒", () => {
  assert.equal(UNRECOGNIZED_DEFAULTS.minGapSec, 0.8);
});

for (const [gap, end] of [[0.45, 0.65], [0.799, 0.999], [0.8, 1], [0.801, 1.001]]) {
  test(`既定値で ${gap} 秒の語間隙は ${gap < 0.8 ? "除外" : "採用"}`, () => {
    const segment = { start: 0, end: 2, words: [{ start: 0, end: 0.2 }, { start: end, end: 2 }] };
    assert.deepEqual(detectUnrecognizedSpans(segment, []), gap < 0.8 ? [] : [{ start: 0.2, end }]);
  });
}

test("subtractSilences は先頭の無音を引く", () => {
  assert.deepEqual(subtractSilences({ start: 1, end: 3 }, [{ start: 0.5, end: 1.2 }]), [
    { start: 1.2, end: 3 },
  ]);
});

test("subtractSilences は中間の無音を引いて二分する", () => {
  assert.deepEqual(subtractSilences({ start: 1, end: 3 }, [{ start: 1.5, end: 2 }]), [
    { start: 1, end: 1.5 }, { start: 2, end: 3 },
  ]);
});

test("subtractSilences は末尾の無音を引く", () => {
  assert.deepEqual(subtractSilences({ start: 1, end: 3 }, [{ start: 2.5, end: 3.5 }]), [
    { start: 1, end: 2.5 },
  ]);
});

test("subtractSilences は全被覆なら空配列を返す", () => {
  assert.deepEqual(subtractSilences({ start: 1, end: 3 }, [{ start: 0, end: 4 }]), []);
});

test("0.44 秒の語間隙は採用しない", () => {
  const segment = {
    start: 0, end: 1, words: [{ start: 0, end: 0.2 }, { start: 0.64, end: 1 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [], { minGapSec: 0.45 }), []);
});

test("0.45 秒の語間隙は採用する", () => {
  const segment = {
    start: 0, end: 1, words: [{ start: 0, end: 0.2 }, { start: 0.65, end: 1 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [], { minGapSec: 0.45 }), [{ start: 0.2, end: 0.65 }]);
});

test("無音を引いた残り 0.29 秒は採用しない", () => {
  const segment = {
    start: 0, end: 1.5, words: [{ start: 0, end: 0.2 }, { start: 1.2, end: 1.5 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [{ start: 0.2, end: 0.91 }]), []);
});

test("無音を引いた残り 0.3 秒は採用する", () => {
  const segment = {
    start: 0, end: 1.5, words: [{ start: 0, end: 0.2 }, { start: 1.2, end: 1.5 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [{ start: 0.2, end: 0.9 }]), [
    { start: 0.9, end: 1.2 },
  ]);
});

test("セグメント先頭と末尾の word 時刻の欠けは検出しない", () => {
  const segment = { start: 0, end: 2, words: [{ start: 0.5, end: 1.5 }] };
  assert.deepEqual(detectUnrecognizedSpans(segment, [], { minGapSec: 0.45 }), []);
});

test("未認識アルゴリズムは version 2", () => {
  assert.equal(UNRECOGNIZED_ALGO_VERSION, 2);
});

for (const [name, words, expected] of [
  ["先頭欠け", [{ start: 1, end: 3 }], []],
  ["末尾欠け", [{ start: 0, end: 2 }], []],
  ["中間 gap", [{ start: 0, end: 1 }, { start: 2, end: 3 }], [{ start: 1, end: 2 }]],
]) {
  test(`segment 端規則: ${name}`, () => {
    assert.deepEqual(detectUnrecognizedSpans({ start: 0, end: 3, words }, []), expected);
  });
}

test("有効な word が無い場合は segment 全域を候補にする", () => {
  const segment = { start: 0, end: 3, words: [{ start: 1, end: 1 }, { start: 5, end: 6 }, { start: NaN, end: 2 }] };
  assert.deepEqual(detectUnrecognizedSpans(segment, []), [{ start: 0, end: 3 }]);
});

test("words 無しセグメントは全区間を候補にする", () => {
  assert.deepEqual(detectUnrecognizedSpans({ start: 0.1, end: 0.8 }, [], { minGapSec: 0.45 }), [
    { start: 0.1, end: 0.8 },
  ]);
});

test("マーカーは無音に関係なく (b) と重なる部分を結合する", () => {
  const segment = {
    start: 0,
    end: 2.5,
    words: [{ start: 0, end: 0.5 }, { start: 2.2, end: 2.5 }],
    markers: [{ start: 1.4, end: 1.8 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [{ start: 1.5, end: 2.2 }]), [
    { start: 0.5, end: 1.8 },
  ]);
});

test("マーカーは minGapSec 未満の隙間でも採用する", () => {
  const segment = {
    start: 0, end: 1, words: [{ start: 0.2, end: 0.5 }, { start: 0.8, end: 1 }],
    markers: [{ start: 0.6, end: 0.7 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, []), [{ start: 0.6, end: 0.7 }]);
});

test("マーカーが語に重なる場合も語の内側を出さない", () => {
  const segment = {
    start: 0, end: 1, words: [{ start: 0.2, end: 0.5 }], markers: [{ start: 0.4, end: 0.7 }],
  };
  assert.deepEqual(detectUnrecognizedSpans(segment, [{ start: 0.7, end: 1 }]), [
    { start: 0.5, end: 0.7 },
  ]);
});

test("同じ入力を二回検出してもバイト形が同じ", () => {
  const segment = {
    start: 0, end: 2, words: [{ start: 0, end: 0.3 }, { start: 1.7, end: 2 }],
    markers: [{ start: 0.9, end: 1.1 }],
  };
  const silences = [{ start: 0.3, end: 0.8 }, { start: 1.2, end: 1.7 }];
  assert.deepEqual(detectUnrecognizedSpans(segment, silences), detectUnrecognizedSpans(segment, silences));
});

test("clipSpansToRange は範囲へ切り詰め、0 長を落とす", () => {
  assert.deepEqual(clipSpansToRange([
    { start: 0, end: 1 }, { start: 1.5, end: 2 }, { start: 3, end: 4 },
  ], 0.5, 3), [
    { start: 0.5, end: 1 }, { start: 1.5, end: 2 },
  ]);
});
