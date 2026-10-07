import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { computeDockHeight, nextDockStateOnDoubleClick } = require('../lib/common/right-dock-layout.js');

test('off の右パネルは SplitPanel を作る前に素のコンテナを返す', () => {
    const source = readFileSync(new URL('../src/browser/akari-right-panel-handler.ts', import.meta.url), 'utf8');
    const create = source.slice(source.indexOf('protected override createContainer(): Panel {'),
        source.indexOf('// ───────────────────────── dock'));
    assert.match(create, /const container = super\.createContainer\(\)/);
    assert.match(create, /localStorage\.getItem\('akari\.vibePreview\.enabled'\) !== '1'/);
    assert.ok(create.indexOf('return container;') < create.indexOf('new SplitPanel('));
    assert.ok(create.indexOf('return container;') < create.indexOf('vibeDockSlot.connect('));
});

test('縦の sash のダブルクリックは拡大を往復し、付け直しと破棄で listener を外す', () => {
    assert.equal(nextDockStateOnDoubleClick('open'), 'expanded');
    assert.equal(nextDockStateOnDoubleClick('expanded'), 'open');
    const slot = readFileSync(new URL('../src/browser/right-panel-dock-slot.ts', import.meta.url), 'utf8');
    const widget = readFileSync(new URL('../../akari-vibe-dock/src/browser/vibe-dock-widget.tsx', import.meta.url), 'utf8');
    assert.match(slot, /this\.handle = split\.handles\[0\]/);
    assert.match(slot, /this\.handle\?\.addEventListener\('dblclick', this\.onHandleDoubleClick\)/);
    assert.equal((slot.match(/this\.handle\?\.removeEventListener\('dblclick', this\.onHandleDoubleClick\)/g) ?? []).length, 2);
    assert.match(widget, /onDidDoubleClickHandle\(next => state\.setLayout\(next\)\)/);
    assert.match(widget, /onDoubleClick: \(\) => this\.state\.setLayout\(/);
});

test('区画の高さは上の領域を残して計算する', () => {
    const cases = [
        [700, 'closed', undefined, 56],
        [700, 'open', undefined, 233],
        [700, 'expanded', undefined, 467],
        [640, 'open', undefined, 213],
        [640, 'expanded', undefined, 427],
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
    assert.equal(computeDockHeight({ panelHeight: 1200, state: 'open' }).height, 400);
    assert.equal(computeDockHeight({ panelHeight: 1200, state: 'expanded' }).height, 800);
});
