import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fragmentDurationSeconds, placedFragmentCopy, withoutFragmentRootTiming } from '../live/companion/library-insert.mjs';

const { version, cases } = JSON.parse(await readFile(new URL('./fixtures/fragment-root-timing.json', import.meta.url), 'utf8'));

test('vibe は通常・素材コピーの両モードで共通の入出力表に従う', () => {
  assert.equal(version, 1);
  for (const { name, source, plain, preserved } of cases) {
    assert.equal(withoutFragmentRootTiming(source), plain, name);
    assert.equal(withoutFragmentRootTiming(source, { preserveNaturalDuration: true }), preserved, name);
  }
});

test('placedFragmentCopy は原本を正規化し配置時刻ごとの写しを作らない', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'library-fragment-timing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'assets/overlay/board');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'fragment.html');
  await writeFile(file, '<div data-start="0" data-duration="8"><span>board</span></div>');
  const location = { rootFsPath: root, editPath: 'edit.json' };
  const assetPath = { files: ['assets/overlay/board/fragment.html'] };
  assert.equal(fragmentDurationSeconds(location, assetPath), 8);
  assert.equal(placedFragmentCopy(location, assetPath), assetPath.files[0]);
  assert.equal(fragmentDurationSeconds(location, assetPath), 8);
  const html = await readFile(file, 'utf8');
  assert.doesNotMatch(html.match(/<div[^>]*>/)[0], /\bdata-(?:start|duration)\s*=/);
  assert.match(html, /data-akari-natural-duration="8"/);
  assert.deepEqual(await readdir(directory), ['fragment.html']);
});

test('fragmentDurationSeconds は新属性を優先し旧属性も読む', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'library-fragment-duration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'assets/overlay/board');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'fragment.html');
  const location = { rootFsPath: root, editPath: 'edit.json' };
  const assetPath = { files: ['assets/overlay/board/fragment.html'] };
  await writeFile(file, '<style>.board{color:red}</style><div data-duration="6">board</div>');
  assert.equal(fragmentDurationSeconds(location, assetPath), 6);
  await writeFile(file, '<div data-duration="6" data-akari-natural-duration="9">board</div>');
  assert.equal(fragmentDurationSeconds(location, assetPath), 9);
});
