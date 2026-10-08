import test from 'node:test';
import assert from 'node:assert/strict';
import { DARK, LIGHT } from '../lib/browser/akari-theme-tokens.js';
import { readFileSync } from 'node:fs';

test('場所ごとの地と帯の色が両テーマにある', () => {
    const keys = ['groundChannel', 'groundProject', 'barChannel', 'barProject'];
    assert.deepEqual(keys.map(key => DARK[key]), ['#0b1222', '#1a0f08', '#0d1424', '#140c07']);
    assert.deepEqual(keys.map(key => LIGHT[key]), ['#e3e8f1', '#efe9e3', '#f4f6fb', '#fbf8f5']);
    const source = readFileSync(new URL('../src/browser/akari-scope-ground.ts', import.meta.url), 'utf8');
    assert.match(source, /\['channel', 'project'\]/);
    assert.match(source, /data-akari-scope/);
});
