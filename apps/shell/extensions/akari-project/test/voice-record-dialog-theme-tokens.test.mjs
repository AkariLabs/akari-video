import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const style = readFileSync(new URL('../src/browser/voice-recording/voice-record-dialog-style.ts', import.meta.url), 'utf8');

test('voice recording dialog has no fixed dark surfaces or borders', () => {
    assert.doesNotMatch(style, /#(?:[1-4][0-9a-f]{5}|333|444)\b/iu);
});

test('voice recording dialog uses theme lines and supporting text colors', () => {
    assert.match(style, /\.voice-popup\s*\{[^}]*border:1px solid var\(--akari-line\)/u);
    assert.match(style, /\.voice-script\s*\{[^}]*border:1px solid var\(--akari-line\)/u);
    assert.match(style, /\.voice-options\s*\{[^}]*border-top:1px solid var\(--akari-line-inner\)/u);
    assert.match(style, /\.voice-hint\s*\{[^}]*color:var\(--akari-faint\)/u);
});

test('voice card retains its themed border, radius and surface', () => {
    const card = style.match(/\.voice-card\s*\{([^}]*)\}/u)?.[1];
    assert.ok(card);
    assert.match(card, /\bborder:1px solid var\(--akari-line\);/u);
    assert.match(card, /\bborder-radius:11px;/u);
    assert.match(card, /\bbackground:var\(--akari-bg\);/u);
});
