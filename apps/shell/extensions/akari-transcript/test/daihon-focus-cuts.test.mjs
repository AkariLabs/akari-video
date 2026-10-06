import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pulse = await readFile(new URL('../src/common/daihon-focus-pulse-style.ts', import.meta.url), 'utf8');

test('shared pulse uses theme variables and an outline without changing layout', () => {
  assert.match(pulse, /getElementById\('akari-daihon-focus-pulse-style'\)\) return/u);
  assert.match(pulse, /var\(--akari-focus-pulse, var\(--akari-accent, #f97316\)\)/u);
  assert.match(pulse, /outline: 2px solid/u);
  assert.match(pulse, /1\.6s ease-in-out/u);
  assert.match(pulse, /clearTimeout\(pulseTimers.get\(element\)\)/u);
  const css = pulse.match(/style\.textContent = `([\s\S]*?)`/u)[1];
  const themed = css.replace('var(--akari-accent, #f97316)', 'var(--akari-accent)');
  assert.doesNotMatch(themed, /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:border|padding|margin)(?:-[\w-]+)?\s*:/iu);
  const allowed = {
    outline: ['2px solid transparent', '2px solid var(--akari-focus-pulse, var(--akari-accent))'],
    'outline-offset': ['2px'],
    animation: ['akariDaihonFocusPulse 1.6s ease-in-out']
  };
  for (const [, property, value] of themed.matchAll(/([\w-]+):\s*([^;{}]+);/gu)) {
    assert.ok(allowed[property]?.includes(value), `Unexpected declaration: ${property}: ${value}`);
  }
});
