import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
const script = source.split('const ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT = `')[1].split('`;')[0];

test('図形一個の params だけ変わると他のオーバーレイ DOM と選択枠を保つ', () => {
    const first = { overlays: [
        { id: 'shape', html: '<svg><rect fill="#112233"/></svg>', htmlPath: 'edit.json' },
        { id: 'other', html: '<svg><circle fill="#00ff00"/></svg>', htmlPath: 'edit.json' }
    ] };
    const other = { id: 'other-node', hasAttribute: () => true };
    const selection = { id: 'selection-frame', hasAttribute: () => false };
    const stage = { children: [other, selection], append() {} };
    const calls = [];
    const runtime = {
        mount() { calls.push('mount'); },
        replaceShapeHtml(id, html) { calls.push(['replace', id, html]); return true; },
        tick() {}
    };
    const state = { summary: first };
    vm.runInNewContext(script, { window: { akari: { runtime, state } },
        document: { getElementById: () => stage, querySelectorAll: () => [] }, console });
    runtime.mount(first);
    state.summary = { overlays: [
        { ...first.overlays[0], html: '<svg><rect fill="#abcdef"/></svg>' }, first.overlays[1]
    ] };
    runtime.tick(1, false);
    assert.deepEqual(calls, ['mount', ['replace', 'shape', '<svg><rect fill="#abcdef"/></svg>']]);
    assert.equal(stage.children[0], other);
    assert.equal(stage.children[1], selection);
});

test('図形の追加と SVG 構造変更は全体のマウントへ戻す', async () => {
    const stage = { children: [], append() {} };
    const calls = [];
    const runtime = { mount() { calls.push('mount'); },
        replaceShapeHtml() { calls.push('replace'); return true; }, tick() {} };
    const first = { overlays: [{ id: 'shape', html: '<svg><rect fill="#112233"/></svg>' }] };
    const state = { summary: first };
    vm.runInNewContext(script, { window: { akari: { runtime, state } },
        document: { getElementById: () => stage, querySelectorAll: () => [] }, console });
    runtime.mount(first);
    state.summary = { overlays: [{ id: 'shape', html: '<svg><circle fill="#112233"/></svg>' }] };
    runtime.tick(1, false);
    await new Promise(resolve => setImmediate(resolve));
    state.summary = { overlays: [...state.summary.overlays, { id: 'new', html: '<svg></svg>' }] };
    runtime.tick(2, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['mount', 'mount', 'mount']);
});
