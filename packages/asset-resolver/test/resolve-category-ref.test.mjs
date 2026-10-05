import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AssetResolverError, findCatalogItem, resolve } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('同名 id は category/id で別々に取得し、bare id は曖昧さを報告する', async t => {
  const { env, root, home, baseDir, catalog, catalogPath } = setupFixtureEnv();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = 'same-name';
  for (const category of ['overlay', 'textstyle']) {
    const fileDir = path.join(baseDir, category, id, 'v1');
    mkdirSync(fileDir, { recursive: true });
    writeFileSync(path.join(fileDir, 'payload.txt'), category);
    catalog.items.push({
      id,
      category,
      title: `同名素材 ${category}`,
      tier: 'free',
      files: [{ name: 'payload.txt', key: `${category}/${id}/v1/payload.txt` }],
    });
  }
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  for (const category of ['textstyle', 'overlay']) {
    const result = await resolve(`${category}/${id}`, { env });
    assert.equal(result.id, id);
    assert.equal(result.category, category);
    assert.equal(result.dir, path.join(home, 'assets', category, id));
    assert.equal(readFileSync(path.join(result.dir, 'payload.txt'), 'utf8'), category);
  }

  await assert.rejects(
    () => resolve(id, { env }),
    error => error instanceof AssetResolverError
      && error.code === 'ambiguous_id'
      && error.candidates?.includes(`overlay/${id}`)
      && error.candidates?.includes(`textstyle/${id}`)
      && error.message.includes(`overlay/${id}`)
      && error.message.includes(`textstyle/${id}`),
  );
  assert.equal(findCatalogItem(catalog, 'still/mini-still').id, 'mini-still');
  assert.throws(
    () => findCatalogItem(catalog, `still/${id}`),
    error => error instanceof AssetResolverError && error.code === 'not_found',
  );

  const unique = await resolve('mini-still', { env });
  assert.equal(unique.dir, path.join(home, 'assets', 'still', 'mini-still'));
  assert.ok(existsSync(path.join(unique.dir, 'meta.json')));
});
