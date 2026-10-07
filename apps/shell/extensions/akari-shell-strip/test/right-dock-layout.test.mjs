import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { computeDockHeight } = require('../lib/common/right-dock-layout.js');

test('off の右パネルは SplitPanel を作る前に素のコンテナを返す', () => {
    const source = readFileSync(new URL('../src/browser/akari-right-panel-handler.ts', import.meta.url), 'utf8');
    const create = source.slice(source.indexOf('protected override createContainer(): Panel {'),
        source.indexOf('// ───────────────────────── dock'));
    assert.match(create, /const container = super\.createContainer\(\)/);
    assert.match(create, /localStorage\.getItem\('akari\.vibePreview\.enabled'\) !== '1'/);
    assert.ok(create.indexOf('return container;') < create.indexOf('new SplitPanel('));
    assert.ok(create.indexOf('return container;') < create.indexOf('vibeDockSlot.connect('));
});

test('区画の高さは上の領域を残して計算する', () => {
    const cases = [
        [700, 'closed', undefined, 56],
        [700, 'open', undefined, 233],
        [700, 'expanded', undefined, 467],
        [640, 'open', undefined, 213],
        [530, 'open', undefined, 180],
        [400, 'open', undefined, 180],
        [400, 'expanded', undefined, 240],
        [700, 'open', 500, 500],
        [400, 'open', 500, 240],
        [700, 'open', 100, 180]
    ];
    for (const [panelHeight, state, userHeight, height] of cases) {
        const result = computeDockHeight({ panelHeight, state, userHeight });
        assert.equal(result.height, height, `${panelHeight} / ${state} / ${userHeight}`);
        assert.ok(panelHeight - result.height >= 160);
    }
    assert.deepEqual(computeDockHeight({ panelHeight: 200, state: 'expanded' }), {
        height: 56, state: 'closed', reason: 'too-small'
    });
});
