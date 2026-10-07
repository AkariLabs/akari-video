import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyIntoProject, withoutFragmentRootTiming as resolverTiming } from '../src/resolve.mjs';

const rootTag = html => html.match(/<div\b[^>]*>/)?.[0] ?? '';
const { version, cases } = JSON.parse(await readFile(new URL('./fixtures/fragment-root-timing.json', import.meta.url), 'utf8'));

test('resolver は通常・素材コピーの両モードで共通の入出力表に従う', () => {
  assert.equal(version, 1);
  for (const { name, source, plain, preserved } of cases) {
    for (const [options, expected] of [[undefined, plain], [{ preserveNaturalDuration: true }, preserved]]) {
      const actual = resolverTiming(source, options);
      assert.equal(actual, expected, name);
      assert.doesNotMatch(rootTag(actual), /\bdata-(?:start|duration)\s*=/);
    }
  }
});

for (const category of ['overlay', 'scene3d']) {
  test(`copyIntoProject は ${category} の fragment と variants だけを正規化する`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'fragment-project-copy-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const project = path.join(root, 'project');
    await mkdir(path.join(source, 'variants'), { recursive: true });
    await mkdir(project);
    await writeFile(path.join(source, 'fragment.html'), cases[0].source);
    await writeFile(path.join(source, 'variants', 'alternate.html'), cases[2].source);
    await writeFile(path.join(source, 'variants', 'note.txt'), 'data-start="0"');
    await writeFile(path.join(source, 'meta.json'), '{"id":"board"}\n');

    const dest = await copyIntoProject(source, project, category, 'board');
    for (const name of ['fragment.html', 'variants/alternate.html']) {
      const actual = await readFile(path.join(dest, name), 'utf8');
      assert.doesNotMatch(rootTag(actual), /\bdata-(?:start|duration)\s*=/);
      assert.match(rootTag(actual), /data-akari-natural-duration=/);
    }
    assert.equal(await readFile(path.join(source, 'fragment.html'), 'utf8'), cases[0].source);
    assert.equal(await readFile(path.join(dest, 'variants/note.txt'), 'utf8'), 'data-start="0"');
    assert.deepEqual((await readdir(dest)).sort(), ['fragment.html', 'meta.json', 'variants']);
  });
}
