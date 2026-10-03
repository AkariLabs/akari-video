import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PendingAssetFetchStore } from '../lib/common/pending-asset-fetch.js';

const source = ts.createSourceFile('drop.ts',
    readFileSync(new URL('../src/browser/preview-library-drop.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PreviewLibraryDrop');
const method = widget.members.find(member => member.name?.getText(source) === 'placeThenFetch');
const code = ts.transpileModule('class Harness { ' + method.getText(source) + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const pending = new PendingAssetFetchStore();
const Harness = new Function('pendingAssetFetches', 'outputOffset', code + '\nreturn Harness;')(
    pending, () => ({ x: 0, y: 0 }));

test('配置開始と同時に取得し、プレビュー準備待ち中でも取得表示を閉じる', async () => {
    const handler = new Harness();
    const calls = [], warnings = [];
    let finishPlace, finishFetch, finishSeek;
    handler.commands = { executeCommand(command) {
        calls.push(command);
        if (command === 'akari.catalog.resolveMaterial') return new Promise(resolve => { finishFetch = resolve; });
        if (command === 'akari.timeline.addMaterialAtOutputPoint') return new Promise(resolve => { finishPlace = resolve; });
        if (command === 'akari.preview.seekOutput') return new Promise(resolve => { finishSeek = resolve; });
        return Promise.resolve();
    } };
    handler.messages = { warn: value => warnings.push(value) };
    handler.showFetchOverlay = () => {};
    handler.hideFetchOverlay = () => {};
    const plan = { relativePath: 'assets/still/photo/p.png', kind: 'image', cached: false };
    const running = handler.placeThenFetch(plan, { key: 'still/photo', width: 100 }, { time: 1, output: {} },
        { x: 0, y: 0 }, 'edit.json', false);
    assert.deepEqual(calls, ['akari.catalog.resolveMaterial', 'akari.timeline.addMaterialAtOutputPoint']);
    assert.equal(pending.has(plan.relativePath), true);
    finishPlace('placed-1');
    await new Promise(resolve => setImmediate(resolve));
    finishFetch({ relativePath: plan.relativePath, kind: 'image' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.includes('akari.preview.seekOutput'), true);
    assert.equal(pending.has(plan.relativePath), false);
    assert.deepEqual(warnings, []);
    finishSeek();
    await running;
});

test('取得失敗でも表示を消し、理由を通知して配置を取り消す', async () => {
    const handler = new Harness(), calls = [], warnings = [];
    handler.commands = { executeCommand(command) {
        calls.push(command);
        if (command === 'akari.catalog.resolveMaterial') return Promise.reject(new Error('30 秒応答がありません'));
        if (command === 'akari.timeline.addMaterialAtOutputPoint') return Promise.resolve('placed-2');
        return Promise.resolve();
    } };
    handler.messages = { warn: value => warnings.push(value) };
    handler.showFetchOverlay = () => {};
    handler.hideFetchOverlay = () => {};
    const plan = { relativePath: 'assets/still/fail/p.png', kind: 'image', cached: false };
    await handler.placeThenFetch(plan, { key: 'still/fail', width: 100 }, { time: 1, output: {} },
        { x: 0, y: 0 }, 'edit.json', false);
    assert.equal(pending.has(plan.relativePath), false);
    assert.equal(calls.includes('akari.timeline.removePlacedMaterial'), true);
    assert.match(warnings[0], /30 秒応答がありません/);
});

test('表示処理の例外でも取り寄せ中の控えを残さない', async () => {
    const handler = new Harness(), warnings = [];
    handler.commands = { executeCommand: () => Promise.resolve() };
    handler.messages = { warn: value => warnings.push(value) };
    handler.showFetchOverlay = () => { throw new Error('表示エラー'); };
    handler.hideFetchOverlay = () => {};
    const plan = { relativePath: 'assets/still/exception/p.png', kind: 'image', cached: false };
    await handler.placeThenFetch(plan, { key: 'still/exception', width: 100 }, { time: 1, output: {} },
        { x: 0, y: 0 }, 'edit.json', false);
    assert.equal(pending.has(plan.relativePath), false);
    assert.match(warnings[0], /表示エラー/);
});

test('resolveMaterial が undefined なら通知を重ねず配置と取り寄せ中の控えを消す', async () => {
    const handler = new Harness(), calls = [], warnings = [];
    handler.commands = { executeCommand(command) {
        calls.push(command);
        if (command === 'akari.catalog.resolveMaterial') return Promise.resolve(undefined);
        if (command === 'akari.timeline.addMaterialAtOutputPoint') return Promise.resolve('placed-3');
        return Promise.resolve();
    } };
    handler.messages = { warn: value => warnings.push(value) };
    handler.showFetchOverlay = () => {};
    handler.hideFetchOverlay = () => {};
    const plan = { relativePath: 'assets/still/already-notified/p.png', kind: 'image', cached: false };
    await handler.placeThenFetch(plan, { key: 'still/already-notified', width: 100 }, { time: 1, output: {} },
        { x: 0, y: 0 }, 'edit.json', false);
    assert.deepEqual(warnings, []);
    assert.equal(calls.filter(command => command === 'akari.timeline.removePlacedMaterial').length, 1);
    assert.equal(pending.has(plan.relativePath), false);
});
