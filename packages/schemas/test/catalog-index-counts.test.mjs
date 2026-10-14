import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const catalog = resolve(dirname(fileURLToPath(import.meta.url)), '../../../catalog');
const categories = ['scene3d', 'overlay', 'audio', 'broll', 'font', 'avatars'];
const indexedCategories = ['audio', 'font', 'scene3d', 'broll'];
const read = (path) => readFileSync(path, 'utf8');
const folders = (path) => existsSync(path)
  ? readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];
const idsFor = (category) => folders(join(catalog, category)).filter((id) =>
  category === 'avatars' || existsSync(join(catalog, category, id, 'meta.json')));
const linksIn = (source) => [...source.matchAll(/\[([^\]]+)\]\(\.\/([^/()]+)\/meta\.json\)/g)].map((match) => {
  assert.equal(match[1], match[2], `link label/path mismatch: ${match[1]} / ${match[2]}`);
  return match[2];
});
const difference = (left, right) => left.filter((id) => !right.includes(id)).sort();

test('catalog counts and category indexes match registered entries', () => {
  const rootIndex = read(join(catalog, 'INDEX.md'));
  const actual = Object.fromEntries(categories.map((category) => [category, idsFor(category)]));
  const total = Object.values(actual).reduce((sum, ids) => sum + ids.length, 0);
  const totalMatches = [...rootIndex.matchAll(/計\s+(\d+)\s+件収録/g)];
  assert.equal(totalMatches.length, 1, `catalog total count lines: ${totalMatches.length}`);
  assert.equal(Number(totalMatches[0][1]), total, `catalog total: index ${totalMatches[0][1]}, actual ${total}`);

  for (const category of categories) {
    const lines = rootIndex.split('\n').filter((line) =>
      line.startsWith(`- [${category}](`) || line.startsWith(`- **${category}**`));
    assert.equal(lines.length, 1, `${category}: index lines ${lines.length}`);
    const counts = [...lines[0].matchAll(/(\d+)\s+件収録/g)];
    assert.equal(counts.length, 1, `${category}: count mentions ${counts.length}`);
    assert.equal(Number(counts[0][1]), actual[category].length,
      `${category}: index ${counts[0][1]}, actual ${actual[category].length}`);
  }

  for (const category of indexedCategories) {
    const index = read(join(catalog, category, 'INDEX.md'));
    const links = linksIn(index);
    const duplicates = links.filter((id, position) => links.indexOf(id) !== position);
    assert.deepEqual([...new Set(duplicates)].sort(), [], `${category}: duplicate IDs ${duplicates.join(', ')}`);
    assert.deepEqual(difference(actual[category], links), [],
      `${category}: missing IDs ${difference(actual[category], links).join(', ')}`);
    assert.deepEqual(difference(links, actual[category]), [],
      `${category}: extra IDs ${difference(links, actual[category]).join(', ')}`);
  }

  const audioIndex = read(join(catalog, 'audio', 'INDEX.md'));
  let inLegacy = false;
  const legacyIds = [];
  for (const line of audioIndex.split('\n')) {
    if (/^#{2,6}\s/.test(line)) inLegacy = /レガシー/.test(line);
    if (inLegacy) legacyIds.push(...linksIn(line));
  }
  for (const id of legacyIds) {
    const meta = JSON.parse(read(join(catalog, 'audio', id, 'meta.json')));
    assert.equal((meta.tags ?? []).some((tag) => tag.startsWith('pack:')), false,
      `audio legacy ID has pack tag: ${id}`);
  }

  assert.equal(rootIndex.includes('LicenseRef-AKARI-'), false,
    'catalog/INDEX.md contains LicenseRef-AKARI-');
});
