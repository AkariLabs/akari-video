import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { filterListItems } from '../src/list-filter.mjs';

const rows = [
  { category: 'overlay', id: 'blue-card', title: 'Blue Card', tags: ['sticker', 'blue'], sourceKind: 'lab' },
  { category: 'overlay', id: 'red-card', title: '赤いカード', tags: ['sticker', 'red'], sourceKind: 'lab' },
  { category: 'audio', id: 'tap', title: 'Tap', tags: ['blue', 'sound'], sourceKind: 'site' },
];

test('list filters tags with exact AND matching', () => {
  assert.deepEqual(filterListItems(rows, { tags: ['sticker'] }).map(item => item.id), ['blue-card', 'red-card']);
  assert.deepEqual(filterListItems(rows, { tags: ['sticker', 'blue'] }).map(item => item.id), ['blue-card']);
  assert.deepEqual(filterListItems(rows, { tags: ['stick'] }), []);
});

test('list query matches title, id, and tags without case', () => {
  for (const query of ['BLUE CARD', 'BLUE-CARD', 'STICKER']) {
    assert.deepEqual(filterListItems(rows, { query, category: 'overlay', source: 'lab' }).map(item => item.id),
      query === 'STICKER' ? ['blue-card', 'red-card'] : ['blue-card']);
  }
  assert.deepEqual(filterListItems(rows, { query: 'missing' }), []);
});

const cli = fileURLToPath(new URL('../bin/akari-assets.mjs', import.meta.url));
const cliSource = readFileSync(cli, 'utf8');
const validateArgs = new Function(`${cliSource.slice(cliSource.indexOf('function validateArgs('), cliSource.indexOf('const STATE_BADGE'))}\nreturn validateArgs;`)();
test('list CLI accepts repeated tags and rejects repeated or missing query values', () => {
  assert.doesNotThrow(() => validateArgs('list', ['--tag', 'sticker', '--tag', 'blue', '--query', 'CARD', '--json']));
  for (const args of [['--query', 'a', '--query', 'b'], ['--query'], ['--tag'], ['--tag', 'a', '--tag']]) {
    assert.throws(() => validateArgs('list', args), /重複したオプション|値が必要/);
  }
});

test('list human output keeps badge and origin columns and adds tier before title', async () => {
  const printed = [];
  const source = cliSource.slice(cliSource.indexOf('function flagValue('), cliSource.indexOf('// Validate the entire command'))
    + cliSource.slice(cliSource.indexOf('const STATE_BADGE'), cliSource.indexOf('async function cmdAdd('));
  const cmdList = new Function('filterListItems', 'composeState', 'console', `${source}\nreturn cmdList;`)(
    filterListItems,
    async () => ({ libraryRoots: { write: 'library' }, warnings: [], items: [
      { category: 'overlay', id: 'free-card', title: 'Free Card', sourceKind: 'lab', tier: 'free', state: 'available' },
      { category: 'overlay', id: 'pro-card', title: 'Pro Card', sourceKind: 'lab', tier: 'pro', state: 'locked' },
    ] }),
    { log: line => printed.push(line), error: line => printed.push(line) });
  await cmdList([], {});
  assert.deepEqual(printed, [
    '使える素材 2 件（ライブラリ: library）',
    '  ☁  overlay/free-card\tlab\t[overlay]\tfree\tFree Card',
    '  🔒 Pro  overlay/pro-card\tlab\t[overlay]\tpro\tPro Card',
  ]);
});
