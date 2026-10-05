import assert from 'node:assert/strict';
import { findMember } from './helpers/role-buckets-source.mjs';
import test from 'node:test';
import ts from 'typescript';
import { presetApplyPayload } from '../lib/common/preset-showcase.js';

const names = ['runLibraryAction', 'libraryMenuTargetItem', 'applyPresetToSelectedCaption'];
const compiled = ts.transpileModule(`class Harness { ${names.map(name => findMember(name, { in: 'widget' }).text).join('\n')} }`,
{ compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('libraryMenuTargetKey', 'presetApplyPayload', `${compiled}\nreturn Harness;`)(
    target => target.key, presetApplyPayload);

function fixture(lutPresets = []) {
    const handler = new Harness(), calls = [], notices = [];
    handler.presetShowcase = { lut: lutPresets, textanim: [], textstyle: [] };
    handler.workflow = { workspaceRoot: { resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///project/edit.json' }) }) } };
    handler.commandService = { executeCommand: async (...args) => { calls.push(args); return true; } };
    handler.messages = { info: text => notices.push(text), warn: text => notices.push(text) };
    return { handler, calls, notices };
}

test('LUT の右クリックは棚一覧の再取得状態に依存せず、直接呼び出しと同じ payload を待って送る', async () => {
    for (const presets of [[], [{ kind: 'lut', id: 'film-warm', name: '暖色', tags: ['film'] }]]) {
        const state = fixture(presets);
        await state.handler.runLibraryAction({ kind: 'lut', key: 'lut/film-warm' }, 'apply');
        assert.deepEqual(state.calls, [['akari.timeline.applyLibraryItem', {
            payload: { kind: 'lut', id: 'film-warm' }, editUri: 'file:///project/edit.json'
        }]]);
        assert.deepEqual(state.notices, []);
    }
    const loading = fixture();
    loading.handler.presetShowcase.lut = undefined;
    await loading.handler.runLibraryAction({ kind: 'lut', key: 'lut/film-warm' }, 'apply');
    assert.deepEqual(loading.calls[0][1].payload, { kind: 'lut', id: 'film-warm' });
});

test('プリセット payload は種類に必要な値だけを載せる', () => {
    assert.deepEqual(presetApplyPayload({ kind: 'lut', id: 'film-warm', name: '暖色', tags: [] }),
        { kind: 'lut', id: 'film-warm' });
    assert.deepEqual(presetApplyPayload({ kind: 'textanim', id: 'fade', name: 'フェード', tags: ['in'] }),
        { kind: 'textanim', id: 'fade', slot: 'in' });
    assert.deepEqual(presetApplyPayload({ kind: 'textstyle', id: 'news', name: 'ニュース', tags: [], style: { color: '#fff' } }),
        { kind: 'textstyle', id: 'news', style: { color: '#fff' } });
});
