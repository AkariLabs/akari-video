import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const start = source.indexOf("commands.registerCommand({ id: 'akari.timeline.applyLibraryItem' }");
const end = source.indexOf("commands.registerCommand({ id: 'akari.timeline.addOverlayAtOutputPoint' }", start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(`function setup(commands) { ${source.slice(start, end)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const setup = new Function(`${compiled}\nreturn setup;`)();

function fixture() {
    const notices = [];
    const owner = {
        messages: { info: text => notices.push(text), warn: text => notices.push(text) },
        locateAll: async () => [],
        getShortcutKeybindings: () => ({ shortcutTimelineWidget: () => undefined }),
        attach: async () => undefined
    };
    let execute;
    setup.call(owner, { registerCommand: (_id, handler) => { execute = handler.execute; } });
    return { owner, notices, execute };
}

test('コマンド入口は payload・プロジェクト・タイムライン欠落を黙って返さない', async () => {
    const state = fixture();
    assert.equal(await state.execute(undefined), false);
    assert.equal(await state.execute({ payload: { kind: 'lut', id: 'film-warm' }, editUri: 'file:///missing/edit.json' }), false);
    assert.equal(await state.execute({ payload: { kind: 'textanim', id: 'fade' } }), false);
    assert.deepEqual(state.notices, [
        '当てるものを読み取れませんでした。',
        'プロジェクトを特定できません。',
        'タイムラインを開いてから当ててください。'
    ]);
});

test('対象のタイムラインがあるときだけ適用へ渡し、例外は一言にする', async () => {
    const state = fixture(), calls = [];
    state.owner.locateAll = async () => [{ editUri: { toString: () => 'file:///project/edit.json' } }];
    state.owner.configureQuietTimeline = async () => ({ applyLibraryItem: async (...args) => { calls.push(args); return true; } });
    const request = { payload: { kind: 'lut', id: 'film-warm' }, editUri: 'file:///project/edit.json' };
    assert.equal(await state.execute(request), true);
    assert.deepEqual(calls, [[request.payload, undefined]]);
    state.owner.configureQuietTimeline = async () => { throw new Error('読み込み失敗'); };
    assert.equal(await state.execute(request), false);
    assert.deepEqual(state.notices, ['当てられませんでした: 読み込み失敗']);
});
