import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRenderArgv } from '../lib/electron-main/akari-render-argv.js';

test('通常起動では何もしない', () => {
  assert.deepEqual(parseRenderArgv(['electron', 'app']), { requested: false });
});

test('--render の全オプションを解釈する', () => {
  const parsed = parseRenderArgv(['app', '--render', '/project', '--out', '/out.mp4', '--fps', '24', '--width', '1280', '--height', '720', '--duration', '2', '--quality', 'high', '--encoder', 'auto', '--verify', 'stamp', '--queue-depth', '2', '--dump-frames', '47,0', '--soft']);
  assert.equal(parsed.requested, true);
  assert.equal(parsed.projectRoot, '/project');
  assert.equal(parsed.out, '/out.mp4');
  assert.equal(parsed.frames, 48);
  assert.equal(parsed.soft, true);
  assert.equal(parsed.queueDepth, 2);
  assert.deepEqual(parsed.dumpFrames, [0, 47]);
});

test('必須値と選択肢が不正なら error を返す', () => {
  assert.match(parseRenderArgv(['app', '--render', '/project']).error, /--out/);
  assert.match(parseRenderArgv(['app', '--render', '/project', '--out', '/out', '--frames', '1', '--verify', 'bad']).error, /--verify/);
});
