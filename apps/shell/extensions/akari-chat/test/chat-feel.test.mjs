import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { ChatInputIme } = require('../lib/browser/chat-input-ime.js');
const { commandMatches, commandGroups, optionalRpc, transcriptToItems, thinkingLabel, showElapsedThinking,
    commandMenuMaxHeight, preparationReady, permissionLabel, permissionSelection, contextUsageLabel,
    contextUsage, restoreDraft } =
    require('../lib/browser/chat-view-logic.js');

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

test('slash menu ranks command names before descriptions', () => {
    const commands = [
        { name: 'address-review', description: 'edit-lint を実行', kind: 'skill' },
        { name: 'edit-lint', description: '', kind: 'skill' },
        { name: 'render-cut', description: 'edit-lint 後に実行', kind: 'skill' },
        { name: 'akari:edit-lint', description: '', kind: 'skill' }
    ];
    assert.deepEqual(commandMatches(commands, 'edit-l').map(row => row.name),
        ['edit-lint', 'akari:edit-lint', 'address-review', 'render-cut']);
    assert.equal(commandMatches(commands, '').length, 4);
});

test('transcript keeps reused IDs separate across resumed turns', () => {
    const at = '2026-10-11T00:00:00Z';
    const events = [
        { type: 'message.start', id: 'm', role: 'assistant' },
        { type: 'message.delta', id: 'm', text: '前' },
        { type: 'thinking.delta', id: 't', text: '考え' },
        { type: 'tool', id: 't', kind: 'think', title: '思考', status: 'done' },
        { type: 'tool', id: 'tool', kind: 'read', title: '前', status: 'running' },
        { type: 'tool', id: 'tool', kind: 'read', title: '前', status: 'done' },
        { type: 'turn.end', ok: true },
        { type: 'message.start', id: 'm', role: 'assistant' },
        { type: 'message.delta', id: 'm', text: '後' },
        { type: 'thinking.delta', id: 't', text: '新しく' },
        { type: 'tool', id: 't', kind: 'think', title: '思考', status: 'done' },
        { type: 'tool', id: 'tool', kind: 'read', title: '後', status: 'running' },
        { type: 'tool', id: 'tool', kind: 'read', title: '後', status: 'done' }
    ];
    const items = transcriptToItems(events.map(event => ({ at, event })));
    assert.deepEqual(items.filter(item => item.type === 'message').map(item => item.text), ['前', '後']);
    assert.deepEqual(items.filter(item => item.type === 'thinking').map(item => item.text), ['考え', '新しく']);
    assert.deepEqual(items.filter(item => item.type === 'tool').map(item => item.event.title), ['前', '後']);
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

test('thinking deltas and completed think tools restore as one expandable row', () => {
    const at = '2026-10-11T00:00:00Z';
    const later = '2026-10-11T00:00:02Z';
    const items = transcriptToItems([
        { at, event: { type: 'thinking.delta', id: 'r1', text: '調べ' } },
        { at, event: { type: 'thinking.delta', id: 'r1', text: 'ます' } },
        { at: later, event: { type: 'tool', id: 'r1', kind: 'think', title: '考えました',
            status: 'done', detail: { text: '調べます' }, durationMs: 2000 } },
        { at: later, event: { type: 'tool', id: 'r2', kind: 'think', title: '考えました',
            status: 'done', detail: { text: '別の要約' }, durationMs: 1000 } },
        { at: later, event: { type: 'tool', id: 'r3', kind: 'think', title: '考えています',
            status: 'running', detail: { text: '重複なし' } } },
        { at: later, event: { type: 'thinking.delta', id: 'r3', text: '重複なし' } }
    ]);
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(item => item.type), ['thinking', 'thinking', 'thinking']);
    assert.equal(items[0].text, '調べます');
    assert.equal(items[0].status, 'done');
    assert.equal(items[0].durationMs, 2000);
    assert.equal(items[1].text, '別の要約');
    assert.equal(items[2].text, '重複なし');
});

test('thinking elapsed time and permission labels are stable', () => {
    assert.equal(thinkingLabel(1000, 4200, false), '考えています… 3 秒');
    assert.equal(thinkingLabel(1000, 4200, true), '考えています');
    assert.equal(thinkingLabel(1000, 4200, true, true), '考えました · 3 秒');
    assert.equal(showElapsedThinking(true, false, false), true);
    for (const activity of ['message.start', 'message.delta', 'tool', 'thinking.delta']) {
        assert.equal(showElapsedThinking(true, !!activity, activity === 'thinking.delta'), false);
    }
    assert.deepEqual(['auto', 'all', 'checkpoints', 'every'].map(permissionLabel),
        ['自動', '自動', '要所で確認', '毎回確認']);
    assert.deepEqual(['auto', 'all', 'checkpoints', 'every'].map(permissionSelection),
        ['automatic', 'automatic', 'checkpoints', 'every']);
});

test('slash menu height stays below the panel header and rows grow with content', () => {
    assert.equal(commandMenuMaxHeight(100, 500), 312);
    assert.equal(commandMenuMaxHeight(100, 800), 420);
    assert.equal(commandMenuMaxHeight(100, 170), 0);
    const style = readFileSync(new URL('../src/browser/chat-style.ts', import.meta.url), 'utf8');
    assert.match(style, /\.akari-chat-commands button \{[^}]*height: auto !important/s);
    assert.match(style, /\.akari-chat-commands button small \{[^}]*-webkit-line-clamp: 2/s);
    assert.match(style, /\.akari-chat-commands \{[^}]*overflow-y: auto/s);
    assert.match(style, /\.akari-chat-attach-menu button \{[^}]*height: auto !important/s);
    assert.match(style, /\.akari-chat-attach-menu \.akari-chat-soon-badge \{[^}]*display: inline-flex/s);
});

test('chat controls keep narrow panels within the widget', () => {
    const style = readFileSync(new URL('../src/browser/chat-style.ts', import.meta.url), 'utf8');
    const chat = style.match(/\.akari-chat \{([^}]*)\}/s)?.[1] || '';
    assert.match(chat, /min-width: 0;/);
    assert.doesNotMatch(chat, /min-width: 300px;/);
    assert.match(style, /\.akari-chat-head \{[^}]*min-width: 0;/s);
    assert.match(style, /\.akari-chat-thread \{[^}]*min-width: 0;/s);
    assert.match(style, /\.akari-chat-composer \{[^}]*min-width: 0;/s);
    const controls = style.match(/\.akari-chat-controls \[data-chat-model-button\],\s*\.akari-chat-controls \[data-chat-permission-chip\] \{([^}]*)\}/s)?.[1] || '';
    assert.match(controls, /white-space: nowrap;/);
    assert.match(controls, /text-overflow: ellipsis;/);
    assert.doesNotMatch(controls, /min-width:/);
    assert.match(style, /\.akari-chat-controls \[data-chat-permission-chip\] \{ flex-shrink: 1\.1; \}/);
    const label = style.match(/\.akari-chat-controls \.akari-chat-control-label \{([^}]*)\}/s)?.[1] || '';
    assert.match(label, /display: block;/);
    assert.match(label, /overflow: hidden;/);
    assert.match(label, /text-overflow: ellipsis;/);
    assert.match(label, /white-space: nowrap;/);
    assert.match(style, /\[data-chat-model-button\] \.akari-chat-control-label \{ min-width: 3em; \}/);
    assert.match(style, /\[data-chat-permission-chip\] \.akari-chat-control-label \{ min-width: 2\.5em; \}/);
    assert.match(style, /@container \(max-width: 320px\)/);
    assert.match(style, /@container \(max-width: 280px\)/);
    assert.match(style, /\.akari-chat-controls > button:not\(\[data-chat-model-button\]\):not\(\[data-chat-permission-chip\]\) \{[^}]*flex-shrink: 0;/s);
});

test('preparation waits for ready', () => {
    assert.equal(preparationReady(false), false);
    assert.equal(preparationReady(true), true);
});

test('context usage labels include grouped numbers and unknown limit', () => {
    assert.equal(contextUsageLabel(12345, 200000), '使用量 12,345 / 上限 200,000 トークン · 6%');
    assert.equal(contextUsageLabel(12345), '使用量 12,345 トークン（上限は分かりません）');
    assert.deepEqual(contextUsage(12345, 200000), {
        state: 'known', label: '使用量 12,345 / 上限 200,000 トークン · 6%', percentage: 6 });
    assert.deepEqual(contextUsage(13679), {
        state: 'no-limit', label: '使用量 13,679 トークン（上限は分かりません）', percentage: 0 });
    assert.deepEqual(contextUsage(undefined, undefined, true), {
        state: 'unavailable', label: 'この相手は使用量を表示できません', percentage: 0 });
    assert.deepEqual(contextUsage(), {
        state: 'empty', label: 'まだ使用量はありません', percentage: 0 });
});

test('unsent drafts return in send order before newer text and attachments', () => {
    assert.deepEqual(restoreDraft([
        { text: '一行目\n二行目', attachments: ['file', 'pin'] },
        { text: '次の送信', attachments: ['second'] }
    ], '入力中', ['current']), {
        text: '一行目\n二行目\n次の送信\n入力中', attachments: ['file', 'pin', 'second', 'current']
    });
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
