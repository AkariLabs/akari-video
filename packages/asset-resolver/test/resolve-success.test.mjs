import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('resolve: 未取得 → sha256/validate-asset 緑で登録される', async () => {
  const { env, home } = setupFixtureEnv();

  const result = await resolveAsset('mini-still', { env });
  assert.equal(result.cached, false);
  assert.equal(result.category, 'still');
  assert.equal(result.dir, path.join(home, 'assets', 'still', 'mini-still'));
  assert.ok(existsSync(path.join(result.dir, 'meta.json')));
  assert.ok(existsSync(path.join(result.dir, 'fragment.html')));
  assert.ok(existsSync(path.join(result.dir, 'preview.png')));

  const meta = JSON.parse(readFileSync(path.join(result.dir, 'meta.json'), 'utf8'));
  assert.equal(meta.id, 'mini-still');
  assert.equal(meta.category, 'still');

  // 一時ディレクトリが残っていない（rename で消費済み）
  const { readdirSync } = await import('node:fs');
  const stray = readdirSync(home).filter((name) => name.startsWith('.tmp-resolve-'));
  assert.deepEqual(stray, []);
});

test('resolve: 2 回目はキャッシュヒット（配信元ファイルを消しても成功する）', async () => {
  const { env, home, baseDir } = setupFixtureEnv();

  const first = await resolveAsset('mini-still', { env });
  assert.equal(first.cached, false);

  // 配信元を消して、2 回目が本当にネットワーク/コピーへ行かずキャッシュを使うことを確認
  rmSync(baseDir, { recursive: true, force: true });

  const second = await resolveAsset('mini-still', { env });
  assert.equal(second.cached, true);
  assert.equal(second.dir, path.join(home, 'assets', 'still', 'mini-still'));
  assert.ok(existsSync(path.join(second.dir, 'meta.json')));
});

test('resolve: --project 相当（project オプション）でプロジェクト側にもコピーされる', async () => {
  const { env, root } = setupFixtureEnv();
  const projectDir = path.join(root, 'project');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(projectDir, { recursive: true });

  const result = await resolveAsset('mini-still', { env, project: projectDir });
  assert.ok(result.projectDir);
  // ライブラリ（~/.akari/assets/<category>/<id>/）と同型に統一（2026-08-04 決定）
  assert.equal(result.projectDir, path.join(projectDir, 'assets', 'still', 'mini-still'));
  assert.ok(existsSync(path.join(result.projectDir, 'meta.json')));
});

test('resolve preserves translated metadata in the library and project copy', async () => {
  const { env, root, baseDir, catalog, catalogPath } = setupFixtureEnv();
  const { createHash } = await import('node:crypto');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const sourceMeta = path.join(baseDir, 'still', 'mini-still', 'v1', 'meta.json');
  const meta = JSON.parse(readFileSync(sourceMeta, 'utf8'));
  meta.i18n = { en: { title: 'Small still', knobs: {} } };
  const bytes = Buffer.from(JSON.stringify(meta));
  writeFileSync(sourceMeta, bytes);
  catalog.items[0].i18n = { en: { title: 'Small still' } };
  const descriptor = catalog.items[0].files.find(file => file.name === 'meta.json');
  descriptor.bytes = bytes.length;
  descriptor.sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(catalogPath, JSON.stringify(catalog));
  const project = path.join(root, 'project');
  mkdirSync(project);
  const result = await resolveAsset('mini-still', { env, project });
  for (const dir of [result.dir, result.projectDir]) {
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')).i18n, meta.i18n);
  }
});
