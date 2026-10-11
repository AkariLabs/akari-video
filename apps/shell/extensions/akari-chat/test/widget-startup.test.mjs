import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ChatInputIme } = require('../lib/browser/chat-input-ime.js');
const Module = require('node:module');
const widgetPath = require.resolve('../lib/browser/akari-chat-widget.js');
const originalLoad = Module._load;
let AkariChatWidget;
try {
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === widgetPath) {
            if (request === '../common/chat-ui-logic' || request === './chat-input-ime' || request === './chat-protocol-r2') return originalLoad.call(this, request, parent, isMain);
            if (request === '@theia/core/shared/inversify') return {
                inject: () => () => undefined,
                postConstruct: () => () => undefined,
                injectable: () => target => target
            };
            if (request === '@theia/core/lib/browser/widgets/react-widget') return {
                ReactWidget: class { update() {} onAfterShow() {} onActivateRequest() {} }
            };
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    ({ AkariChatWidget } = require(widgetPath));
} finally {
    Module._load = originalLoad;
}

test('resumeLast stays deferred while hidden and warms when shown', async () => {
    const entry = { id: 'saved', agent: 'grok', sessionRef: 'session-saved', title: '前の会話',
        model: 'model-one', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
    let discover;
    const agentsReady = new Promise(resolve => { discover = resolve; });
    let starts = 0;
    let loads = 0;
    let transcripts = 0;
    let itemsAtResume = 0;
    const widget = new AkariChatWidget();
    widget.agentsReady = agentsReady;
    widget.workspace = { ready: Promise.resolve(), roots: Promise.resolve([
        { resource: { path: { fsPath: () => '/project' } } }
    ]) };
    widget.chat = {
        listHistory: async () => { loads++; return [entry]; },
        loadTranscript: async () => { transcripts++; return [{ at: entry.createdAt,
            event: { type: 'user', text: '前の質問', attachments: [] } }]; },
        start: async () => { starts++; throw new Error('unexpected new session'); },
        resume: async () => { starts++; itemsAtResume = widget.items.length;
            widget.receive(entry.id, { type: 'ready' });
            return { chatId: entry.id, capabilities: {
            models: [], images: false, interrupt: true, clear: false, compact: false, resume: true, ask: true
        } }; }
    };
    widget.messages = { warn: () => undefined };
    const opening = widget.resumeLast();
    await Promise.resolve();
    assert.equal(loads, 0);
    assert.equal(starts, 0);
    assert.equal(transcripts, 0);
    widget.agents = [{ id: 'grok', name: 'Grok', installed: true, transport: 'acp',
        permissionModes: ['automatic', 'checkpoints'] }];
    discover();
    await opening;
    assert.equal(widget.deferredHistory?.id, entry.id);
    assert.equal(widget.resumedTitle, entry.title);
    assert.equal(widget.actualModel, entry.model);
    assert.equal(starts, 0);
    await widget.resumeLast();
    assert.equal(starts, 0);
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try {
        widget.onAfterShow({});
        for (let i = 0; i < 100 && !widget.chatId; i++) await new Promise(resolve => setTimeout(resolve, 10));
    } finally { globalThis.requestAnimationFrame = originalFrame; }
    assert.equal(starts, 1);
    assert.equal(transcripts, 1);
    assert.equal(itemsAtResume, 1);
    assert.equal(widget.chatId, entry.id);
    await widget.ensureChat();
    assert.equal(starts, 1);
    assert.equal(widget.chatId, entry.id);
    await widget.resumeLast();
    assert.equal(starts, 1);
});

test('r2 start keeps preparing until ready event', async () => {
    const widget = new AkariChatWidget();
    widget.agents = [{ id: 'claude', name: 'Claude Code', installed: true, transport: 'claude-stream-json' }];
    widget.workspace = { roots: Promise.resolve([{ resource: { path: { fsPath: () => '/project' } } }]) };
    widget.messages = { warn: () => undefined };
    const capabilities = { models: [], images: false, interrupt: true, clear: false,
        compact: false, resume: true, ask: true };
    widget.chat = { getDefaults: async () => ({}), listCommands: async () => [],
        start: async () => ({ chatId: 'r2', capabilities }) };
    assert.equal(await widget.ensureChat(), 'r2');
    assert.equal(widget.ready, false);
    assert.equal(widget.startReturned, true);
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try { widget.receive('r2', { type: 'ready' }); }
    finally { globalThis.requestAnimationFrame = originalFrame; }
    assert.equal(widget.ready, true);
});

test('composing Enter keyCode 13 prevents textarea newline; a later Enter sends', () => {
    let now = 1000;
    const widget = new AkariChatWidget();
    widget.ime = new ChatInputIme(() => now);
    let prevented = 0;
    let sent = 0;
    widget.send = () => { sent++; };
    const key = { key: 'Enter', shiftKey: false, nativeEvent: { keyCode: 13, isComposing: false },
        preventDefault: () => { prevented++; } };
    widget.ime.start();
    widget.onInputKeyDown(key);
    assert.equal(prevented, 1);
    assert.equal(sent, 0);
    widget.ime.end();
    now += 200;
    widget.onInputKeyDown(key);
    assert.equal(prevented, 2);
    assert.equal(sent, 1);
});

test('missing new RPCs do not stop an ordinary start', async () => {
    const widget = new AkariChatWidget();
    widget.agents = [{ id: 'claude', name: 'Claude Code', installed: true, transport: 'claude-stream-json' }];
    widget.workspace = { roots: Promise.resolve([{ resource: { path: { fsPath: () => '/project' } } }]) };
    widget.messages = { warn: () => undefined };
    const capabilities = { models: [], images: false, interrupt: true, clear: false,
        compact: false, resume: true, ask: true };
    widget.chat = {
        getDefaults: () => new Promise(() => undefined),
        listCommands: () => Promise.reject(new Error('not implemented')),
        start: async () => ({ chatId: 'fresh', capabilities })
    };
    assert.equal(await widget.ensureChat(), 'fresh');
    assert.equal(widget.ready, true);
    assert.equal(widget.capabilities, capabilities);
    assert.equal(widget.error, undefined);
});

test('saved transcript appears before the resumed conversation', async () => {
    const widget = new AkariChatWidget();
    widget.agents = [{ id: 'claude', name: 'Claude Code', installed: true, transport: 'claude-stream-json' }];
    widget.workspace = { roots: Promise.resolve([{ resource: { path: { fsPath: () => '/project' } } }]) };
    const entry = { id: 'saved', agent: 'claude', title: '前の会話', sessionRef: 'ref', model: 'model',
        createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
    const capabilities = { models: [], images: false, interrupt: true, clear: false,
        compact: false, resume: true, ask: true };
    let itemsAtResume = 0;
    widget.chat = {
        loadTranscript: async () => [{ at: entry.createdAt,
            event: { type: 'user', text: '前の質問', attachments: [] } }],
        resume: async () => { itemsAtResume = widget.items.length; return { chatId: entry.id, capabilities }; }
    };
    await widget.resume(entry);
    assert.equal(itemsAtResume, 1);
    assert.equal(widget.items[0].text, '前の質問');
    assert.equal(widget.resumedTitle, undefined);
    widget.stopWaiting();
});

test('stale transcript result cannot replace the new conversation', async () => {
    const widget = new AkariChatWidget();
    let resolveTranscript;
    widget.chat = { loadTranscript: () => new Promise(resolve => { resolveTranscript = resolve; }) };
    widget.startSequence = 7;
    widget.items = [{ type: 'user', text: '新しい会話', attachments: [] }];
    const loading = widget.loadTranscript('/project', 'old', 7);
    widget.startSequence = 8;
    resolveTranscript([{ at: '2026-10-11T00:00:00Z', event: { type: 'user', text: '古い会話', attachments: [] } }]);
    await loading;
    assert.equal(widget.items[0].text, '新しい会話');
});
