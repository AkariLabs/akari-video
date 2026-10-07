import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DARK, LIGHT } from '../lib/browser/akari-theme-tokens.js';

test('明かりの三状態は両テーマで異なる色を持つ', () => {
    for (const palette of [DARK, LIGHT]) {
        const actual = ['vibeIdle', 'vibeListening', 'vibeActing'].map(key => palette[key]);
        assert.ok(actual.every(color => /^#[0-9a-f]{6}$/i.test(color)));
        assert.equal(new Set(actual).size, 3);
    }
    const source = readFileSync(new URL('../src/browser/akari-css-variable-force-contribution.ts', import.meta.url), 'utf8');
    for (const [name, token] of [['idle', 'vibeIdle'], ['listening', 'vibeListening'], ['acting', 'vibeActing']]) {
        assert.ok(source.includes(`root.setProperty('--akari-vibe-${name}', palette.${token})`));
    }
});
