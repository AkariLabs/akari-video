import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runNarrationCommand } from '../src/narration-command.mjs';

function collectLogs() {
  const lines = [];
  const errors = [];
  return { log: (line) => lines.push(line), logError: (line) => errors.push(line), lines, errors };
}

test('akari narration --help: generate の使い方を表示して exit 0', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['--help'], output);
  assert.equal(result.exitCode, 0);
  assert.match(output.lines.join('\n'), /サブコマンド:/);
  assert.match(output.lines.join('\n'), /akari narration generate/);
});

test('akari narration generate: 不明な引数は exit 2', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['generate', '--unknown'], output);
  assert.equal(result.exitCode, 2);
  assert.match(output.errors.join('\n'), /不明な引数/);
});

test('akari narration: 不明なサブコマンドは従来どおり JSON エラーと exit 2', async () => {
  const output = collectLogs();
  const result = await runNarrationCommand(['unknown'], output);
  assert.equal(result.exitCode, 2);
  assert.match(output.errors.join('\n'), /不明なサブコマンド/);
  assert.equal(JSON.parse(output.lines.at(-1)).error.includes('不明なサブコマンド'), true);
});

test('akari narration generate --dry-run: VOICEVOX を起動せず従来形式の JSON を返す', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-narration-command-test-'));
  try {
    const readingFile = join(scratch, 'reading.txt');
    await writeFile(readingFile, 'テストです。', 'utf8');
    const output = collectLogs();
    const result = await runNarrationCommand([
      'generate', '--project', scratch, '--engine', 'voicevox',
      '--reading-file', readingFile, '--t', '1.5', '--dry-run'
    ], output);
    assert.equal(result.exitCode, 0);
    const json = JSON.parse(output.lines.at(-1));
    assert.equal(json.dry_run, true);
    assert.equal(json.engine, 'voicevox');
    assert.equal(json.output_path, 'out/narration/n-0001.wav');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
