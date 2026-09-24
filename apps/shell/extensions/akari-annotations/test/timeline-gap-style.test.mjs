import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const widget = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const css = widget.slice(widget.indexOf('style.textContent = `') + 'style.textContent = `'.length,
  widget.indexOf('`;', widget.indexOf('style.textContent = `')));
// Read the real source rules, including the later generic resets. Restrict this small
// cascade evaluator to the ancestor/button selectors that can match a gap button.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match, order) =>
  match[1].split(',').flatMap(raw => {
    const selector = raw.trim();
    const parsed = /^\.akari-inspector-widget( \.akari-inspector-generation-gap)? button(:not\(\.akari-inspector-ai-tile\))?((?::[\w-]+)*)$/.exec(selector);
    if (!parsed) return [];
    const states = parsed[3].split(':').filter(Boolean);
    return [{ selector, order, states, gap: !!parsed[1], specificity: 1 + Number(!!parsed[1]) + Number(!!parsed[2]) + states.length,
      declarations: Object.fromEntries(match[2].trim().split(';').filter(Boolean).map(declaration => {
        const colon = declaration.indexOf(':');
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      })) }];
  }));

for (const states of [[], ['hover'], ['active'], ['focus-visible'], ['disabled'], ['disabled', 'hover'], ['disabled', 'active']]) {
  test(`gap button paint wins over later generic button resets: ${states.join(':') || 'normal'}`, () => {
    const gapBase = rules.find(rule => rule.gap && rule.states.length === 0);
    const genericBase = rules.find(rule => !rule.gap && rule.states.length === 0);
    assert.ok(gapBase && genericBase);
    assert.ok(gapBase.order < genericBase.order, 'exercise the reported later-reset regression');
    assert.ok(gapBase.specificity > genericBase.specificity);
    const winners = {};
    for (const rule of rules.filter(rule => rule.states.every(state => states.includes(state)))
      .sort((a, b) => a.specificity - b.specificity || a.order - b.order)) {
      for (const [property, value] of Object.entries(rule.declarations)) winners[property] = { rule, value };
    }
    assert.equal(winners.background.value, 'var(--akari-accent)');
    assert.equal(winners.border.value, '1px solid var(--akari-accent)');
    assert.equal(winners.color.value, 'var(--akari-bg)');
    for (const property of ['background', 'border', 'color']) assert.ok(winners[property].rule.gap);
    if (states.includes('disabled')) {
      assert.equal(winners.opacity.value, '.6'); assert.equal(winners.cursor.value, 'wait');
    }
  });
}
