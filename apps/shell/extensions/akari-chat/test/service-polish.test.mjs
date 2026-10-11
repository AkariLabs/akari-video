import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AkariChatServiceImpl } = require('../lib/node/akari-chat-service.js');
const { chatAdapters } = require('../lib/node/adapters/index.js');
const { modelChoices, modelLabel, chatErrorPresentation, latestResumableHistory,
    isCurrentHistory } = require('../lib/common/chat-ui-logic.js');
const { markChatLastUsed } = require('../lib/browser/chat-last-used.js');

async function withService(run, adapterStart) {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-chat-service-'));
    const original = chatAdapters.splice(0);
    chatAdapters.push({
        info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
        start: adapterStart || (async () => {
            const listeners = new Set();
            return {
                sessionRef: 'ref-1',
                capabilities: async () => ({ models: [], images: false, interrupt: true, clear: false,
                    compact: false, resume: true, ask: false }),
                onEvent: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
                send: async () => {
                    for (const listener of listeners) listener({ type: 'session', sessionId: 'ref-1', agent: 'fake', cwd });
                    for (const listener of listeners) listener({ type: 'turn.end', ok: true });
                },
                interrupt: async () => {}, close: async () => {}
            };
        })
    });
    try { await run(new AkariChatServiceImpl(), cwd); }
    finally { chatAdapters.splice(0, chatAdapters.length, ...original); await rm(cwd, { recursive: true, force: true }); }
}

test('empty starts leave no history; concurrent first sends and events retain every row', async () => {
    await withService(async (service, cwd) => {
        const one = await service.start({ agent: 'fake', cwd });
        const two = await service.start({ agent: 'fake', cwd });
        assert.deepEqual(await service.listHistory(cwd), []);
        await Promise.all([
            service.send(one.chatId, 'first', []),
            service.send(two.chatId, 'second', [])
        ]);
        const history = await service.listHistory(cwd);
        assert.deepEqual(new Set(history.map(row => row.title)), new Set(['first', 'second']));
        assert.equal(history.length, 2);
    });
});

test('start reports an initial error and the first send replays error then end', async () => {
    await withService(async (service, cwd) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        const started = await service.start({ agent: 'fake', cwd });
        assert.equal(started.error.kind, 'auth');
        assert.equal(events.length, 0);
        await service.send(started.chatId, 'hello', []);
        assert.deepEqual(events.map(event => event.type), ['error', 'turn.end']);
        assert.deepEqual(await service.listHistory(cwd), []);
    }, async () => {
        const listeners = new Set();
        const initialError = { type: 'error', kind: 'auth', message: 'ログインしてください' };
        return {
            sessionRef: '', initialError,
            capabilities: async () => ({ models: [], images: false, interrupt: true, clear: false,
                compact: false, resume: false, ask: false }),
            onEvent: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
            send: async () => { for (const listener of listeners) {
                listener(initialError);
                listener({ type: 'turn.end', ok: false, reason: 'auth' });
            } },
            interrupt: async () => {}, close: async () => {}
        };
    });
});

test('cancelStart aborts the adapter and leaves no active history', async () => {
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    await withService(async (service, cwd) => {
        const opening = service.start({ agent: 'fake', cwd, token: 'cancel-me' });
        await started;
        await service.cancelStart('cancel-me');
        await assert.rejects(opening, /start-cancelled/);
        assert.deepEqual(await service.listHistory(cwd), []);
    }, async ({ signal }) => {
        entered();
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
});

test('a cancelled token cannot start after delayed backend registration', async () => {
    await withService(async (service, cwd) => {
        await service.cancelStart('already-cancelled');
        await assert.rejects(service.start({ agent: 'fake', cwd, token: 'already-cancelled' }), /start-cancelled/);
        assert.deepEqual(await service.listHistory(cwd), []);
    });
});

test('a failed resume keeps the saved history reference usable', async () => {
    let starts = 0;
    await withService(async (service, cwd) => {
        const first = await service.start({ agent: 'fake', cwd });
        await service.send(first.chatId, 'saved chat', []);
        const [saved] = await service.listHistory(cwd);
        assert.equal(saved.sessionRef, 'saved-ref');
        await service.close(first.chatId);
        const reopened = await service.resume(cwd, saved.id);
        assert.equal(reopened.error.kind, 'auth');
        await service.send(reopened.chatId, 'retry', []);
        const [after] = await service.listHistory(cwd);
        assert.equal(after.sessionRef, 'saved-ref');
        assert.equal(after.title, 'saved chat');
    }, async () => {
        const listeners = new Set();
        const failed = ++starts > 1;
        const initialError = failed ? { type: 'error', kind: 'auth', message: 'ログインしてください' } : undefined;
        return {
            sessionRef: failed ? '' : 'saved-ref', initialError,
            capabilities: async () => ({ models: [], images: false, interrupt: true, clear: false,
                compact: false, resume: true, ask: false }),
            onEvent: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
            send: async () => { for (const listener of listeners) listener(failed ? initialError
                : { type: 'session', sessionId: 'saved-ref', agent: 'fake', cwd: '' });
                for (const listener of listeners) listener({ type: 'turn.end', ok: !failed, reason: failed ? 'auth' : undefined }); },
            interrupt: async () => {}, close: async () => {}
        };
    });
});

test('model search matches id and label and keeps recent choices above the list', () => {
    const models = [{ id: 'a/fast', label: 'Quick' }, { id: 'b/deep', label: 'Reasoning' }];
    assert.deepEqual(modelChoices(models, 'DEEP', [], undefined).matches.map(model => model.id), ['b/deep']);
    assert.deepEqual(modelChoices(models, 'quick', [], undefined).matches.map(model => model.id), ['a/fast']);
    assert.deepEqual(modelChoices(models, '', ['b/deep'], 'a/fast').frequent.map(model => model.id), ['a/fast', 'b/deep']);
});

test('model labels resolve explicit and runtime Claude IDs', () => {
    const models = [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }];
    assert.equal(modelLabel(models, 'sonnet', 'claude-haiku-5-5'), 'Sonnet');
    assert.equal(modelLabel(models, undefined, 'claude-haiku-5-5'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'HAIKU'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'unknown-model'), 'unknown-model');
    assert.equal(modelLabel(models), '既定');
});

test('auth errors show the agent reason and next actions; ordinary turn errors do not', () => {
    const gemini = chatErrorPresentation({ type: 'error', kind: 'auth',
        message: 'This client is no longer supported. Please migrate to Antigravity.' }, 'Gemini CLI', true, 'gemini');
    assert.equal(gemini.heading, 'Gemini CLI にログインが必要です');
    assert.match(gemini.reason, /Antigravity/);
    assert.equal(gemini.nextStep, true);
    const turn = chatErrorPresentation({ type: 'error', kind: 'other', message: '処理に失敗しました' }, 'Codex', false, 'codex');
    assert.equal(turn.heading, undefined);
    assert.equal(turn.reason, '処理に失敗しました');
    assert.equal(turn.nextStep, false);
    const agy = chatErrorPresentation({ type: 'error', kind: 'other', message: 'Antigravity model unavailable' },
        'Antigravity', false, 'antigravity');
    assert.equal(agy.reason, 'Antigravity model unavailable');
});

test('sending marks chat as the last partner, even after another startup writes its marker', async () => {
    const saved = new Map();
    const storage = { setData: async (key, value) => { saved.set(key, value); } };
    await markChatLastUsed(storage, new Date('2026-10-11T00:00:00.000Z'));
    saved.set('akari.partner.last', { entryId: 'deepseek', at: '2026-10-11T00:00:01.000Z' });
    await markChatLastUsed(storage, new Date('2026-10-11T00:00:02.000Z'));
    assert.deepEqual(saved.get('akari.partner.last'), {
        entryId: 'akari-chat', at: '2026-10-11T00:00:02.000Z'
    });
});

test('restore chooses the latest installed session and reuses an open or opening row', () => {
    const history = [
        { id: 'old', agent: 'claude', sessionRef: 'a', updatedAt: '2026-10-10T00:00:00Z' },
        { id: 'missing', agent: 'gemini', sessionRef: 'b', updatedAt: '2026-10-12T00:00:00Z' },
        { id: 'latest', agent: 'codex', sessionRef: 'c', updatedAt: '2026-10-11T00:00:00Z' },
        { id: 'empty', agent: 'claude', sessionRef: '', updatedAt: '2026-10-13T00:00:00Z' }
    ];
    const latest = latestResumableHistory(history, new Set(['claude', 'codex']));
    assert.equal(latest.id, 'latest');
    assert.equal(isCurrentHistory(latest.id, latest.id), true);
    assert.equal(isCurrentHistory(latest.id, undefined, latest.id), true);
    assert.equal(isCurrentHistory(latest.id, 'old', undefined), false);
});

test('history preview leaves the partner stopped until the first deferred resume', async () => {
    await withService(async (service, cwd) => {
        const calls = [];
        const adapter = chatAdapters[0];
        const start = adapter.start;
        adapter.start = async options => { calls.push(options); return start(options); };
        const first = await service.start({ agent: 'fake', cwd });
        await service.send(first.chatId, 'saved', []);
        await service.close(first.chatId);
        const preview = latestResumableHistory(await service.listHistory(cwd), new Set(['fake']));
        assert.equal(preview.title, 'saved');
        assert.equal(calls.length, 1);
        const reopened = await service.resume(cwd, preview.id, undefined, 'checkpoints');
        assert.equal(reopened.chatId, preview.id);
        assert.equal(calls.length, 2);
        assert.equal(calls[1].permission, 'checkpoints');
        await service.send(reopened.chatId, 'next', []);
        await service.listHistory(cwd);
    });
});
