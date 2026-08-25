import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cutOverlapFrames,
  isStillImageSourcePath,
  planTransitionHandleWindow,
  removeV2TransitionOutWithHandleRetractInSource,
} from '../lib/index.js';

const input = (overrides = {}) => ({
  declaredSeconds: 1,
  outgoingTailRoomSeconds: 1,
  incomingHeadRoomSeconds: 1,
  outgoingDurationSeconds: 2,
  incomingDurationSeconds: 2,
  ...overrides,
});

test('隠れのりしろの単一定義は全量・部分・なしの 3 態を連続秒で返す', () => {
  assert.equal(cutOverlapFrames({ tlEnd: 2 }, { tlStart: 2 }, 30), 0);
  assert.deepEqual(planTransitionHandleWindow(input()), {
    effectiveSeconds: 1, halfSeconds: 0.5, outcome: 'full',
  });
  assert.deepEqual(planTransitionHandleWindow(input({ outgoingTailRoomSeconds: 0.2 })), {
    effectiveSeconds: 0.4, halfSeconds: 0.2, outcome: 'clamped',
  });
  assert.deepEqual(planTransitionHandleWindow(input({ incomingHeadRoomSeconds: 0 })), {
    effectiveSeconds: 0, halfSeconds: 0, outcome: 'none',
  });
});

test('窓は両クリップの表示尺を越えず、不正値は安全側の 0 になる', () => {
  assert.deepEqual(planTransitionHandleWindow(input({ outgoingDurationSeconds: 0.1 })), {
    effectiveSeconds: 0.2, halfSeconds: 0.1, outcome: 'clamped',
  });
  assert.equal(planTransitionHandleWindow(input({ declaredSeconds: Number.NaN })).effectiveSeconds, 0);
  assert.equal(planTransitionHandleWindow(input({ incomingHeadRoomSeconds: -1 })).effectiveSeconds, 0);
});

test('静止画拡張子の正準判定は大小文字を問わない', () => {
  for (const path of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.BMP', 'a.gif']) {
    assert.equal(isStillImageSourcePath(path), true, path);
  }
  assert.equal(isStillImageSourcePath('a.mp4'), false);
  assert.equal(isStillImageSourcePath(undefined), false);
});

const formattedV2 = `{
  "version" : 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [{ "id": "video", "path": "clip.mp4" }],
  "tracks": [
    {
      "id": "visual-main", "lane": "visual",
      "items": [
        { "id": "outgoing", "at": 0, "duration": 75,
          "source": { "kind": "media", "src": "video", "in": 0, "out": 2.5,
            "transition_out": { "type": "fade-black", "duration": 0.5 } },
          "crop": { "x": 0, "y": 0, "w": 1, "h": 1 } },
        { "id": "incoming", "at": 60, "duration": 60,
          "source": { "kind": "media", "src": "video", "in": 1, "out": 3 } }
      ]
    }
  ],
  "thumbnail": { "keep": "bytes and key order" }
}
`;

test('旧自動のりしろ救済は宣言・out・duration だけを 1 手術で戻す', () => {
  const result = removeV2TransitionOutWithHandleRetractInSource(formattedV2, {
    itemId: 'outgoing', retractFrames: 15, fps: 30,
  });
  const expected = formattedV2
    .replace('"duration": 75,\n          "source"', '"duration": 60,\n          "source"')
    .replace('"out": 2.5,\n            "transition_out": { "type": "fade-black", "duration": 0.5 }', '"out": 2');
  assert.equal(result, expected);
  assert.equal(JSON.parse(result).tracks[0].items[1].at, 60);
});

test('救済後は旧自動のりしろ適用前の edit.json とバイト一致する', () => {
  const before = formattedV2
    .replace('"duration": 75,\n          "source"', '"duration": 60,\n          "source"')
    .replace('"out": 2.5,\n            "transition_out": { "type": "fade-black", "duration": 0.5 }', '"out": 2');
  const restored = removeV2TransitionOutWithHandleRetractInSource(formattedV2, {
    itemId: 'outgoing', retractFrames: 15, fps: 30,
  });
  assert.equal(restored, before);
});
