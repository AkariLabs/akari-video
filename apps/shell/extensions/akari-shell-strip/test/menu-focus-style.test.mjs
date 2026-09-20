import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/style/menu-focus-pulse.css', import.meta.url), 'utf8');

test('pulse uses the theme token for four 0.4 second cycles', () => {
    assert.match(source, /@keyframes akari-menu-focus-pulse/);
    assert.ok(source.includes('var(--akari-focus-pulse, var(--akari-accent, #f97316))'));
    assert.match(source, /animation: akari-menu-focus-pulse 0\.4s ease-in-out 4;/);
    assert.match(source, /box-shadow:/);
});

test('reduced motion uses a static outline', () => {
    assert.match(source, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.akari-menu-focus-pulse\s*\{\s*animation: none;\s*outline: 2px solid var\(--akari-focus-pulse, var\(--akari-accent, #f97316\)\);/);
});
