// 右レールの状態の純ロジック（src/browser/right-rail-state.ts）を、試作
// （内部リポ planning/notes-2026-09-22-right-rail-prototype.html 2 版）の drop(k, where) / クリック / × / 境目の
// 規則どおりに動くか表駆動で確かめる（task 2026-09-22-right-rail-regroup）。Theia / Lumino は使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../lib/browser/right-rail-state.js');

const DAIHON = 'akari-daihon-widget';
const CUTS = 'akari-cuts-widget';
const NOTE = 'akari-review-panel-widget';
const INSP = 'akari-inspector-widget';
const METER = 'akari-audio-meter-widget';
const PARTNER = 'akari-partner-onboarding';
const CLAUDE = 'terminal-0';
const RAIL = [CLAUDE, PARTNER, DAIHON, CUTS, NOTE, INSP, METER];

const fresh = () => S.defaultRightRailState();

test('default: one pane, default groups, no displaced panels', () => {
    const state = fresh();
    assert.deepEqual(state, { version: 1, groups: {}, split: false, top: null, bottom: null, focus: 'top', ratio: 0.5, displaced: {} });
    assert.equal(S.rightRailGroupOf(state, CLAUDE), 'agent');
    assert.equal(S.rightRailGroupOf(state, PARTNER), 'agent');
    for (const id of [DAIHON, CUTS, NOTE, INSP, METER]) {
        assert.equal(S.rightRailGroupOf(state, id), 'lower', id);
    }
});

test('readRightRailState: valid data round-trips', () => {
    const saved = { version: 1, groups: { [NOTE]: 'agent' }, split: true, top: NOTE, bottom: INSP, focus: 'bottom', ratio: 0.3, displaced: { [CUTS]: 'main' } };
    assert.deepEqual(S.readRightRailState(JSON.parse(JSON.stringify(saved))), saved);
    const single = { ...fresh(), groups: { [CLAUDE]: 'lower' }, displaced: { [METER]: 'bottom' } };
    assert.deepEqual(S.readRightRailState(single), single);
});

test('readRightRailState: missing or broken data falls back to the whole default (1 pane, default groups)', () => {
    const base = { version: 1, groups: {}, split: true, top: CLAUDE, bottom: INSP, focus: 'top', ratio: 0.4, displaced: {} };
    const broken = [
        undefined, null, 'split', 42, [], {},
        { ...base, version: 2 },
        { ...base, groups: [] },
        { ...base, groups: { [NOTE]: 'middle' } },
        { ...base, displaced: { [CUTS]: 'left' } },
        { ...base, split: 'yes' },
        { ...base, ratio: 'NaN' },
        { ...base, ratio: Number.NaN },
        { ...base, ratio: 0.01 },
        { ...base, ratio: 0.99 },
        { ...base, focus: 'middle' },
        { ...base, top: null },
        { ...base, top: INSP, bottom: INSP },
        { ...base, split: false },
        { ...base, groups: null }
    ];
    for (const raw of broken) {
        assert.deepEqual(S.readRightRailState(raw), fresh(), JSON.stringify(raw));
    }
});

test('setRightRailGroup stores only differences from the default', () => {
    const state = fresh();
    S.setRightRailGroup(state, NOTE, 'agent');
    S.setRightRailGroup(state, CLAUDE, 'agent');
    assert.deepEqual(state.groups, { [NOTE]: 'agent' });
    S.setRightRailGroup(state, NOTE, 'lower');
    assert.deepEqual(state.groups, {});
});

test('drop on main / bottom: becomes a tab there and leaves the rail; back to the rail restores it', () => {
    const state = fresh();
    let result = S.dropOnRightRail(state, CUTS, 'main', { railIds: RAIL, current: CUTS });
    assert.deepEqual(result, { current: CLAUDE, moveTo: 'main' }, 'the shown panel moves out → the next rail panel is shown');
    assert.deepEqual(state.displaced, { [CUTS]: 'main' });
    const railAfter = RAIL.filter(id => id !== CUTS);
    result = S.dropOnRightRail(state, CUTS, 'railbottom', { railIds: railAfter, current: CLAUDE });
    assert.deepEqual(result, { moveTo: 'right' });
    assert.deepEqual(state, fresh());
    result = S.dropOnRightRail(state, METER, 'bottom', { railIds: RAIL, current: CLAUDE });
    assert.deepEqual(result, { moveTo: 'bottom' }, 'not shown → the shown panel stays');
    assert.deepEqual(state.displaced, { [METER]: 'bottom' });
});

test('drop on the rail above / below the line swaps membership (the prototype "注釈を線の上へ")', () => {
    const state = fresh();
    const result = S.dropOnRightRail(state, NOTE, 'railtop', { railIds: RAIL, current: CLAUDE });
    assert.deepEqual(result, {});
    assert.equal(S.rightRailGroupOf(state, NOTE), 'agent');
    assert.equal(state.split, false);
    S.dropOnRightRail(state, NOTE, 'railbottom', { railIds: RAIL, current: CLAUDE });
    assert.deepEqual(state.groups, {});
});

test('drop on the right lower half splits only then (prototype: インスペクターを右の下半分へ)', () => {
    const state = fresh();
    const result = S.dropOnRightRail(state, INSP, 'rbottom', { railIds: RAIL, current: CLAUDE });
    assert.deepEqual(result, { current: INSP });
    assert.equal(state.split, true);
    assert.equal(state.top, CLAUDE);
    assert.equal(state.bottom, INSP);
    assert.equal(state.focus, 'bottom');
    assert.deepEqual(state.groups, {});
});

test('split drop keeps the "区切り線どおり" invariant: the partner pane is flipped to the other side when needed', () => {
    const state = fresh();
    // 1 面で台本（線の下）が出ているところへインスペクターを下の段に → 台本は上の段・所属も上へ。
    S.dropOnRightRail(state, INSP, 'rbottom', { railIds: RAIL, current: DAIHON });
    assert.equal(state.top, DAIHON);
    assert.equal(state.bottom, INSP);
    assert.equal(S.rightRailGroupOf(state, DAIHON), 'agent');
    // 置いたものを上の段へ置けば、置いたもの自体の所属が上になる。
    const other = fresh();
    S.dropOnRightRail(other, CUTS, 'rtop', { railIds: RAIL, current: CUTS });
    assert.equal(other.top, CUTS);
    assert.equal(S.rightRailGroupOf(other, CUTS), 'agent');
    assert.equal(other.bottom, DAIHON, 'the first rail panel of the other membership');
    assert.equal(S.rightRailGroupOf(other, DAIHON), 'lower');
});

test('split drop from main brings the panel back to the right', () => {
    const state = fresh();
    state.displaced[CUTS] = 'main';
    const railIds = RAIL.filter(id => id !== CUTS);
    const result = S.dropOnRightRail(state, CUTS, 'rbottom', { railIds, current: CLAUDE });
    assert.deepEqual(result, { moveTo: 'right', current: CUTS });
    assert.deepEqual(state.displaced, {});
    assert.equal(state.top, CLAUDE);
    assert.equal(state.bottom, CUTS);
});

test('split drop with nothing else in the right shows the dropped panel alone', () => {
    const state = fresh();
    const result = S.dropOnRightRail(state, INSP, 'rbottom', { railIds: [INSP], current: INSP });
    assert.deepEqual(result, { current: INSP });
    assert.equal(state.split, false);
});

test('split: clicking an icon above the line changes the top pane, below the line the bottom pane', () => {
    const state = fresh();
    S.dropOnRightRail(state, INSP, 'rbottom', { railIds: RAIL, current: CLAUDE });
    assert.equal(S.clickRightRail(state, METER), 'bottom');
    assert.deepEqual([state.top, state.bottom, state.focus], [CLAUDE, METER, 'bottom']);
    assert.equal(S.clickRightRail(state, PARTNER), 'top');
    assert.deepEqual([state.top, state.bottom, state.focus], [PARTNER, METER, 'top']);
    // 出ているものを押す → その段へフォーカスを移すだけ。
    assert.equal(S.clickRightRail(state, METER), 'bottom');
    assert.deepEqual([state.top, state.bottom, state.focus], [PARTNER, METER, 'bottom']);
    assert.equal(S.clickRightRail(fresh(), METER), undefined, 'single pane → Theia default');
});

test('back to one pane: × on a pane header, dragging that pane back to the rail, or the gutter to an edge — the panel stays in the rail', () => {
    const split = () => {
        const state = fresh();
        S.dropOnRightRail(state, INSP, 'rbottom', { railIds: RAIL, current: CLAUDE });
        return state;
    };
    let state = split();
    assert.equal(S.closeRightRailPane(state, 'bottom'), CLAUDE);
    assert.equal(state.split, false);
    state = split();
    assert.equal(S.closeRightRailPane(state, 'top'), INSP);
    state = split();
    const result = S.dropOnRightRail(state, INSP, 'railbottom', { railIds: RAIL, current: INSP });
    assert.deepEqual(result, { current: CLAUDE });
    assert.equal(state.split, false);
    state = split();
    assert.equal(S.settleRightRailRatio(state, 0.3), undefined);
    assert.equal(state.ratio, 0.3);
    assert.equal(state.split, true);
    assert.equal(S.settleRightRailRatio(state, 0.95), CLAUDE, 'pushed to the bottom edge → the bottom pane goes away');
    assert.equal(state.split, false);
    assert.equal(state.ratio, 0.5);
    state = split();
    assert.equal(S.settleRightRailRatio(state, 0.05), INSP, 'pushed to the top edge → the top pane goes away');
});

test('normalizeRightRail: a pane that left the right or broke the line rule returns to one pane', () => {
    const split = () => {
        const state = fresh();
        S.dropOnRightRail(state, INSP, 'rbottom', { railIds: RAIL, current: CLAUDE });
        return state;
    };
    let state = split();
    assert.equal(S.normalizeRightRail(state, RAIL), undefined);
    assert.equal(S.normalizeRightRail(state, RAIL.filter(id => id !== CLAUDE)), INSP);
    state = split();
    assert.equal(S.normalizeRightRail(state, RAIL.filter(id => id !== INSP)), CLAUDE);
    state = split();
    state.groups[INSP] = 'agent';
    assert.equal(S.normalizeRightRail(state, RAIL), CLAUDE);
    state = split();
    assert.equal(S.normalizeRightRail(state, []), null);
    assert.equal(S.normalizeRightRail(fresh(), RAIL), undefined);
});
