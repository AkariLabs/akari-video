import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath, readdir, readFile } from 'node:fs/promises';
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
    await mkdir(join(cwd, '.akari'));
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
    const service = new AkariChatServiceImpl();
    try { await run(service, cwd); }
    finally {
        await service.dispose();
        await Promise.allSettled([...service.transcriptTails.values()]);
        chatAdapters.splice(0, chatAdapters.length, ...original);
        await rm(cwd, { recursive: true, force: true });
    }
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

test('history writes from real and symlink cwd share one queue and index', async () => {
    await withService(async (service, cwd) => {
        const alias = join(cwd, 'alias');
        await symlink(cwd, alias);
        const one = await service.start({ agent: 'fake', cwd });
        const two = await service.start({ agent: 'fake', cwd: alias });
        await Promise.all([service.send(one.chatId, 'real', []), service.send(two.chatId, 'alias', [])]);
        assert.deepEqual(new Set((await service.listHistory(`${alias}/`)).map(row => row.title)),
            new Set(['real', 'alias']));
    });
});

test('a broken history index is backed up before the next first send', async () => {
    await withService(async (service, cwd) => {
        const directory = join(cwd, '.akari', 'chat');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'sessions.json'), '{broken');
        await assert.rejects(service.listHistory(cwd), SyntaxError);
        const started = await service.start({ agent: 'fake', cwd });
        await service.send(started.chatId, 'recovered', []);
        assert.equal((await service.listHistory(cwd))[0].title, 'recovered');
        const backups = (await readdir(directory)).filter(name => /^sessions\.json\.broken-/.test(name));
        assert.equal(backups.length, 1);
        assert.equal(await readFile(join(directory, backups[0]), 'utf8'), '{broken');
    });
});

test('attachment path classification uses project realpath', async () => {
    await withService(async (service, cwd) => {
        const alias = join(cwd, 'alias');
        await symlink(cwd, alias);
        await mkdir(join(cwd, 'assets'));
        await writeFile(join(cwd, 'assets', 'clip.mp4'), 'clip');
        const result = await service.resolveAttachmentPath(alias, join(alias, 'assets', 'clip.mp4'));
        assert.equal(result.inside, true);
        assert.equal(result.relative, 'assets/clip.mp4');
        assert.equal(result.path, await realpath(join(cwd, 'assets', 'clip.mp4')));
    });
});

test('start reports an initial error by event and the first send ends', async () => {
    await withService(async (service, cwd) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        const started = await service.start({ agent: 'fake', cwd });
        assert.ok(started.chatId);
        await service.send(started.chatId, 'hello', []);
        assert.ok(events.some(event => event.type === 'error' && event.kind === 'auth'));
        assert.ok(events.some(event => event.type === 'turn.end' && !event.ok));
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
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        const opening = service.start({ agent: 'fake', cwd, token: 'cancel-me' });
        await started;
        const { chatId } = await opening;
        await service.cancelStart('cancel-me');
        await assert.rejects(service.send(chatId, 'ignored', []), /会話が見つかりません/);
        await Promise.resolve();
        assert.equal(service.sessions.has(chatId), false);
        assert.equal(events.some(event => event.type === 'error'), false);
        assert.deepEqual(await service.listHistory(cwd), []);
    }, async ({ signal }) => {
        entered();
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
});

test('cancelStart closes a session returned after cancellation without an error event', async () => {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    let closed;
    const wasClosed = new Promise(resolve => { closed = resolve; });
    await withService(async (service, cwd) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        const { chatId } = await service.start({ agent: 'fake', cwd, token: 'late-cancel' });
        await service.cancelStart('late-cancel');
        release();
        await wasClosed;
        assert.equal(service.sessions.has(chatId), false);
        assert.equal(events.some(event => event.type === 'error'), false);
        await assert.rejects(service.send(chatId, 'ignored', []), /会話が見つかりません/);
    }, async () => {
        await delayed;
        return {
            sessionRef: 'late-session', capabilities: async () => ({ models: [], images: false, interrupt: true,
                clear: false, compact: false, resume: true, ask: false }),
            onEvent: () => ({ dispose: () => {} }), send: async () => {}, interrupt: async () => {},
            close: async () => { closed(); }
        };
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
        assert.ok(reopened.chatId);
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
    const many = Array.from({ length: 5 }, (_, index) => ({ id: `model-${index}`, label: `Model ${index}` }));
    assert.deepEqual(modelChoices(many, '', ['model-4', 'model-3', 'model-2', 'model-1'], 'model-0')
        .frequent.map(model => model.id), ['model-0', 'model-4', 'model-3']);
});

test('model labels resolve explicit and runtime Claude IDs', () => {
    const models = [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }];
    assert.equal(modelLabel(models, 'sonnet', 'claude-haiku-5-5'), 'Sonnet');
    assert.equal(modelLabel(models, 'claude-haiku-5-5', 'claude-opus-5-1'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'claude-haiku-5-5'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'HAIKU'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'unknown-model'), 'unknown-model');
    assert.equal(modelLabel(models), '既定');
});

test('model labels stay readable while capabilities are unavailable', () => {
    const models = [];
    assert.equal(modelLabel(models, undefined, 'claude-haiku-5-5'), 'Haiku');
    assert.equal(modelLabel(models, undefined, 'claude-opus-5-5'), 'Opus');
    assert.equal(modelLabel(models, undefined, 'claude-sonnet-5-5'), 'Sonnet');
    assert.equal(modelLabel(models, undefined, 'claude-fable-5-1'), 'Fable');
    assert.equal(modelLabel(models, undefined, 'claude-sonnetry-5-5'), 'claude-sonnetry-5-5');
    assert.equal(modelLabel(models, undefined, 'provider/long-model-id'), 'long-model-id');
    assert.equal(modelLabel(models, 'provider:short-name'), 'short-name');
    assert.equal(modelLabel([{ id: 'provider/long-model-id', label: 'Display Name' }],
        undefined, 'provider/long-model-id'), 'Display Name');
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

test('resume failure has a Japanese action without exposing provider errors', () => {
    const { resumeFailure } = require('../lib/common/chat-ui-logic.js');
    for (const message of ['Error: no rollout found for thread id abc', 'Internal error: OpenCode service failure']) {
        const error = { type: 'error', kind: 'other', message };
        assert.equal(resumeFailure(error, true, true), true);
        const display = chatErrorPresentation(error, 'Codex', true, 'codex', true);
        assert.equal(display.reason, 'この会話は開けません。相手側に会話が残っていません。');
        assert.equal(display.nextStep, true);
    }
    assert.equal(resumeFailure({ type: 'error', kind: 'auth', message: 'login required' }, true, true), false);
    assert.equal(resumeFailure({ type: 'error', kind: 'other', message: 'error_during_execution' }, false, true), true);
    assert.equal(resumeFailure({ type: 'error', kind: 'other', message: 'No conversation found' }, false, false), true);
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
