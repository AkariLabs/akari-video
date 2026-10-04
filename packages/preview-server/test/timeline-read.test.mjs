import assert from 'node:assert/strict';
import test from 'node:test';

import { lastRenderableFrame, engineRenderTime, transitionAudioBoundaries, snapToCut } from '../public/timeline-read.js';

// 期待値は移動前の app.js を評価した記録から固定する。
test('lastRenderableFrame は最後の有効フレーム番号を返す', () => {
  const cases = [
    [[5289.4, 30], 158681],
    [[5289.4, 24], 126945],
    [[5289.4, 0], 0],
    [[0, 30], 0],
    [[1 / 30, 30], 0],
    [[100 / 30, 30], 99],
    [[0, NaN], NaN],
  ];
  for (const [input, expected] of cases) assert.strictEqual(lastRenderableFrame(...input), expected);
});

test('engineRenderTime は描画要求だけを最後の有効フレームへ丸める', () => {
  const cases = [
    [[5289.4, 30, 5289.4], 158681 / 30],
    [[5289.4, 30, 5289.4 - 1 / 30], 5289.366666666666],
    [[5289.4, 30, -5], 0],
    [[5289.4, 30, 1234.5], 1234.5],
    [[5289.4, 30, NaN], 0],
    [[5289.4, 30, undefined], 0],
    [[5289.4, 30, Infinity], 0],
    [[5289.4, 0, 5289.4], 5289.4],
    [[0, 30, 1234.5], 0],
    [[1 / 30, 30, 1 / 30], 0],
    [[100 / 30, 30, 100 / 30], 3.3],
    [[5289.4, 24, 5289.4], 5289.375],
  ];
  for (const [input, expected] of cases) assert.strictEqual(engineRenderTime(...input), expected);
});

test('transitionAudioBoundaries は遷移窓の終端と長さを写す', () => {
  const cases = [
    [{ segments: [], totalDuration: 0 }, []],
    [{ transitionWindows: undefined }, []],
    [{ transitionWindows: null }, []],
    [{ transitionWindows: [] }, []],
    [{ transitionWindows: [{ start: 3.5, end: 4, duration: 0.5 }] }, [{ at: 4, duration: 0.5 }]],
    [{ transitionWindows: [{ start: 3.5, end: 4, duration: 0.5, kind: 'crossfade' }, { start: 7, end: 8, duration: 1 }, { start: 10, end: 10.25, duration: 0.25, extra: 1 }] }, [{ at: 4, duration: 0.5 }, { at: 8, duration: 1 }, { at: 10.25, duration: 0.25 }]],
    [{ transitionWindows: [{ start: 1, duration: 0.5 }] }, [{ at: undefined, duration: 0.5 }]],
    [{ transitionWindows: [{ start: 1, end: 2 }] }, [{ at: 2, duration: undefined }]],
    [{ transitionWindows: [{}] }, [{ at: undefined, duration: undefined }]],
    [{ transitionWindows: [{ end: 0, duration: 0 }] }, [{ at: 0, duration: 0 }]],
  ];
  for (const [input, expected] of cases) assert.deepStrictEqual(transitionAudioBoundaries(input), expected);
  for (const input of [undefined, null]) assert.throws(() => transitionAudioBoundaries(input), TypeError);
});

test('snapToCut は境界、重複、ギャップ、方向を守る', () => {
  const empty = [];
  const single = [{ index: 0, isGap: false, outStart: 0, outEnd: 12 }];
  const multiple = [{ index: 0, isGap: false, outStart: 0, outEnd: 4 }, { index: 1, isGap: false, outStart: 4, outEnd: 8 }, { index: 2, isGap: false, outStart: 8, outEnd: 12 }];
  const withGap = [{ index: 0, isGap: false, outStart: 0, outEnd: 3 }, { index: -1, isGap: true, outStart: 3, outEnd: 5 }, { index: 1, isGap: false, outStart: 5, outEnd: 8 }];
  const cases = [
    [[empty, -1, 1], -1],
    [[empty, 5, -1], 5],
    [[empty, 100, 0], 100],
    [[empty, 1.5, undefined], 1.5],
    [[single, -1, 1], 0],
    [[single, 0, 1], 12],
    [[single, 0.0005, 1], 12],
    [[single, 0.002, 1], 12],
    [[single, 1.5, 1], 12],
    [[single, 11.9995, 1], 11.9995],
    [[single, 12, 1], 12],
    [[single, 100, 1], 100],
    [[single, 0, -1], 0],
    [[single, 6.25, -1], 0],
    [[single, 12, -1], 0],
    [[single, 100, -1], 12],
    [[single, 12, 0], 0],
    [[single, 12, undefined], 0],
    [[multiple, 3.998, 1], 4],
    [[multiple, 3.9995, 1], 8],
    [[multiple, 4, 1], 8],
    [[multiple, 4.0005, 1], 8],
    [[multiple, 4.002, 1], 8],
    [[multiple, 6.25, 1], 8],
    [[multiple, 8, 1], 12],
    [[multiple, 12, 1], 12],
    [[multiple, 4, -1], 0],
    [[multiple, 4.002, -1], 4],
    [[multiple, 8, -1], 4],
    [[multiple, 100, -1], 12],
    [[multiple, 8, 0], 4],
    [[multiple, 8, undefined], 4],
    [[withGap, 2.998, 1], 3],
    [[withGap, 2.9995, 1], 5],
    [[withGap, 3, 1], 5],
    [[withGap, 4.998, 1], 5],
    [[withGap, 4.9995, 1], 8],
    [[withGap, 5, 1], 8],
    [[withGap, 8, 1], 8],
    [[withGap, 3, -1], 0],
    [[withGap, 3.002, -1], 3],
    [[withGap, 5, -1], 3],
    [[withGap, 5.002, -1], 5],
    [[withGap, 100, -1], 8],
    [[withGap, 5, 0], 3],
    [[withGap, 5, undefined], 3],
  ];
  for (const [input, expected] of cases) assert.strictEqual(snapToCut(...input), expected);
});
