import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const widgetPath = require.resolve('../lib/browser/akari-chat-widget.js');
const originalLoad = Module._load;
let AkariChatWidget;
try {
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === widgetPath) {
            if (request === '../common/chat-ui-logic') return originalLoad.call(this, request, parent, isMain);
            if (request === '@theia/core/shared/inversify') return {
                inject: () => () => undefined,
                postConstruct: () => () => undefined,
                injectable: () => target => target
            };
            if (request === '@theia/core/lib/browser/widgets/react-widget') return {
                ReactWidget: class { update() {} }
            };
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    ({ AkariChatWidget } = require(widgetPath));
} finally {
    Module._load = originalLoad;
}

test('resumeLast waits for agent discovery and does not start the adapter until sending', async () => {
    const entry = { id: 'saved', agent: 'grok', sessionRef: 'session-saved', title: '前の会話',
        model: 'model-one', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' };
    let discover;
    const agentsReady = new Promise(resolve => { discover = resolve; });
    let starts = 0;
    let loads = 0;
    const widget = new AkariChatWidget();
    widget.agentsReady = agentsReady;
    widget.workspace = { ready: Promise.resolve(), roots: Promise.resolve([
        { resource: { path: { fsPath: () => '/project' } } }
    ]) };
    widget.chat = {
        listHistory: async () => { loads++; return [entry]; },
        start: async () => { starts++; throw new Error('unexpected new session'); },
        resume: async () => { starts++; return { chatId: entry.id, capabilities: {
            models: [], images: false, interrupt: true, clear: false, compact: false, resume: true, ask: true
        } }; }
    };
    widget.messages = { warn: () => undefined };
    const opening = widget.resumeLast();
    await Promise.resolve();
    assert.equal(loads, 0);
    assert.equal(starts, 0);
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
    assert.equal(widget.deferredHistory?.id, entry.id);
    await widget.ensureChat();
    assert.equal(starts, 1);
    assert.equal(widget.chatId, entry.id);
    await widget.resumeLast();
    assert.equal(starts, 1);
});
