import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ChatInputIme } = require('../lib/browser/chat-input-ime.js');
const { modelLabel } = require('../lib/common/chat-ui-logic.js');
const { showElapsedThinking, thinkingLabel } = require('../lib/browser/chat-view-logic.js');
const Module = require('node:module');
const widgetPath = require.resolve('../lib/browser/akari-chat-widget.js');
const originalLoad = Module._load;
let AkariChatWidget;
try {
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === widgetPath) {
            if (request === '../common/chat-ui-logic' || request === './chat-input-ime' || request === './chat-view-logic') return originalLoad.call(this, request, parent, isMain);
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

test('start keeps preparing until ready event', async () => {
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

test('early capabilities survive start and commands refresh at lifecycle events', async () => {
    const widget = new AkariChatWidget();
    widget.agents = [{ id: 'claude', name: 'Claude Code', installed: true, transport: 'claude-stream-json' }];
    widget.workspace = { roots: Promise.resolve([{ resource: { path: { fsPath: () => '/project' } } }]) };
    widget.messages = { warn: () => undefined };
    const initial = { models: [], images: false, interrupt: false, clear: false,
        compact: false, resume: false, ask: false };
    const updated = { ...initial, models: [{ id: 'haiku', label: 'Haiku' }], currentModel: 'claude-haiku-5-5' };
    let commandReads = 0;
    widget.chat = {
        getDefaults: async () => ({ model: 'haiku' }),
        listCommands: async () => { commandReads++; return [{ name: 'edit-lint', kind: 'skill' }]; },
        start: async () => {
            widget.receive('early', { type: 'capabilities', capabilities: updated });
            widget.receive('early', { type: 'ready' });
            return { chatId: 'early', capabilities: initial };
        }
    };
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try {
        await widget.ensureChat();
        assert.equal(widget.ready, true);
        assert.equal(widget.capabilities, updated);
        assert.equal(modelLabel(widget.capabilities.models, widget.model, widget.actualModel), 'Haiku');
        widget.receive('early', { type: 'turn.end', ok: true });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.ok(commandReads >= 3);
        assert.equal(widget.commandsList[0].name, 'edit-lint');
    } finally { globalThis.requestAnimationFrame = originalFrame; }
});

test('chosen model is visible before the model event confirms it', async () => {
    const widget = new AkariChatWidget();
    widget.selectedAgent = 'claude';
    widget.chatId = 'open';
    widget.capabilities = { models: [
        { id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku' }
    ] };
    widget.actualModel = 'claude-opus-5-1';
    let confirm;
    widget.chat = { setModel: async () => new Promise(resolve => { confirm = resolve; }),
        setDefaults: async () => undefined };
    const switching = widget.switchModel('haiku');
    assert.equal(modelLabel(widget.capabilities.models, widget.model, widget.actualModel), 'Haiku');
    confirm();
    await switching;
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try { widget.receive('open', { type: 'model', model: 'haiku' }); }
    finally { globalThis.requestAnimationFrame = originalFrame; }
    assert.equal(widget.actualModel, 'haiku');
    globalThis.requestAnimationFrame = () => 1;
    try { widget.receive('open', { type: 'session', sessionId: 'saved', agent: 'claude', model: 'claude-opus-5-1', cwd: '/project' }); }
    finally { globalThis.requestAnimationFrame = originalFrame; }
    assert.equal(widget.actualModel, 'haiku');
});

test('ready, capabilities, turn end and slash retry slow command discovery', async () => {
    const widget = new AkariChatWidget();
    widget.chatId = 'slow';
    let reads = 0;
    widget.chat = { listCommands: async () => {
        reads++;
        await new Promise(resolve => setTimeout(resolve, 750));
        return [{ name: 'edit-lint', kind: 'skill' }];
    } };
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try {
        widget.receive('slow', { type: 'ready' });
        widget.receive('slow', { type: 'capabilities', capabilities: { models: [] } });
        widget.receive('slow', { type: 'turn.end', ok: true });
        widget.prefill('/');
        assert.equal(reads, 4);
        await new Promise(resolve => setTimeout(resolve, 820));
        assert.equal(widget.commandsList[0].name, 'edit-lint');
    } finally { globalThis.requestAnimationFrame = originalFrame; }
});

test('defaults and transcript reads can take longer than the short control RPC timeout', async () => {
    const widget = new AkariChatWidget();
    widget.selectedAgent = 'claude';
    widget.chat = {
        getDefaults: async () => { await new Promise(resolve => setTimeout(resolve, 750)); return { model: 'haiku' }; },
        loadTranscript: async () => { await new Promise(resolve => setTimeout(resolve, 750));
            return [{ at: '2026-10-11T00:00:00Z', event: { type: 'user', text: '前の質問', attachments: [] } }]; }
    };
    await widget.applyDefaults('claude', 0);
    assert.equal(widget.model, 'haiku');
    await widget.loadTranscript('/project', 'saved', 0);
    assert.equal(widget.items[0].text, '前の質問');
});

test('thinking tool completion updates the existing thought row', () => {
    const widget = new AkariChatWidget();
    widget.chatId = 'thought';
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try {
        widget.receive('thought', { type: 'thinking.delta', id: 'r', text: '考え中' });
        widget.receive('thought', { type: 'tool', id: 'r', kind: 'think', title: '考えました',
            status: 'done', detail: { text: '考え中' }, durationMs: 2000 });
        assert.equal(widget.items.length, 1);
        assert.equal(widget.items[0].type, 'thinking');
        assert.equal(widget.items[0].text, '考え中');
        assert.equal(widget.items[0].status, 'done');
        assert.equal(widget.items[0].durationMs, 2000);
        widget.receive('thought', { type: 'tool', id: 'other', kind: 'think', title: '考えています',
            status: 'running', detail: { text: '同じ文' } });
        widget.receive('thought', { type: 'thinking.delta', id: 'other', text: '同じ文' });
        assert.equal(widget.items.length, 2);
        assert.equal(widget.items[1].text, '同じ文');
    } finally { globalThis.requestAnimationFrame = originalFrame; }
});

test('Codex waiting state shows elapsed thinking until activity arrives', async () => {
    const widget = new AkariChatWidget();
    widget.selectedAgent = 'codex';
    widget.chatId = 'waiting';
    widget.storage = { setData: async () => undefined };
    widget.ensureChat = async () => 'waiting';
    let finishSend;
    widget.chat = { send: () => new Promise(resolve => { finishSend = resolve; }) };
    widget.outbox.push({ text: '質問', attachments: [] });
    const sending = widget.flushOutbox();
    await Promise.resolve();
    widget.now = widget.turnStartedAt + 3200;
    assert.equal(showElapsedThinking(widget.busy, widget.turnHasActivity, !!widget.thinking), true);
    assert.equal(thinkingLabel(widget.turnStartedAt, widget.now, false), '考えています… 3 秒');
    const originalFrame = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    try { widget.receive('waiting', { type: 'message.start', id: 'm', role: 'assistant' }); }
    finally { globalThis.requestAnimationFrame = originalFrame; }
    assert.equal(showElapsedThinking(widget.busy, widget.turnHasActivity, !!widget.thinking), false);
    finishSend();
    await sending;
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

test('RPC failures leave the start pending until ready without crashing', async () => {
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
    assert.equal(widget.ready, false);
    assert.equal(widget.capabilities, capabilities);
    assert.equal(widget.error, undefined);
    widget.stopWaiting();
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
