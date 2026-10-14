import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyCaptionRunsToHtml } from '../lib/caption-runs.js';

const text = 'ABCDEFG';
const plate = { color: '#ffd948', opacity: 1, padding_px: 4, radius_px: 2 };
const ranges = [];
for (let from = 0; from < text.length; from++)
  for (let to = from + 1; to <= text.length; to++) ranges.push([from, to]);

const line = layout => {
  let offset = 0;
  const tokens = layout.map(size => {
    const word = text.slice(offset, offset += size);
    return `<span class="akari-caption__tok">${word}</span>`;
  }).join('');
  return `<div class="akari-caption"><style></style><div class="akari-caption__plate"><p class="akari-caption__line">${tokens}</p></div></div>`;
};

const inspect = html => {
  const body = html.replace(/<style>[\s\S]*?<\/style>/gu, '');
  const stack = [];
  const membership = [];
  let tokenCount = 0;
  let nested = true;
  for (const match of body.matchAll(/<(\/)?(\w+)([^>]*)>|([^<]+)/gu)) {
    if (match[4] !== undefined) {
      const token = [...stack].reverse().find(item => item.token !== undefined)?.token ?? -1;
      for (const _char of match[4]) membership.push(token);
    } else if (match[1]) {
      if (stack.pop()?.tag !== match[2]) nested = false;
    } else {
      const cls = /class="([^"]*)"/u.exec(match[3])?.[1] ?? '';
      stack.push({ tag: match[2], token: /\bakari-caption__tok\b/u.test(cls) ? tokenCount++ : undefined });
    }
  }
  return { body, membership, tokenCount, nested: nested && stack.length === 0 };
};

const run = ([from, to], index) => ({ from, to,
  style: { color: index ? '#ffffff' : '#202020' }, resolved_look: { plate } });
const comparable = (html, rich) => rich
  ? html.replaceAll('box-decoration-break:clone;pointer-events:none', 'box-decoration-break:clone') : html;

const unchanged = {
  '2-1-3-1': {
    mask: '//////////////9/zv3/59z//////////////////7//z/3z/9w//v//w///////////3/////3/////////////////////////////////////3/f+/////9/3/v////8=',
    singleHashes: [
      'e03a228c153a2e609ddbbc4386784161b8f3e3f100cbe3531db605f2f1c70dd0',
      '7bc924d18e7a96ed55ead82fe15d7dd6d39668ef5e5a9c101efe1d65e4676dc8',
    ],
    hashes: [
      '47af3e3c1baf164b4c72372e9fb3bf80b838bdbf90d0b5473ef208d1a6d05649',
      '58c886c8a2bc9a9bc702397958a434f76d5766e931130c1926ec591f5d7b7b6d',
    ],
  },
  '3-4': { singleHashes: [
    'fe456ee942259c91a7812c94a40eed6e45d7ec4890bbe0e63027151fbeedd9b2',
    'b644b51fdaae5641ab1a5a8db6df84f795385e13c999c5dcfd05fc3c2b9cdfc2',
  ], hashes: [
    'cd73e3c557dc9b2460659c1f1223a606ee6b4bf1540431af934ab1a239488722',
    '2d879bb630c9bcf6b64a8368c84d634bc6929b6874516eb4eb295eba9cc8bcb4',
  ] },
};

test('overlapping plate fragments retain each character in its original token', () => {
  for (const layout of [[2, 1, 3, 1], [3, 4]]) for (const [mode, rich] of [false, true].entries()) {
    const source = line(layout);
    const original = inspect(source);
    const key = layout.join('-');
    const mask = unchanged[key].mask && Buffer.from(unchanged[key].mask, 'base64');
    const hash = createHash('sha256');
    const singleHash = createHash('sha256');
    for (const range of ranges) {
      const html = applyCaptionRunsToHtml(source, text, [run(range, 0)], false, rich);
      singleHash.update(comparable(html, rich)).update('\0');
    }
    assert.equal(singleHash.digest('hex'), unchanged[key].singleHashes[mode],
      `${key} rich=${rich} one range`);
    let caseIndex = 0;
    for (const first of ranges) for (const second of ranges) {
      const html = applyCaptionRunsToHtml(source, text, [run(first, 0), run(second, 1)], false, rich);
      const result = inspect(html);
      const label = `${key} rich=${rich} ${first} ${second}`;
      assert.equal(result.nested, true, label);
      assert.equal(result.body.replace(/<[^>]+>/gu, ''), text, label);
      assert.equal(result.tokenCount, original.tokenCount, label);
      assert.deepEqual(result.membership, original.membership, label);
      if (!mask || mask[caseIndex >> 3] & (1 << (caseIndex & 7))) hash.update(
        comparable(html, rich)).update('\0');
      caseIndex++;
    }
    if (!rich) assert.equal(hash.digest('hex'), unchanged[key].hashes[mode],
      `${key} rich=${rich} unchanged cases`);
  }
});

test('three overlapping plate ranges keep token membership in both drawing forms', () => {
  const source = line([2, 1, 3, 1]);
  const original = inspect(source);
  for (const rich of [false, true]) for (const ranges of [
    [[0, 4], [2, 6], [3, 7]],
    [[1, 6], [0, 5], [3, 7]],
    [[3, 7], [1, 5], [2, 6]],
    [[0, 7], [2, 5], [1, 6]],
  ]) {
    const html = applyCaptionRunsToHtml(source, text, ranges.map(run), false, rich);
    const result = inspect(html);
    assert.equal(result.nested, true, `${rich} ${ranges}`);
    assert.equal(result.body.replace(/<[^>]+>/gu, ''), text);
    assert.equal(result.tokenCount, original.tokenCount);
    assert.deepEqual(result.membership, original.membership, `${rich} ${ranges}`);
  }
});
