import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCaptionsCli } from '../bin/captions.mjs';

const fixture = async fn => {
  const project = await mkdtemp(join(tmpdir(), 'akari-migrate-look-'));
  const path = join(project, 'captions.json');
  const root = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    speaker: null, sourceRef: null, edited: false, style_preset: 'neon',
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000' }, animation: { in: { id: 'pop' } } }] }],
    emphasis_words: [{ id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'surprise', style_hint: 'one-char-bang' }] };
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`);
  try { return await fn(project, path); } finally { await rm(project, { recursive: true, force: true }); }
};
const run = (project, flags = []) => {
  const lines = [], errors = [];
  return runCaptionsCli(['migrate-look', project, ...flags], {
    stdout: line => lines.push(line), stderr: line => errors.push(line),
  }).then(code => ({ code, lines, errors }));
};

test('migrate-look を二回実行すると二回目は差分なし', async () => fixture(async (project, path) => {
  const first = await run(project, ['--json']);
  assert.equal(first.code, 0, first.errors.join('\n'));
  assert.ok(JSON.parse(first.lines[0]).changed > 0);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.captions[0].style_preset, undefined);
  assert.equal(stored.captions[0].runs[0].style, undefined);
  assert.ok(stored.captions[0].runs.some(item => item.migrated_from === 'e-0001'));
  const bytes = await readFile(path);
  const second = await run(project, ['--json']);
  assert.equal(second.code, 0, second.errors.join('\n'));
  assert.equal(JSON.parse(second.lines[0]).changed, 0);
  assert.deepEqual(await readFile(path), bytes);
}));

test('migrate-look の dry-run は差分と通知だけ出して書かない', async () => fixture(async (project, path) => {
  const before = await readFile(path);
  const result = await run(project, ['--dry-run', '--json']);
  assert.equal(result.code, 0, result.errors.join('\n'));
  assert.ok(JSON.parse(result.lines[0]).diff.length > 0);
  assert.deepEqual(await readFile(path), before);
}));

test('別名の字幕も対応する edit と一緒に移行する', async () => fixture(async (project, path) => {
  const alternate = join(project, 'captions.second.json');
  await writeFile(alternate, await readFile(path));
  const result = await run(project, ['--json']);
  assert.equal(result.code, 0, result.errors.join('\n'));
  const summary = JSON.parse(result.lines[0]);
  assert.deepEqual(summary.files.map(file => file.captions), ['captions.json', 'captions.second.json']);
  assert.ok(summary.files.every(file => file.changed > 0 && file.written.includes(file.captions)));
  assert.equal(JSON.parse(await readFile(alternate, 'utf8')).captions[0].style_preset, undefined);
}));
