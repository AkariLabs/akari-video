import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AkariChatServiceImpl } = require('../lib/node/akari-chat-service.js');
const { AkariChatSessionRegistry } = require('../lib/node/akari-chat-backend-module.js');
const backendModule = require('../lib/node/akari-chat-backend-module.js').default;
const { Container } = require('@theia/core/shared/inversify');
const { ConnectionContainerModule } = require('@theia/core/lib/node/messaging/connection-container-module');
const { ConnectionHandler } = require('@theia/core/lib/common/messaging');
const { BackendApplicationContribution } = require('@theia/core/lib/node/backend-application');
const { chatAdapters } = require('../lib/node/adapters/index.js');
const { AcpSession } = require('../lib/node/adapters/acp.js');
const { appendTranscript, loadTranscript } = require('../lib/node/chat-storage.js');
const { terminateChild } = require('../lib/node/adapters/terminate.js');

async function project(run) {
    const root = await mkdtemp(join(tmpdir(), 'akari-chat-hardening-'));
    const cwd = join(root, 'project');
    await mkdir(join(cwd, '.akari'), { recursive: true });
    try { await run(root, cwd); } finally { await rm(root, { recursive: true, force: true }); }
}

function fakeAdapter(closed) {
    return {
        info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
        start: async () => ({
            sessionRef: 'ref', capabilities: async () => ({ models: [], images: false, interrupt: true,
                clear: false, compact: false, resume: true, ask: false }),
            onEvent: () => ({ dispose() {} }), send: async () => {}, interrupt: async () => {},
            close: async () => { closed.count++; }
        })
    };
}

test('connection cleanup closes only its sessions and backend stop closes the rest', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        const closedA = { count: 0 }, closedB = { count: 0 };
        try {
            const a = new AkariChatServiceImpl();
            const b = new AkariChatServiceImpl();
            const registry = new AkariChatSessionRegistry();
            chatAdapters.push(fakeAdapter(closedA));
            const first = await a.start({ agent: 'fake', cwd });
            const second = await a.start({ agent: 'fake', cwd });
            await Promise.all([a.sessions.get(first.chatId).ready, a.sessions.get(second.chatId).ready]);
            chatAdapters.splice(0, chatAdapters.length, fakeAdapter(closedB));
            const other = await b.start({ agent: 'fake', cwd });
            await b.sessions.get(other.chatId).ready;
            registry.add(a);
            registry.add(b);
            await a.closeAll();
            assert.equal(closedA.count, 2);
            assert.equal(closedB.count, 0);
            await assert.rejects(a.send(first.chatId, 'stale', []), /見つかりません/);
            await assert.rejects(a.send(second.chatId, 'stale', []), /見つかりません/);
            await b.send(other.chatId, 'alive', []);
            chatAdapters.splice(0, chatAdapters.length, fakeAdapter(closedA));
            const fresh = await a.start({ agent: 'fake', cwd });
            await a.sessions.get(fresh.chatId).ready;
            await a.send(fresh.chatId, 'new session', []);
            await registry.remove(a);
            assert.equal(closedA.count, 3);
            assert.equal(closedB.count, 0);
            await registry.onStop();
            assert.equal(closedB.count, 1);
        } finally { chatAdapters.splice(0, chatAdapters.length, ...original); }
    });
});

test('RPC disconnect hook disposes its connection service while other clients remain active', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        const closed = { count: 0 };
        chatAdapters.push(fakeAdapter(closed));
        try {
            const root = new Container();
            root.load(backendModule);
            const connect = () => {
                const container = root.createChild();
                container.load(...root.getAll(ConnectionContainerModule));
                let disconnect;
                const client = { onEvent() {}, onDidCloseConnection(callback) { disconnect = callback; } };
                const handler = container.getAll(ConnectionHandler).find(value => value.path === '/services/akari-chat');
                return { service: handler.targetFactory(client), disconnect: () => disconnect() };
            };
            const a = connect(), b = connect();
            assert.notEqual(a.service, b.service);
            const first = await a.service.start({ agent: 'fake', cwd });
            const second = await a.service.start({ agent: 'fake', cwd });
            const other = await b.service.start({ agent: 'fake', cwd });
            await Promise.all([a.service.sessions.get(first.chatId).ready,
                a.service.sessions.get(second.chatId).ready, b.service.sessions.get(other.chatId).ready]);
            a.disconnect();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(closed.count, 2);
            await b.service.send(other.chatId, 'alive', []);
            await root.get(BackendApplicationContribution).onStop();
            assert.equal(closed.count, 3);
        } finally { chatAdapters.splice(0, chatAdapters.length, ...original); }
    });
});

test('backend stop waits for a disconnect already disposing a stopped service', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        let child;
        chatAdapters.push({ info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
            start: async () => {
                child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {});
process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`],
                { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
                await once(child.stdout, 'data');
                return { sessionRef: 'ref', capabilities: async () => ({}),
                    onEvent: () => ({ dispose() {} }), send: async () => {}, interrupt: async () => {},
                    close: () => terminateChild(child) };
            } });
        try {
            const registry = new AkariChatSessionRegistry();
            const service = new AkariChatServiceImpl();
            registry.add(service);
            const { chatId } = await service.start({ agent: 'fake', cwd });
            await service.sessions.get(chatId).ready;
            void registry.remove(service);
            await registry.onStop();
            assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
        } finally {
            if (child?.pid) {
                try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {}
            }
            chatAdapters.splice(0, chatAdapters.length, ...original);
        }
    });
});

test('disconnect and backend stop terminate children owned by their connections', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        const children = [];
        chatAdapters.push({ info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
            start: async () => {
                const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
                await once(child, 'spawn');
                children.push(child);
                return { sessionRef: 'ref', capabilities: async () => ({}),
                    onEvent: () => ({ dispose() {} }), send: async () => {}, interrupt: async () => {},
                    close: async () => { child.kill('SIGTERM'); await once(child, 'exit'); } };
            } });
        try {
            const root = new Container();
            root.load(backendModule);
            const connect = () => {
                const container = root.createChild();
                container.load(...root.getAll(ConnectionContainerModule));
                let disconnect;
                const handler = container.getAll(ConnectionHandler).find(value => value.path === '/services/akari-chat');
                const service = handler.targetFactory({ onEvent() {}, onDidCloseConnection(callback) { disconnect = callback; } });
                return { service, disconnect: () => disconnect() };
            };
            const a = connect(), b = connect();
            const first = await a.service.start({ agent: 'fake', cwd });
            const second = await a.service.start({ agent: 'fake', cwd });
            const other = await b.service.start({ agent: 'fake', cwd });
            await Promise.all([a.service.sessions.get(first.chatId).ready,
                a.service.sessions.get(second.chatId).ready, b.service.sessions.get(other.chatId).ready]);
            a.disconnect();
            await Promise.all(children.slice(0, 2).map(child => once(child, 'exit')));
            assert.ok(children.slice(0, 2).every(child => child.exitCode !== null || child.signalCode !== null));
            assert.equal(children[2].exitCode, null);
            await root.get(BackendApplicationContribution).onStop();
            assert.ok(children[2].exitCode !== null || children[2].signalCode !== null);
        } finally {
            for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            chatAdapters.splice(0, chatAdapters.length, ...original);
        }
    });
});

test('closeAll also closes a child returned by an in-flight start', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        let finishStart;
        let closed = 0;
        chatAdapters.push({ info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
            start: async () => new Promise(resolve => { finishStart = () => resolve({
                sessionRef: 'ref', capabilities: async () => ({}), onEvent: () => ({ dispose() {} }),
                send: async () => {}, interrupt: async () => {}, close: async () => { closed++; }
            }); }) });
        try {
            const service = new AkariChatServiceImpl();
            const { chatId } = await service.start({ agent: 'fake', cwd });
            await new Promise(resolve => setImmediate(resolve));
            const stopping = service.closeAll();
            finishStart();
            await stopping;
            assert.equal(closed, 1);
            await assert.rejects(service.send(chatId, 'stale', []), /見つかりません/);
        } finally { chatAdapters.splice(0, chatAdapters.length, ...original); }
    });
});

test('cwd must be a project or a directory beneath a creator root', async () => {
    await project(async (root, cwd) => {
        const service = new AkariChatServiceImpl();
        const outside = join(root, 'outside');
        await mkdir(outside);
        await assert.rejects(service.listHistory(outside), /AKARI/);
        await assert.rejects(service.listHistory(join(root, 'missing')));
        const file = join(root, 'file.txt');
        await writeFile(file, 'x');
        await assert.rejects(service.listHistory(file), /作業フォルダ/);
        await service.listHistory(cwd);
        const nested = join(outside, 'nested');
        await mkdir(nested);
        await assert.rejects(service.listHistory(nested), /AKARI/);
        await mkdir(join(outside, '.akari'));
        await writeFile(join(outside, '.akari', 'root.json'), JSON.stringify({ schema: 'creator-root/v1' }));
        await service.listHistory(nested);
        const wrong = join(root, 'wrong');
        const broken = join(root, 'broken');
        for (const [folder, manifest] of [[wrong, JSON.stringify({ schema: 'other/v1' })], [broken, '{']]) {
            await mkdir(join(folder, '.akari'), { recursive: true });
            await mkdir(join(folder, 'nested'));
            await writeFile(join(folder, '.akari', 'root.json'), manifest);
            await assert.rejects(service.listHistory(join(folder, 'nested')), /AKARI/);
        }
        const calls = [
            () => service.start({ agent: 'fake', cwd: file }),
            () => service.loadTranscript(file, 'c-valid'),
            () => service.renameHistory(file, 'c-valid', 'title'),
            () => service.removeHistory(file, 'c-valid'),
            () => service.saveScreenRecording(file, 'data:video/mp4;base64,eA=='),
            () => service.importAttachment(file, file),
            () => service.resume(file, 'c-valid')
        ];
        for (const call of calls) await assert.rejects(call(), /作業フォルダ/);
    });
});

test('sourcePath accepts regular files and regular link targets only', async () => {
    await project(async (root, cwd) => {
        const service = new AkariChatServiceImpl();
        const regular = join(root, 'regular.txt');
        await writeFile(regular, 'hello');
        const link = join(root, 'link.txt');
        await symlink(regular, link);
        assert.match(await service.importAttachment(cwd, link), /^assets\//);
        for (const path of [root, join(root, 'missing')]) {
            await assert.rejects(service.importAttachment(cwd, path));
        }
        const dirLink = join(root, 'dir-link');
        await symlink(root, dirLink);
        await assert.rejects(service.importAttachment(cwd, dirLink), /通常のファイル/);
        if (process.platform !== 'win32') {
            const fifo = join(root, 'pipe');
            if (spawnSync('mkfifo', [fifo]).status === 0) {
                await assert.rejects(service.importAttachment(cwd, fifo), /通常のファイル/);
            }
        }
    });
});

test('failed startup send returns retry error without recording a user row', async () => {
    await project(async (_root, cwd) => {
        const original = chatAdapters.splice(0);
        chatAdapters.push({ info: async () => ({ id: 'fake', name: 'Fake', installed: true, transport: 'acp' }),
            start: async () => { throw new Error('launch failed'); } });
        try {
            const service = new AkariChatServiceImpl();
            const events = [];
            service.setClient({ onEvent: (_id, event) => events.push(event) });
            const { chatId } = await service.start({ agent: 'fake', cwd });
            await assert.rejects(service.send(chatId, 'do not record', []), /akari-chat:not-delivered/);
            assert.ok(events.some(event => event.type === 'error' && /やり直して/.test(event.message)));
            assert.ok(events.some(event => event.type === 'turn.end' && !event.ok));
            assert.equal((await loadTranscript(cwd, chatId)).filter(row => row.event.type === 'user').length, 0);
            await service.dispose();
        } finally { chatAdapters.splice(0, chatAdapters.length, ...original); }
    });
});

test('transcript strips review images while retaining label and time', async () => {
    await project(async (_root, cwd) => {
        const id = 'c-test';
        await appendTranscript(cwd, id, { type: 'user', text: 'review', attachments: [{ kind: 'review',
            label: '確認 3.0秒', review: { tool: 'pin', source: 'edit.json', sourceLabel: '確認',
                time: 3, text: 'fix', thumbnail: 'data:image/jpeg;base64,AAAA' } }] });
        const raw = await readFile(join(cwd, '.akari', 'chat', 'transcripts', `${id}.jsonl`), 'utf8');
        assert.doesNotMatch(raw, /data:image/);
        assert.equal((await loadTranscript(cwd, id))[0].event.attachments[0].review.time, 3);
        assert.match(raw, /確認 3.0秒/);
    });
});

test('ACP refuses final symlinks and a parent swapped outside before writing', async () => {
    await project(async (root, cwd) => {
        const outside = join(root, 'outside');
        await mkdir(outside);
        const target = join(outside, 'target.txt');
        await writeFile(target, 'safe');
        await symlink(target, join(cwd, 'link.txt'));
        const session = new AcpSession({ id: 'fake', args: [], installHint: '' }, 'unused', { cwd, permission: 'auto' });
        session.ref = 'ref';
        const replies = [];
        session.reply = (id, value) => replies.push({ id, value });
        session.rpcError = (id, code, message) => replies.push({ id, code, message });
        await session.handleAgentRequest(1, 'fs/write_text_file', { sessionId: 'ref', path: 'link.txt', content: 'bad' });
        assert.ok(replies[0].code);
        assert.equal(await readFile(target, 'utf8'), 'safe');
        const swap = join(cwd, 'swap.txt');
        await writeFile(swap, 'inside');
        const originalSafePath = session.safePath.bind(session);
        session.safePath = async (...args) => {
            const checked = await originalSafePath(...args);
            await unlink(swap);
            await symlink(target, swap);
            return checked;
        };
        await session.handleAgentRequest(2, 'fs/write_text_file', { sessionId: 'ref', path: 'swap.txt', content: 'bad' });
        assert.ok(replies[1].code);
        assert.equal(await readFile(target, 'utf8'), 'safe');
        const parent = join(cwd, 'parent');
        const inside = join(cwd, 'inside');
        await mkdir(inside);
        await symlink(inside, parent);
        const safePath = originalSafePath;
        session.safePath = async (...args) => {
            const checked = await safePath(...args);
            await unlink(parent);
            await symlink(outside, parent);
            return checked;
        };
        await session.handleAgentRequest(3, 'fs/write_text_file', { sessionId: 'ref', path: 'parent/target.txt', content: 'bad' });
        assert.ok(replies[2].code);
        assert.equal(await readFile(target, 'utf8'), 'safe');
        await session.close();
    });
});
