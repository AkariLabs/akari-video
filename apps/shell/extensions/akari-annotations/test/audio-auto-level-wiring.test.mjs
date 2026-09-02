import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  buildAudioMeasureCacheDir,
  buildPackageModuleCandidates,
  measureAudioForLevel,
  measureAudioModuleInWorker,
  oneLineReason
} from '../lib/node/audio-level-resolver.js';

const widgetSource = readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);
const inspectorSource = readFileSync(
  new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8'
);
const resolverSource = readFileSync(
  new URL('../src/node/audio-level-resolver.ts', import.meta.url), 'utf8'
);
const serviceSource = readFileSync(
  new URL('../src/node/akari-annotations-service.ts', import.meta.url), 'utf8'
);

const relativeModule = ['packages', 'media-bin', 'src', 'audio-measure.mjs'];

test('module candidates は resourcesPath を先頭に置く', () => {
  const resourcesPath = resolve('packaged-resources');
  const candidates = buildPackageModuleCandidates(relativeModule, {
    resourcesPath,
    startDirectory: resolve('repo/apps/shell/lib/backend'),
    maxDepth: 2
  });
  assert.equal(candidates[0], resolve(resourcesPath, ...relativeModule));
});

test('module candidates は startDirectory から祖先を順に走査する', () => {
  const startDirectory = resolve('repo/apps/shell/lib/backend');
  const candidates = buildPackageModuleCandidates(relativeModule, { startDirectory, maxDepth: 3 });
  assert.deepEqual(candidates, [
    resolve(startDirectory, ...relativeModule),
    resolve(startDirectory, '..', ...relativeModule),
    resolve(startDirectory, '..', '..', ...relativeModule)
  ]);
});

test('module candidates は resourcesPath と祖先候補の重複を除く', () => {
  const startDirectory = resolve('repo');
  const candidates = buildPackageModuleCandidates(relativeModule, {
    resourcesPath: startDirectory,
    startDirectory,
    maxDepth: 1
  });
  assert.equal(candidates.length, 1);
});

test('module candidates は maxDepth=0 なら resourcesPath 候補だけを返す', () => {
  const resourcesPath = resolve('resources-only');
  assert.deepEqual(buildPackageModuleCandidates(relativeModule, {
    resourcesPath, startDirectory: resolve('ignored'), maxDepth: 0
  }), [resolve(resourcesPath, ...relativeModule)]);
});

test('cacheDir は projectRoot/.akari/cache/audio-measure に固定する', () => {
  const projectRoot = resolve('project');
  assert.equal(
    buildAudioMeasureCacheDir(projectRoot),
    join(projectRoot, '.akari', 'cache', 'audio-measure')
  );
});

test('reason は改行を含まない 1 行へ正規化する', () => {
  assert.equal(oneLineReason(new Error('first\n second\r\nthird')), 'first second third');
});

test('不正 request は例外を投げず ok:false を返す', async () => {
  assert.deepEqual(await measureAudioForLevel({ projectRoot: '', audioPath: '' }), {
    ok: false, reason: 'projectRoot と audioPath が必要です'
  });
});

test('module 解決失敗は例外を投げず ok:false を返す', async () => {
  const result = await measureAudioForLevel(
    { projectRoot: resolve('project'), audioPath: 'missing.wav' },
    { startDirectory: resolve('nowhere'), maxDepth: 2, fileExists: () => false }
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /モジュールを解決できません/u);
});

test('ffmpeg 解決失敗は module 解決後も ok:false を返す', async () => {
  const result = await measureAudioForLevel(
    { projectRoot: resolve('project'), audioPath: 'audio.wav' },
    {
      startDirectory: resolve('repo'), maxDepth: 1, fileExists: () => true,
      resolveFfmpeg: async () => undefined
    }
  );
  assert.deepEqual(result, { ok: false, reason: 'ffmpeg が見つかりませんでした' });
});

test('service helper は計測値を roleForClip と computeInsertLevel へ渡す', async () => {
  const measured = {
    integrated_lufs: -24, sample_peak_dbfs: -8, true_peak_dbtp: -5, duration_sec: 5
  };
  const result = await measureAudioForLevel(
    { projectRoot: resolve('project'), audioPath: 'jingle.wav', collection: 'sfx', durationSec: 5 },
    {
      startDirectory: resolve('repo'), maxDepth: 1, fileExists: () => true,
      resolveFfmpeg: async () => 'ffmpeg',
      measure: async () => measured,
      importModule: async () => ({
        roleForClip: ({ path }) => path.includes('jingle') ? 'jingle' : 'sfx',
        computeInsertLevel: ({ role, measured: input }) => ({
          gain_db: input.integrated_lufs + 30,
          fade_in: 0,
          fade_out: role === 'jingle' ? 0.3 : 0,
          basis: 'lufs'
        })
      })
    }
  );
  assert.deepEqual(result, {
    ok: true,
    measured,
    role: 'jingle',
    gain_db: 6,
    fade_in: 0,
    fade_out: 0.3,
    basis: 'lufs'
  });
});

test('resolver は Function(specifier) 動的 import と 10 秒 timeout を持つ', () => {
  assert.match(resolverSource, /Function\('specifier', 'return import\(specifier\)'\)/u);
  assert.match(resolverSource, /const DEFAULT_TIMEOUT_MS = 10_000/u);
  assert.match(resolverSource, /new Worker\(MEASURE_WORKER_SOURCE/u);
});

test('worker 計測は期限を超えた同期処理を timeout で打ち切る', async () => {
  const moduleUrl = `data:text/javascript,${encodeURIComponent(
    'export function measureAudioLevels(){const end=Date.now()+1000;while(Date.now()<end){}return {};}'
  )}`;
  await assert.rejects(
    measureAudioModuleInWorker(moduleUrl, {
      ffmpegPath: 'ffmpeg', filePath: 'audio.wav', cacheDir: 'cache'
    }, 20),
    /timeout/u
  );
});

test('service は DI 非依存 helper へ measureAudioForLevel RPC を委譲する', () => {
  assert.match(serviceSource, /async measureAudioForLevel\(request: MeasureAudioForLevelRequest\)/u);
  assert.match(serviceSource, /return measureAudioForLevel\(request\)/u);
});

test('挿入フックは gain_db 既指定なら RPC を呼ばない guard を持つ', () => {
  const start = widgetSource.indexOf('const insertedLocation = indexEditV2Items(value).get(itemId)');
  const end = widgetSource.indexOf('await this.writeTimelineSnapshots(editAfter)', start);
  const block = widgetSource.slice(start, end);
  assert.match(block, /!Object\.prototype\.hasOwnProperty\.call\(insertedItem, 'gain_db'\)/u);
  assert.ok(block.indexOf("hasOwnProperty.call(insertedItem, 'gain_db')")
    < block.indexOf('measureAudioForLevel({'));
});

test('挿入成功は v2 updateItem と legacy gain/fade 手術を同じ snapshot に含める', () => {
  assert.match(widgetSource, /value = updateV2Item\(value, \{[\s\S]{0,220}gain_db: measured\.gain_db/u);
  assert.match(widgetSource, /setSfxGainDbInSource\(/u);
  assert.match(widgetSource, /setSfxFadeInSource\(/u);
  assert.match(widgetSource, /fade_in'[\s\S]{0,220}fade_out'/u);
});

test('計測失敗時も挿入 snapshot を保存してから history を 1 件積む', () => {
  const start = widgetSource.indexOf("if (kind === 'audio')");
  const end = widgetSource.indexOf("\n            const sources = Array.isArray(value.sources)", start);
  const block = widgetSource.slice(start, end);
  assert.match(block, /自動レベルを適用できませんでした/u);
  assert.match(block, /editAfter \?\?= stringifyEditV2\(value\)/u);
  assert.ok(block.indexOf('writeTimelineSnapshots(editAfter)') < block.indexOf('this.pushHistory({'));
  assert.equal((block.match(/this\.pushHistory\(\{/gu) ?? []).length, 1);
});

test('成功通知は gain・basis・role を 1 行で表示する', () => {
  assert.match(widgetSource, /自動レベル: \$\{measured\.gain_db\.toFixed\(1\)\} dB（\$\{measured\.basis\}・\$\{measured\.role\}）/u);
});

test('インスペクタは自動レベル actionLabel を音声 write bridge へ配線する', () => {
  assert.match(inspectorSource, /actionLabel: '自動レベル'/u);
  assert.match(inspectorSource, /kind: 'audio-auto-level', id: snapshot\.id, audioKind: snapshot\.audioKind/u);
  assert.match(widgetSource, /return this\.handleAudioAutoLevelWrite\(request\)/u);
});

test('インスペクタ自動レベルは gain_db だけを書き fade を変更しない', () => {
  const start = widgetSource.indexOf('protected async handleAudioAutoLevelWrite');
  const end = widgetSource.indexOf('protected rawV2Item', start);
  const block = widgetSource.slice(start, end);
  assert.match(block, /patch: \{ gain_db: measured\.gain_db \}/u);
  assert.doesNotMatch(block, /fade_in|fade_out/u);
  assert.match(block, /commitEditMutation\('自動レベル'/u);
});
