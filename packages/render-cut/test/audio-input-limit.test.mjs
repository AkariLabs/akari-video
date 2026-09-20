import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';

import { MAX_AUDIO_INPUTS_PER_COMMAND, buildMultiSourceAudioCutCommand } from '../src/plan.mjs';

// 不具合メモ 第21項: 全編書き出しの audio-cut 段が `spawnSync ffmpeg ENAMETOOLONG` で落ちた。
// Windows の CreateProcess はコマンドライン全体を 32767 UTF-16 単位に制限しており、長い
// プロジェクト絶対パスは入力ごと（-ss / -i）とフィルターグラフの両方に現れるため、200 入力を
// 1 コマンドにまとめる既定値では実プロジェクトで上限を超える。小分けの粒度だけを変える修正
// なので、ここで見るのは「各コマンドが上限に収まるか」と「連結結果が変わらないか」の 2 点。
const WINDOWS_COMMAND_LINE_LIMIT = 32767;

// CreateProcess が数えるのは exe 名と全引数を並べたコマンドライン 1 本ぶんの UTF-16 単位。
// 引用符とセパレーターを 1 引数あたり 3 単位で見積もる（実際の spawn より必ず多めに数える）。
function commandLineLength({ command, args }) {
  return [command, ...args].reduce((total, part) => total + part.length + 3, 0);
}

// 実運用のプロジェクトパス（チャンネル / 動画 / .akari 配下の作業ディレクトリ）と同じ深さ。
const projectRoot = join(
  'C:\\Users\\creator\\OneDrive\\デスクトップ\\_edit\\akari',
  'channels', 'my-channel', 'videos', '2026-09-15-new-video',
);

function options(overrides = {}) {
  return {
    sourceInputs: [{
      id: 'main',
      path: join(projectRoot, 'assets', 'recordings', '2026-09-15-main-camera-take-03.mp4'),
      hasAudio: true,
    }],
    cuts: Array.from({ length: 400 }, (_, index) => ({
      src: 'main', in: index * 1.3671875, out: index * 1.3671875 + 1.234375,
    })),
    duration: 400 * 1.234375,
    cutPath: join(projectRoot, '.akari', 'render-tmp', 'cut-audio.mp4'),
    ffmpegCommand: 'ffmpeg',
    ffprobeCommand: null,
    ...overrides,
  };
}

function everyCommand(built) {
  return [...(built.chunks ?? []), built];
}

// 各カットが「どの素材窓を、どの順で」処理されるかだけを取り出す。小分けの粒度が変わっても
// この列が一致していれば、連結後の音声は同じ（チャンクごとに入力番号が振り直されるだけ）。
function cutWindows(built) {
  const windows = [];
  for (const command of everyCommand(built)) {
    const graph = command.args[command.args.indexOf('-filter_complex') + 1];
    if (graph === undefined) continue;
    windows.push(...graph.match(/atrim=start=[\d.]+:end=[\d.]+.*?apad=whole_dur=[\d.]+/g) ?? []);
  }
  return windows;
}

function seekedInputs(built) {
  const inputs = [];
  for (const command of everyCommand(built)) {
    for (const [index, arg] of command.args.entries()) {
      if (arg === '-ss') inputs.push(command.args.slice(index, index + 6).join(' '));
    }
  }
  return inputs;
}

test('the audio input limit is lowered on Windows, where CreateProcess caps the command line', () => {
  assert.equal(MAX_AUDIO_INPUTS_PER_COMMAND, process.platform === 'win32' ? 25 : 200);
});

// 以降は 25 / 200 を直値で渡す（どの OS で走らせても同じ結果になるように。プラットフォーム
// ごとにどちらが既定になるかは上のテストが押さえている）。
test('a full-length project splits into audio cut commands that fit the Windows command line', () => {
  const built = buildMultiSourceAudioCutCommand(options({ maxInputsPerCommand: 25 }));
  assert.ok(built.chunks.length > 1, 'expected the audio cut to be chunked');
  for (const command of everyCommand(built)) {
    const length = commandLineLength(command);
    assert.ok(
      length < WINDOWS_COMMAND_LINE_LIMIT,
      `command line is ${length} UTF-16 units, over the ${WINDOWS_COMMAND_LINE_LIMIT} limit`,
    );
  }
});

test('the pre-fix limit of 200 overruns the Windows command line on the same project', () => {
  const built = buildMultiSourceAudioCutCommand(options({ maxInputsPerCommand: 200 }));
  assert.ok(
    everyCommand(built).some(command => commandLineLength(command) >= WINDOWS_COMMAND_LINE_LIMIT),
    'expected at least one command to exceed the limit before the fix',
  );
});

test('lowering the limit changes only the chunking, never the cuts that get concatenated', () => {
  const coarse = buildMultiSourceAudioCutCommand(options({ maxInputsPerCommand: 200 }));
  const fine = buildMultiSourceAudioCutCommand(options({ maxInputsPerCommand: 25 }));
  assert.notEqual(coarse.chunks.length, fine.chunks.length);
  assert.equal(fine.concat_list.content.trim().split('\n').length, fine.chunks.length);
  // 同じカットが同じ窓・同じ順で、同じ seek 引数で処理される = 編集 / 品質 / 音声の内容は不変。
  assert.deepEqual(cutWindows(fine), cutWindows(coarse));
  assert.deepEqual(seekedInputs(fine), seekedInputs(coarse));
  assert.equal(cutWindows(fine).length, 400);
});
