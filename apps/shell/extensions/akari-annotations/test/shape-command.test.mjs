import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const start = source.indexOf('commands.registerCommand(ADD_SHAPE_AT');
const end = source.indexOf("commands.registerCommand({ id: 'akari.timeline.beginMaterialSwap' }", start);
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(`function setup(commands) { ${source.slice(start, end)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const setup = new Function('ADD_SHAPE_AT', `${compiled}\nreturn setup;`)({ id: 'akari.timeline.addShapeAt' });

test('editUri を指定した図形はタイムラインを開かずにそのプロジェクトへ置く', async () => {
    const calls = [];
    const location = { editUri: { toString: () => 'file:///project/edit.json' } };
    const owner = {
        locateAll: async () => [location],
        configureQuietTimeline: async value => {
            calls.push(['quiet', value]);
            return { addShapeAt: async request => { calls.push(['place', request]); return 'shape-1'; } };
        },
        getShortcutKeybindings: () => ({ shortcutTimelineWidget: () => { throw new Error('前面に出してはいけない'); } }),
        messages: { warn: message => calls.push(['warn', message]) }
    };
    let execute;
    setup.call(owner, { registerCommand: (_id, handler) => { execute = handler.execute; } });
    const request = { preset: 'star-5', t: 12, center: { x: 400, y: 200 }, editUri: 'file:///project/edit.json', canvasAware: true };
    assert.equal(await execute(request), 'shape-1');
    assert.deepEqual(calls, [['quiet', location], ['place', request]]);
});

test('editUri なしでタイムラインが得られないときは元の案内を出す', async () => {
    const warnings = [];
    const owner = {
        getShortcutKeybindings: () => ({ shortcutTimelineWidget: () => undefined }),
        attach: async () => undefined,
        messages: { warn: message => warnings.push(message) }
    };
    let execute;
    setup.call(owner, { registerCommand: (_id, handler) => { execute = handler.execute; } });
    assert.equal(await execute({ preset: 'star-5' }), undefined);
    assert.deepEqual(warnings, ['タイムラインを開いてから図形を置いてください。']);
});
