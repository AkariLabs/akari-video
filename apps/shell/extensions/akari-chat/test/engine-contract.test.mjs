import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AkariChatServiceImpl } = require('../lib/node/akari-chat-service.js');
const { chatAdapters } = require('../lib/node/adapters/index.js');
const { ClaudeStreamParser } = require('../lib/node/adapters/claude-stream-parser.js');
const { projectSkills } = require('../lib/node/adapters/project-skills.js');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function withFake(run, agentId = 'fake') {
    const root = await mkdtemp(join(tmpdir(), 'chat-engine-'));
    const previousHome = process.env.HOME;
    const previousAdapters = chatAdapters.splice(0);
    process.env.HOME = join(root, 'home');
    await mkdir(process.env.HOME);
    await mkdir(join(root, '.akari'));
    const opening = deferred();
    const events = new Set();
    const received = [];
    let detections = 0;
    let models = [];
    let efforts = [];
    let startOptions;
    const session = {
        sessionRef: 'session-fixed',
        capabilities: async () => ({ models: [{ id: 'fast', label: 'Fast' }], images: false,
            interrupt: true, clear: true, compact: true, resume: true, ask: false }),
        onEvent: listener => { events.add(listener); return { dispose: () => events.delete(listener) }; },
        send: async (text, attachments) => {
            received.push({ text, attachments });
            const id = `m${received.length}`;
            const thought = `t${received.length}`;
            for (const part of ['think', 'ing']) {
                for (const listener of events) listener({ type: 'thinking.delta', id: thought, text: part });
                for (const listener of events) listener({ type: 'tool', id: thought, kind: 'think',
                    title: '考えています', status: 'running', detail: { text: part } });
            }
            for (const listener of events) listener({ type: 'tool', id: thought, kind: 'think',
                title: '考えました', status: 'done', detail: { text: 'thinking' } });
            for (const listener of events) listener({ type: 'message.start', id, role: 'assistant' });
            for (const part of ['an', 'sw', 'er']) {
                for (const listener of events) listener({ type: 'message.delta', id, text: part });
            }
            for (const listener of events) listener({ type: 'message.end', id });
            for (const listener of events) listener({ type: 'usage', usedTokens: 12, contextWindow: 100 });
            for (const listener of events) listener({ type: 'turn.end', ok: true });
        },
        setModel: async model => { models.push(model); },
        setEffort: async effort => { efforts.push(effort); },
        listCommands: async () => [{ name: 'edit-lint', kind: 'skill' }],
        interrupt: async () => {}, close: async () => { events.clear(); }
    };
    chatAdapters.push({
        info: async () => { detections++; return { id: agentId, name: 'Fake', installed: true, transport: 'acp' }; },
        start: async options => { startOptions = options; await opening.promise; return session; }
    });
    try { await run({ root, opening, received, getDetections: () => detections,
        getModels: () => models, getEfforts: () => efforts, getStartOptions: () => startOptions,
        emitAdapter: event => { for (const listener of events) listener(event); },
        service: new AkariChatServiceImpl() }); }
    finally {
        chatAdapters.splice(0, chatAdapters.length, ...previousAdapters);
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
        await rm(root, { recursive: true, force: true });
    }
}

test('Claude exposes models before init and records a slash skill tool row', async () => {
    await withFake(async ({ root, opening, service }) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        await service.setDefaults('claude', { model: 'haiku' });
        const started = await service.start({ agent: 'claude', cwd: root });
        assert.deepEqual(started.capabilities.models.map(model => model.id), ['opus', 'sonnet', 'haiku', 'fable']);
        assert.equal(started.capabilities.currentModel, 'haiku');
        const sent = service.send(started.chatId, '/edit-lint check', []);
        opening.resolve();
        await sent;
        const skill = events.find(event => event.type === 'tool' && event.kind === 'skill');
        assert.equal(skill?.title, '使いました edit-lint');
        assert.equal(skill.status, 'done');
        const rows = await service.loadTranscript(root, started.chatId);
        assert.ok(rows.some(row => row.event.type === 'tool' && row.event.title === skill.title));
    }, 'claude');
});

test('Claude model selection takes request, then saved defaults, then Claude settings', async () => {
    await withFake(async ({ root, opening, service, getStartOptions }) => {
        const settingsDir = join(process.env.HOME, '.claude');
        await mkdir(settingsDir, { recursive: true });
        await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5' }));
        const fromSettings = await service.start({ agent: 'claude', cwd: root });
        assert.equal(fromSettings.capabilities.currentModel, 'haiku');
        opening.resolve();
        await service.listCommands(fromSettings.chatId);
        assert.equal(getStartOptions().model, 'haiku');
        await service.setDefaults('claude', { model: 'sonnet' });
        const fromDefaults = await service.start({ agent: 'claude', cwd: root });
        assert.equal(fromDefaults.capabilities.currentModel, 'sonnet');
        const fromRequest = await service.start({ agent: 'claude', cwd: root, model: 'opus' });
        assert.equal(fromRequest.capabilities.currentModel, 'opus');
    }, 'claude');
});

test('start returns before ready and sends queued messages in order', async () => {
    await withFake(async ({ root, opening, received, service, getDetections }) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        const started = await service.start({ agent: 'fake', cwd: root });
        assert.ok(started.chatId);
        assert.equal(events.some(event => event.type === 'ready'), false);
        const first = service.send(started.chatId, '/edit-lint', []);
        const second = service.send(started.chatId, 'next', []);
        assert.equal(received.length, 0);
        opening.resolve();
        await Promise.all([first, second]);
        assert.deepEqual(received.map(item => item.text), ['/edit-lint', 'next']);
        assert.ok(events.some(event => event.type === 'ready'));
        assert.ok(events.some(event => event.type === 'capabilities'));
        assert.equal(getDetections(), 1);
        await service.listAgents();
        assert.equal(getDetections(), 1);
        await service.refreshAgents();
        assert.equal(getDetections(), 2);
    });
});

test('defaults, immediate model events, context, and transcript round trip', async () => {
    await withFake(async ({ root, opening, service, getModels, getEfforts, getStartOptions }) => {
        const events = [];
        service.setClient({ onEvent: (_id, event) => events.push(event) });
        await service.setDefaults('fake', { model: 'fast', effort: 'high' });
        assert.deepEqual(await service.getDefaults('fake'), { model: 'fast', effort: 'high' });
        const started = await service.start({ agent: 'fake', cwd: root });
        opening.resolve();
        await service.setModel(started.chatId, 'deep');
        assert.equal(getStartOptions().model, 'fast');
        assert.equal(getStartOptions().effort, 'high');
        await service.setEffort(started.chatId, 'low');
        assert.deepEqual(getModels(), ['deep']);
        assert.deepEqual(getEfforts(), ['low']);
        assert.deepEqual(events.filter(event => event.type === 'model').at(-1),
            { type: 'model', model: 'deep', effort: 'low' });
        assert.deepEqual(await service.listCommands(started.chatId), [{ name: 'edit-lint', kind: 'skill' }]);
        await service.send(started.chatId, 'hello', []);
        assert.deepEqual(await service.contextInfo(started.chatId),
            { usedTokens: 12, contextWindow: 100, model: 'deep', canCompact: true });
        const rows = await service.loadTranscript(root, started.chatId);
        assert.ok(rows.every(row => row.at && row.event));
        assert.deepEqual(rows.find(row => row.event.type === 'user').event,
            { type: 'user', text: 'hello', attachments: [] });
        assert.ok(rows.some(row => row.event.type === 'message.delta' && row.event.text === 'answer'));
        assert.deepEqual(rows.filter(row => row.event.type === 'message.delta').map(row => row.event.text), ['answer']);
        assert.deepEqual(rows.filter(row => row.event.type === 'thinking.delta').map(row => row.event.text), ['thinking']);
        assert.equal(rows.filter(row => row.event.type === 'tool' && row.event.status === 'running' &&
            row.event.kind === 'think').length, 0);
        await assert.rejects(service.loadTranscript(root, '../escape'), /ID/);
    });
});

test('resume keeps the history ID and appends to its transcript', async () => {
    await withFake(async ({ root, opening, service }) => {
        const first = await service.start({ agent: 'fake', cwd: root });
        opening.resolve();
        await service.send(first.chatId, 'first', []);
        await service.close(first.chatId);
        const resumed = await service.resume(root, first.chatId);
        assert.equal(resumed.chatId, first.chatId);
        await service.send(resumed.chatId, 'second', []);
        const rows = await service.loadTranscript(root, first.chatId);
        assert.deepEqual(rows.filter(row => row.event.type === 'user').map(row => row.event.text), ['first', 'second']);
        assert.deepEqual(rows.filter(row => row.event.type === 'message.delta').map(row => row.event.text), ['answer', 'answer']);
    });
});

test('close flushes unfinished transcript deltas', async () => {
    await withFake(async ({ root, opening, service, emitAdapter }) => {
        const started = await service.start({ agent: 'fake', cwd: root });
        opening.resolve();
        await service.listCommands(started.chatId);
        emitAdapter({ type: 'thinking.delta', id: 'thought', text: 'one' });
        emitAdapter({ type: 'thinking.delta', id: 'thought', text: 'two' });
        emitAdapter({ type: 'turn.end', ok: true });
        emitAdapter({ type: 'message.delta', id: 'unfinished', text: 'one' });
        emitAdapter({ type: 'message.delta', id: 'unfinished', text: 'two' });
        await service.close(started.chatId);
        const rows = await service.loadTranscript(root, started.chatId);
        assert.deepEqual(rows.filter(row => row.event.type === 'thinking.delta').map(row => row.event.text), ['onetwo']);
        assert.deepEqual(rows.filter(row => row.event.type === 'message.delta').map(row => row.event.text), ['onetwo']);
    });
});

test('Claude init commands distinguish skills and partial text is not duplicated', () => {
    const events = [];
    const parser = new ClaudeStreamParser('.', event => events.push(event));
    parser.accept({ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['edit-lint', 'help'], skills: ['edit-lint'] });
    assert.deepEqual(parser.skills, ['edit-lint']);
    parser.accept({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm' } } });
    parser.accept({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    parser.accept({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } });
    parser.accept({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    parser.accept({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'Hello' }] } });
    assert.equal(events.filter(event => event.type === 'message.delta').map(event => event.text).join(''), 'Hello');
    assert.equal(events.filter(event => event.type === 'message.end').length, 1);
});

test('project skills read frontmatter for Codex fallback', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'chat-skills-'));
    try {
        await mkdir(join(cwd, '.agents', 'skills', 'edit-lint'), { recursive: true });
        await writeFile(join(cwd, '.agents', 'skills', 'edit-lint', 'SKILL.md'),
            '---\nname: edit-lint\ndescription: Check an edit\n---\n');
        assert.deepEqual(await projectSkills(cwd), [{ name: 'edit-lint', description: 'Check an edit', kind: 'skill' }]);
    } finally { await rm(cwd, { recursive: true, force: true }); }
});
