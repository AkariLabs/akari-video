import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../bin/akari-apply-textstyle.mjs';

const fixture = async (extra, fn) => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-apply-boundary-'));
  const path = join(dir, 'captions.json');
  const root = { captions: [{ id: 'c-0001', start: 0, end: 2, text: '猫',
    speaker: null, sourceRef: null, edited: false, ...extra }] };
  await writeFile(path, `${JSON.stringify(root, null, 2)}\n`);
  try { return await fn(dir, path); } finally { await rm(dir, { recursive: true, force: true }); }
};
const io = () => { const output = [], errors = []; return { output, errors,
  log: text => output.push(text), error: text => errors.push(text) }; };

test('CLI が行に当てると style_sources.look を記録する', async () => fixture({}, async (dir, path) => {
  const output = io();
  assert.equal(await runCli([dir, 'subtitle-news', '--caption', '0'], output), 0, output.errors.join('\n'));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.captions[0].style_sources.look.kind, 'builtin');
  assert.equal(saved.captions[0].style_sources.look.id, 'subtitle-news');
}));

test('CLI の数値指定は id の無い行にも当たり出力は保存値と一致する', async () => fixture({ id: undefined }, async (dir, path) => {
  const output = io();
  assert.equal(await runCli([dir, 'subtitle-news', '--caption', '0'], output), 0, output.errors.join('\n'));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(JSON.parse(output.output[0]).changes[0].after, saved.captions[0].text_style);
}));

test('CLI の対象省略は default_text_style に既存の深い合成で当てる', async () => fixture({}, async (dir, path) => {
  const output = io();
  assert.equal(await runCli([dir, 'subtitle-news'], output), 0, output.errors.join('\n'));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.default_text_style.size_px, 56);
  assert.equal(saved.default_text_style.background.color, '#c62828');
  assert.equal(JSON.parse(output.output[0]).changes[0].target, 'default_text_style');
}));

test('配列ルートへの対象省略は既定スタイルを先頭に置いた全文で保存する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-apply-boundary-'));
  const path = join(dir, 'captions.json');
  const captions = [{ id: 'c-1', start: 0, end: 1, text: '本文' }];
  try {
    await writeFile(path, `${JSON.stringify(captions, null, 2)}\n`);
    const output = io();
    assert.equal(await runCli([dir, 'narration-caption'], output), 0, output.errors.join('\n'));
    const applied = JSON.parse(output.output[0]).changes[0].after;
    assert.equal(await readFile(path, 'utf8'),
      `${JSON.stringify({ default_text_style: applied, captions }, null, 2)}\n`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI の dry-run は従来の JSON を出しファイルを変えない', async () => fixture({}, async (dir, path) => {
  const before = await readFile(path);
  const output = io();
  assert.equal(await runCli([dir, 'subtitle-news', '--dry-run'], output), 0);
  assert.equal(JSON.parse(output.output[0]).dry_run, true);
  assert.deepEqual(await readFile(path), before);
}));

test('CLI が style_preset を持つ行に当てると値に解いて消す', async () => fixture({
  style_preset: 'neon', text_style: { color: '#ffffff' },
}, async (dir, path) => {
  const output = io();
  assert.equal(await runCli([dir, 'subtitle-news', '--caption', '0'], output), 0, output.errors.join('\n'));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.captions[0].style_preset, undefined);
  assert.equal(saved.captions[0].text_style.color, '#ffffff');
  assert.equal(saved.captions[0].style_sources.look.id, 'subtitle-news');
  assert.equal(JSON.parse(output.output[0]).changes[0].after.size_px, 56);
  assert.deepEqual(JSON.parse(output.output[0]).changes[0].after, saved.captions[0].text_style);
  assert.equal(saved.captions[0].text_style.glow.color, '#00e5ff');
}));

test('CLI の書く直前に captions.json が変わると終了 1 で上書きしない', async () => fixture({}, async (dir, path) => {
  const output = io();
  const code = await runCli([dir, 'subtitle-news', '--caption', '0'], output, {
    beforeWrite: async () => writeFile(path, '別の操作'),
  });
  assert.equal(code, 1);
  assert.match(output.errors.join(' '), /ほかの変更/);
  assert.equal(await readFile(path, 'utf8'), '別の操作');
}));
