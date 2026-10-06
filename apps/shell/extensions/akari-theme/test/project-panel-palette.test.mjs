import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DARK, LIGHT } from '../lib/browser/akari-theme-tokens.js';

test('両テーマにプロジェクト面の同じ4役を用意する', () => {
    const roles = ['panelProject', 'panelProjectItem', 'panelProjectElevated', 'panelProjectLine'];
    assert.deepEqual(roles.map(role => DARK[role]), ['#161616', '#202020', '#2a2a2a', '#2c2c2c']);
    assert.deepEqual(roles.map(role => LIGHT[role]), ['#f1f1f1', '#e4e4e4', '#d8d8d8', '#d2d2d2']);
    const source = readFileSync(new URL('../src/browser/akari-css-variable-force-contribution.ts', import.meta.url), 'utf8');
    for (const [name, role] of [
        ['panel-project', 'panelProject'],
        ['panel-project-item', 'panelProjectItem'],
        ['panel-project-elevated', 'panelProjectElevated'],
        ['panel-project-line', 'panelProjectLine']
    ]) {
        assert.match(source, new RegExp(`root\\.setProperty\\('--akari-${name}', palette\\.${role}\\)`));
    }
});
