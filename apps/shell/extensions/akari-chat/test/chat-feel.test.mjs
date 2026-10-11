import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { ChatInputIme } = require('../lib/browser/chat-input-ime.js');
const { commandMatches, commandGroups, optionalRpc, transcriptToItems, thinkingLabel, showElapsedThinking,
    preparationReady, permissionLabel, permissionSelection, contextUsageLabel } =
    require('../lib/browser/chat-protocol-r2.js');

test('IME composition keeps only confirmed Japanese text and ignores shortcut keys', () => {
    let now = 1000;
    const ime = new ChatInputIme(() => now);
    let state = '';
    let dom = '';
    let sends = 0;
    let answers = 0;
    let menuMoves = 0;
    let prevented = 0;
    const key = (name, native = {}) => {
        const composing = ime.composing;
        const prevent = ime.shouldPreventDefault(name, native);
        if (prevent) prevented++;
        if (composing && name === 'Enter' && native.keyCode === 13 && !prevent) dom += '\n';
        if (ime.shouldIgnoreKey(name, native)) return;
        if (name === 'Enter') sends++;
        if (name === '1') answers++;
        if (name === 'ArrowDown' || name === 'Escape') menuMoves++;
    };
    ime.start();
    dom = 'ka';
    if (ime.shouldCommitInput({ isComposing: true })) state = dom;
    key('Enter', { isComposing: true });
    key('Enter', { keyCode: 229 });
    key('Enter', { keyCode: 13, isComposing: false });
    key('1');
    key('/');
    key('ArrowDown');
    key('Escape');
    assert.equal(state, '');
    assert.equal(dom, 'ka');
    assert.equal(sends + answers + menuMoves, 0);
    assert.equal(prevented, 2);
    ime.end();
    dom = 'か';
    if (ime.shouldCommitInput({ isComposing: false })) state = dom;
    now += 10;
    key('Enter');
    assert.equal(sends, 0);
    assert.equal(state, 'か');
    assert.equal(/[a-z]/i.test(state), false);
    now += 200;
    key('Enter');
    assert.equal(sends, 1);
});

test('a real Enter after composition settles is not swallowed', () => {
    let now = 1000;
    const ime = new ChatInputIme(() => now);
    ime.start();
    assert.equal(ime.shouldPreventDefault('Enter', { keyCode: 13 }), true);
    assert.equal(ime.shouldPreventDefault('Enter', { keyCode: 229 }), false);
    ime.end();
    now += 200;
    assert.equal(ime.shouldIgnoreKey('Enter', { keyCode: 13, isComposing: false }), false);
});

test('slash menu filters descriptions and keeps skills and commands selectable', () => {
    const commands = [
        { name: 'edit-plan', description: '構成を考える', kind: 'skill' },
        { name: 'new', description: '新しい会話', kind: 'command' },
        { name: 'compact', description: '要約して続ける', kind: 'command' }
    ];
    assert.deepEqual(commandMatches(commands, '構成').map(row => row.name), ['edit-plan']);
    assert.deepEqual(commandMatches(commands, 'co').map(row => row.name), ['compact']);
    let selected = 0;
    selected = (selected + 1) % commands.length;
    assert.equal(commands[selected].name, 'new');
    selected = (selected - 1 + commands.length) % commands.length;
    assert.equal(commands[selected].name, 'edit-plan');
    assert.deepEqual(commandGroups(commandMatches(commands, '構成')).map(group => group.label), ['スキル']);
    assert.deepEqual(commandGroups([{ name: 'new', label: '新しい会話', kind: 'command', local: true }])
        .map(group => group.label), ['会話操作']);
});

test('transcript restores user attachments, assistant deltas and latest tool state', () => {
    const at = '2026-10-11T00:00:00Z';
    const items = transcriptToItems([
        { at, event: { type: 'user', text: '確認して', attachments: [{ kind: 'file', path: 'edit.json', label: 'edit.json' }] } },
        { at, event: { type: 'message.start', id: 'm', role: 'assistant' } },
        { at, event: { type: 'message.delta', id: 'm', text: '見ま' } },
        { at, event: { type: 'message.delta', id: 'm', text: 'した' } },
        { at, event: { type: 'tool', id: 't', kind: 'read', title: '読んでいます', status: 'running' } },
        { at, event: { type: 'tool', id: 't', kind: 'read', title: '読みました', status: 'done' } }
    ]);
    assert.equal(items.length, 3);
    assert.equal(items[0].attachments[0].path, 'edit.json');
    assert.equal(items[1].text, '見ました');
    assert.equal(items[2].event.status, 'done');
});

test('thinking elapsed time and permission labels are stable', () => {
    assert.equal(thinkingLabel(1000, 4200, false), '考えています… 3 秒');
    assert.equal(thinkingLabel(1000, 4200, true), '考えています');
    assert.equal(showElapsedThinking(true, false, false), true);
    for (const activity of ['message.start', 'message.delta', 'tool', 'thinking.delta']) {
        assert.equal(showElapsedThinking(true, !!activity, activity === 'thinking.delta'), false);
    }
    assert.deepEqual(['auto', 'all', 'checkpoints', 'every'].map(permissionLabel),
        ['自動', '自動', '要所で確認', '毎回確認']);
    assert.deepEqual(['auto', 'all', 'checkpoints', 'every'].map(permissionSelection),
        ['automatic', 'automatic', 'checkpoints', 'every']);
});

test('r2 preparation waits for ready; old backend finishes on start return', () => {
    assert.equal(preparationReady(false, false, false), false);
    assert.equal(preparationReady(true, false, false), true);
    assert.equal(preparationReady(true, true, false), false);
    assert.equal(preparationReady(true, true, true), true);
    assert.equal(preparationReady(false, true, true), true);
});

test('context usage labels include grouped numbers and unknown limit', () => {
    assert.equal(contextUsageLabel(12345, 200000), '使用量 12,345 / 上限 200,000 トークン · 6%');
    assert.equal(contextUsageLabel(12345), '使用量 12,345 / 上限 — トークン · —%');
});

test('new RPC rejection and no response are swallowed', async () => {
    assert.equal(await optionalRpc(() => Promise.reject(new Error('missing')), 5), undefined);
    assert.equal(await optionalRpc(() => new Promise(() => undefined), 5), undefined);
    assert.deepEqual(await optionalRpc(async () => ['ready'], 5), ['ready']);
});

test('widget uses uncontrolled IME input and no deferred model copy', () => {
    const source = readFileSync(new URL('../src/browser/akari-chat-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /onCompositionStart=/);
    assert.match(source, /onCompositionEnd=/);
    assert.match(source, /defaultValue=''/);
    assert.doesNotMatch(source, /次の発話から反映/);
    assert.match(source, /permissionLabel\(this\.selectedPermission\(\)\)/);
    assert.doesNotMatch(source, /すべて許可/);
    assert.match(source, /permissionSelection\(this\.selectedPermission\(\)\)/);
    assert.match(source, /aria-pressed=\{selected === mode\.id\}/);
    assert.match(source, /selected === mode\.id \? ' ✓'/);
    assert.match(source, /onAfterShow/);
    assert.match(source, /onActivateRequest/);
    assert.match(source, /scrollIntoView/);
    assert.match(source, /data-chat-start-cancel/);
    const style = readFileSync(new URL('../src/browser/chat-style.ts', import.meta.url), 'utf8');
    assert.match(style, /\.akari-chat-model-column > button \{[^}]*height: auto !important/s);
    assert.match(style, /\.akari-chat-model-column > button small \{[^}]*white-space: normal/s);
});
