import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const compiledHandler = readFileSync(
  join(extensionRoot, 'lib', 'browser', 'akari-preview-open-handler.js'),
  'utf8',
);

function extractTemplate(methodName) {
  const methodAt = compiledHandler.lastIndexOf(`${methodName}()`);
  assert.notEqual(methodAt, -1);
  const tick = compiledHandler.indexOf('`', methodAt);
  assert.notEqual(tick, -1);
  let index = tick + 1;
  let output = '';
  while (index < compiledHandler.length) {
    const character = compiledHandler[index];
    if (character === '\\') {
      const next = compiledHandler[index + 1];
      if (next === 'n') output += '\n';
      else if (next === 't') output += '\t';
      else if (next === 'r') output += '\r';
      else output += next;
      index += 2;
      continue;
    }
    if (character === '`') break;
    if (character === '$' && compiledHandler[index + 1] === '{') {
      let braces = 1;
      index += 2;
      while (index < compiledHandler.length && braces > 0) {
        const nested = compiledHandler[index];
        if (nested === '\\') { index += 2; continue; }
        if (nested === '{') braces += 1;
        else if (nested === '}') braces -= 1;
        index += 1;
      }
      output += '0';
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

const bootstrap = extractTemplate('frameEngineBootstrapScript');

test('shell frame-engine 音声 glue の生成 JS は構文として妥当', () => {
  assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'frame-engine-audio.js' }));
});

test('shell 評価台は旧音声を停止し、共有予定表と Web Audio を使う', () => {
  assert.match(bootstrap, /previewAudio\.pause\(\)/u);
  assert.match(bootstrap, /engine\.createPreviewAudioSupply\(/u);
  assert.match(bootstrap, /engine\.projectSpeechDeclarations\(normalizedCuts/u);
  assert.doesNotMatch(bootstrap, /const createFrameEngineAudioSupply/u);
  assert.doesNotMatch(bootstrap, /createBufferSource\(\)|buildWebAudioSchedule/u,
    'bootstrap は共通供給の内部実装を複製しない');
  assert.doesNotMatch(bootstrap, /\b-12\b/u, 'glue に ducking 値を再定義しない');
});

test('shell の既存 transport は frame-engine clock と AudioContext.currentTime に追従する', () => {
  // playbackTime() は position() と同じ時計を返しつつ、音声が止まっていれば startFrom を張り直す
  // （2026-09-02: 読むだけの position() では startFrom が黙って降りた後に無音が固定していた）
  assert.match(bootstrap, /position = audioSupply\.playbackTime\(fallbackPosition\)/u);
  assert.match(bootstrap, /pauseWatchdogMs: false/u);
  assert.match(bootstrap, /audioSupply\.playFrom\(position\)/u);
  assert.match(bootstrap, /audioSupply\.pause\(\)/u);
  assert.match(bootstrap, /window\.akariFrameEngineAudioDebug/u);
  assert.match(bootstrap, /window\.akari\.frameEngineClock = clock/u);
  assert.doesNotMatch(bootstrap, /frame-engine-play/u);
});

test('shell developer metrics は speech 件数と decode 時間を既存行へ追記する', () => {
  assert.match(bootstrap, /metrics\.dataset\.audioSpeech/u);
  assert.match(bootstrap, /metrics\.dataset\.speechDecodeMs/u);
  assert.match(bootstrap, /speech\s+' \+ audioState\.scheduled\.speech/u);
  assert.match(bootstrap, /metrics\.dataset\.audioPrefetchPending/u);
  assert.match(bootstrap, /audioSupply\.prime\(\)/u);
  assert.match(bootstrap, /sidecar \? sidecar\.path : raw\.src/u);
});

test('shell cuts 評価は EvaluationPlan.base を参照する', () => {
  // EvaluationPlan.base が cuts、layers は layers[] 専用。先読みは共有 scheduler が担う。
  const renderFrame = bootstrap.slice(
    bootstrap.indexOf('const renderFrame = async'),
    bootstrap.indexOf('scrub = new engine.ScrubController'),
  );
  assert.match(bootstrap, /engine\.createPreviewScheduler\(/u);
  assert.match(renderFrame, /scheduler\.notePresented\(timeUs, \{ reason \}\)/u);
  assert.match(renderFrame, /plan\.base\.length === 0 && plan\.layers\.length === 0/u);
  assert.match(
    renderFrame,
    /const cutIndex = Number\(plan\.base\[0\] && plan\.base\[0\]\.id\.replace\('cut-', ''\)\);/u,
  );
  assert.doesNotMatch(renderFrame, /if \(plan\.layers\.length === 0\) return/u);
});

test('評価台バナーを撤去し、layers を frame-engine 評価へ渡す', () => {
  assert.doesNotMatch(bootstrap, /frame-engine-unsupported-banner|Frame engine 評価台/u);
  assert.match(bootstrap, /layers: Array\.isArray\(summary\.layers\) \? summary\.layers : \[\]/u);
});
