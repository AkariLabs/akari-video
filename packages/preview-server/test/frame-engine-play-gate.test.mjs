import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const [source, app, supplySource] = await Promise.all([
  readFile(path.join(root, 'src/frame-engine-client.ts'), 'utf8'),
  readFile(path.join(root, 'public/app.js'), 'utf8'),
  readFile(path.join(root, '../frame-engine/src/audio/preview-audio-supply.ts'), 'utf8'),
]);
const section = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return text.slice(from, to);
};

test('共有音声ゲートは最大3秒、両時計を開始位置に保ち debug に公開する', () => {
  assert.match(supplySource, /const PLAY_GATE_MAX_HOLD_SEC = 3;/u);
  const position = section(supplySource, '    position(fallbackSeconds) {', '    playbackTime(fallbackSeconds) {');
  const playback = section(supplySource, '    playbackTime(fallbackSeconds) {', '    seek(seconds,');
  for (const clock of [position, playback]) {
    assert.match(clock, /if \(gateHolding\(\)\) \{\s*latestRequestedSec = gate\.startSec;\s*(?:armPauseWatchdog\(\);\s*)?return gate\.startSec;\s*\}/u);
  }
  const debug = section(supplySource, '  const debug = (): PreviewAudioSupplyDebug => {', '\n  };');
  assert.match(debug, /gate: \{ holding, startSec: holding \? gate\.startSec : 0, heldMs: holding \? now\(\) - gate\.sinceMs : 0, reason: holding \? gate\.reason : null \}/u);
});

test('Web UI client は runtime の据え置き位置を公開する', () => {
  assert.match(source, /heldStartSec\(\): number \| null \{\s*const gate = this\.audio\.debug\(\)\.supply\.gate;\s*return gate\.holding \? gate\.startSec : null;\s*\}/u);
  const factory = section(source, 'export async function createFrameEnginePreview(', '  const ui =');
  assert.match(factory, /heldStartSec\(\): number \| null;/u);
  assert.match(source, /heldStartSec: \(\) => runtime\.heldStartSec\(\),/u);
});

test('Web UI は描画後のゲート位置を要求時計と表示時計に戻し、壁時計は毎 tick 更新する', () => {
  const loop = section(app, 'function playbackLoop()', '\nfunction updateWaveformPlayhead()');
  const branch = section(loop, '  if (frameEngineEnabled) {', '\n    return;\n  }');
  assert.match(branch, /const dt = lastWallMs > 0 \? \(now - lastWallMs\) \/ 1000 : 0;\s*lastWallMs = now;\s*frameEngineRequestedTime \+= dt;/u);
  assert.match(branch, /outputTime = frameEnginePreview\?\.renderPlayback\(frameEngineRequestedTime\) \?\? frameEngineRequestedTime;\s*(?:\/\/[^\n]*\n\s*)*const held = frameEnginePreview\?\.heldStartSec\(\) \?\? null;\s*if \(held !== null\) \{\s*frameEngineRequestedTime = held;\s*outputTime = held;\s*\}\s*seek\.value = outputTime;/u);
  assert.equal([...branch.matchAll(/lastWallMs = now;/gu)].length, 1);
});

test('Web UI の音声表示は degraded、gate、preparing の順で待機秒数を示す', () => {
  const status = section(app, 'function updateAudioStatus()', 'function requestAudioRefresh()');
  for (const message of ['一部の音声を再生できません', '音声を待っています', '音声を準備中']) {
    assert.match(status, new RegExp(message, 'u'));
  }
  const degraded = status.indexOf("if (supply?.phase === 'degraded')");
  const gate = status.indexOf('else if (supply?.gate?.holding)');
  const preparing = status.indexOf("else if (supply?.phase === 'preparing')");
  assert.ok(degraded >= 0 && degraded < gate && gate < preparing);
  assert.match(status, /\(supply\.gate\.heldMs \/ 1000\)\.toFixed\(1\)/u);
});
