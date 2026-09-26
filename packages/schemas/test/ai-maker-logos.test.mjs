import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const makers = JSON.parse(await readFile(new URL('../ai-makers.json', import.meta.url), 'utf8'));

test('official logo data is self-contained and dated', () => {
  for (const [id, maker] of Object.entries(makers)) {
    if (!maker.logo) continue;
    assert.match(maker.logo_source, /^https:\/\//, id);
    assert.match(maker.logo_fetched_at, /^2026-09-\d{2}$/, id);
    assert.match(maker.logo, /^data:image\/(?:png|svg\+xml);base64,/, id);
    const content = Buffer.from(maker.logo.split(',')[1], 'base64');
    if (maker.logo.startsWith('data:image/svg')) {
      const svg = content.toString();
      assert.doesNotMatch(svg, /<script\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)|url\(\s*["']?(?:https?:|\/\/|data:)/iu, id);
    } else assert.equal(content.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', id);
  }
});

test('unavailable logos retain the initials and brand color fallback', () => {
  for (const id of ['qwen', 'bytedance', 'resemble', 'irodori', 'local']) {
    assert.equal(makers[id].logo, undefined, id);
    assert.ok(makers[id].initials);
    assert.match(makers[id].background, /^#[\da-f]{6}$/iu);
  }
});
