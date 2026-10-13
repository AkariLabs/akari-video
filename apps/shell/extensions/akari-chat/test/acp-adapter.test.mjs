import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AcpAdapter, AcpSession } = require('../lib/node/adapters/acp.js');
const { acpAgents, acpCandidates } = require('../lib/node/adapters/acp-agents.js');
const fixture = fileURLToPath(new URL('./fixtures/acp/fake-agent.mjs', import.meta.url));

async function withSession(mode, run, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'akari-acp-'));
    const cwd = join(root, 'project');
    await mkdir(cwd);
    await writeFile(join(cwd, 'mode.txt'), mode);
    await writeFile(join(cwd, 'inside.txt'), 'inside text');
    await writeFile(join(root, 'outside.txt'), 'outside text');
    const definition = { ...acpAgents[0], args: [fixture] };
    const adapter = new AcpAdapter(definition, process.execPath);
    let session;
    try {
        session = await adapter.start({ cwd, permission: options.permission || 'auto', resume: options.resume,
            model: options.model, effort: options.effort });
        const events = [];
        session.onEvent(event => events.push(event));
        await run({ root, cwd, adapter, session, events });
    } finally {
        await session?.close();
        await rm(root, { recursive: true, force: true });
    }
}

async function packets(cwd) {
    return (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
}

test('prompt streams messages, thought, plan, tools, permission and finish', async () => {
    await withSession('normal', async ({ cwd, session, events }) => {
        assert.equal(session.sessionRef, 'session-fixed');
        assert.equal(events.length, 0);
        assert.equal((await session.capabilities()).models[1].id, 'large');
        assert.deepEqual((await session.capabilities()).efforts, ['low', 'high']);
        await session.send('hello', []);
        assert.equal(events[0].type, 'session');
        assert.equal(events.filter(event => event.type === 'session').length, 1);
        const types = events.map(event => event.type);
        assert.ok(types.indexOf('message.start') < types.indexOf('message.delta'));
        assert.equal(events.filter(event => event.type === 'message.delta').length, 2);
        assert.ok(events.some(event => event.type === 'message.end'));
        assert.deepEqual(events.filter(event => event.type === 'tool' && event.id === 'tool-1').map(event => event.status), ['running', 'done']);
        assert.equal(events.find(event => event.type === 'tool' && event.id === 'tool-1').detail.path, 'inside.txt');
        assert.ok(events.some(event => event.type === 'tool' && event.kind === 'think' && event.status === 'done'));
        assert.deepEqual(events.filter(event => event.type === 'thinking.delta').map(event => event.text), ['考え中']);
        assert.ok(events.some(event => event.type === 'tool' && event.title === '計画'));
        assert.equal((await session.capabilities()).compact, true);
        assert.deepEqual(await session.listCommands(), [{ name: 'compact', description: undefined, kind: 'command' }]);
        assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
        const received = await packets(cwd);
        assert.equal(received.find(packet => packet.method === 'session/request_permission'), undefined);
        assert.equal(received.find(packet => packet.id === 101).result.outcome.optionId, 'once');
        assert.equal(received.find(packet => packet.method === 'session/prompt').params.prompt[0].text, 'hello');
        await session.setModel('large');
        assert.equal((await packets(cwd)).at(-1).params.value, 'large');
    });
});

test('failed ACP startup kills a child that ignores SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-acp-exit-'));
    const script = join(root, 'agent.mjs');
    await writeFile(script, `import { writeFileSync } from 'node:fs';
writeFileSync('pid.txt', String(process.pid));
process.on('SIGTERM', () => {});
let buffer = '';
process.stdin.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\\n')) >= 0) {
        const row = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const packet = row.method === 'initialize'
            ? { id: row.id, result: { agentCapabilities: { loadSession: true } } }
            : { id: row.id, error: { code: -32001, message: 'start failed' } };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...packet }) + '\\n');
    }
});
setInterval(() => {}, 1000);
`);
    let pid;
    try {
        const adapter = new AcpAdapter({ ...acpAgents[0], args: [script] }, process.execPath);
        const session = await adapter.start({ cwd: root, permission: 'auto' });
        pid = Number(await readFile(join(root, 'pid.txt'), 'utf8'));
        assert.equal(session.initialError?.kind, 'other');
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
            try { process.kill(pid, 0); } catch (error) {
                if (error.code === 'ESRCH') { pid = undefined; break; }
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(pid, undefined);
        await session.close();
    } finally {
        if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        await rm(root, { recursive: true, force: true });
    }
});

test('available commands identify project skills and thought chunks stream', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-acp-commands-'));
    try {
        await mkdir(join(cwd, '.claude', 'skills', 'edit-lint'), { recursive: true });
        await mkdir(join(cwd, '.opencode', 'skills', 'local'), { recursive: true });
        await writeFile(join(cwd, '.claude', 'skills', 'edit-lint', 'SKILL.md'),
            '---\nname: edit-lint\ndescription: Skill description\n---\n');
        await writeFile(join(cwd, '.opencode', 'skills', 'local', 'SKILL.md'),
            '---\nname: local\ndescription: Local description\n---\n');
        const session = new AcpSession(acpAgents[0], undefined, { cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        session.handleUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [
            { name: 'edit-lint', description: 'ACP description' }, { name: 'local' }, { name: 'help', description: 'Help' }
        ] });
        assert.deepEqual(await session.listCommands(), [
            { name: 'edit-lint', description: 'ACP description', kind: 'skill' },
            { name: 'local', description: 'Local description', kind: 'skill' },
            { name: 'help', description: 'Help', kind: 'command' }
        ]);
        session.handleUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '考え' } });
        session.handleUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '中' } });
        assert.deepEqual(events.filter(event => event.type === 'thinking.delta').map(event => event.text), ['考え', '中']);
    } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('all permission prefers allow_always', async () => {
    await withSession('normal', async ({ cwd, session }) => {
        await session.send('hello', []);
        assert.equal((await packets(cwd)).find(packet => packet.id === 101).result.outcome.optionId, 'always');
    }, { permission: 'all' });
});

test('checkpoints asks before choosing an available allow option', async () => {
    await withSession('normal', async ({ cwd, session, events }) => {
        const asked = new Promise(resolve => {
            const subscription = session.onEvent(event => {
                if (event.type === 'ask') { subscription.dispose(); resolve(); }
            });
        });
        const turn = session.send('hello', []);
        await asked;
        assert.ok(events.some(event => event.type === 'ask'));
        await session.send('一度許可', []);
        await turn;
        assert.equal((await packets(cwd)).find(packet => packet.id === 101).result.outcome.optionId, 'once');
    }, { permission: 'checkpoints' });
});

test('measured Grok search and list updates use readable actions and omit empty other', async () => {
    const cwd = '/workspace/project';
    const session = new AcpSession(acpAgents[0], undefined, { cwd, permission: 'auto' });
    const events = [];
    session.onEvent(event => events.push(event));
    const rows = (await readFile(new URL('./fixtures/acp/grok-search-list.jsonl', import.meta.url), 'utf8'))
        .trim().split('\n').map(JSON.parse);
    for (const row of rows) session.toolUpdate(row.params.update);
    const search = events.filter(event => event.id?.includes('call-9a01ffc9-55c5-4c6d-a824-d9bbe58bd400-0'));
    const listing = events.filter(event => event.id?.includes('call-9a01ffc9-55c5-4c6d-a824-d9bbe58bd400-1'));
    assert.equal(search.at(-1).title, '検索しました edit.json');
    assert.equal(listing.at(-1).title, '一覧を見ました');
    assert.equal(listing.at(-1).detail.path, undefined);
    const count = events.length;
    session.toolUpdate({ toolCallId: 'empty', kind: 'other', status: 'completed' });
    assert.equal(events.length, count);
    session.toolUpdate({ toolCallId: 'empty-dot', kind: 'other', status: 'completed', locations: [{ path: './' }] });
    assert.equal(events.length, count);
    session.toolUpdate({ toolCallId: 'named-other', kind: 'other', title: 'mcp__akari__render', status: 'completed' });
    assert.equal(events.at(-1).title, '操作しました mcp__akari__render');
    session.toolUpdate({ toolCallId: 'described-other', kind: 'other', title: 'Rendered frame', status: 'completed',
        _meta: { 'x.ai/tool': { name: 'mcp__akari__render' } } });
    assert.equal(events.at(-1).title, '操作しました Rendered frame');
    session.toolUpdate({ toolCallId: 'kind-only', kind: 'mcp', status: 'completed' });
    assert.equal(events.at(-1).title, '操作しました mcp');
    session.toolUpdate({ toolCallId: 'list-kind', kind: 'other', status: 'completed',
        _meta: { 'x.ai/tool': { kind: 'list' } } });
    assert.equal(events.at(-1).title, '一覧を見ました');
    session.toolUpdate({ toolCallId: 'list-sub', kind: 'other', title: 'List `sub`', status: 'completed',
        locations: [{ path: '`sub`' }], _meta: { 'x.ai/tool': { name: 'list_dir', kind: 'list' } } });
    assert.equal(events.at(-1).title, '一覧を見ました sub');
    assert.equal(events.at(-1).detail.path, 'sub');
});

test('interrupt sends session/cancel and closes the turn', async () => {
    await withSession('cancel', async ({ cwd, session, events }) => {
        let promptSent;
        const prompt = new Promise(resolve => { promptSent = resolve; });
        const request = session.request.bind(session);
        session.request = (method, ...args) => {
            const result = request(method, ...args);
            if (method === 'session/prompt') promptSent();
            return result;
        };
        const turn = session.send('wait', []);
        await prompt;
        await session.interrupt();
        await turn;
        assert.ok((await packets(cwd)).some(packet => packet.method === 'session/cancel'));
        assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'interrupted' });
    });
});

test('resume loads the same session without replaying old updates', async () => {
    await withSession('normal', async ({ cwd, session, events }) => {
        assert.equal(session.sessionRef, 'saved-session');
        assert.equal(events.filter(event => event.type === 'message.delta').length, 0);
        assert.equal((await packets(cwd)).find(packet => packet.method === 'session/load').params.sessionId, 'saved-session');
    }, { resume: 'saved-session' });
});

test('permission without allow options emits ask and consumes numeric reply', async () => {
    await withSession('ask', async ({ cwd, session, events }) => {
        let askReceived;
        const asked = new Promise(resolve => { askReceived = resolve; });
        const subscription = session.onEvent(event => { if (event.type === 'ask') askReceived(); });
        const turn = session.send('first', []);
        await asked;
        subscription.dispose();
        assert.ok(events.some(event => event.type === 'ask'));
        await session.send('1', []);
        await turn;
        assert.equal((await packets(cwd)).find(packet => packet.id === 101).result.outcome.optionId, 'reject');
        assert.equal((await packets(cwd)).filter(packet => packet.method === 'session/prompt').length, 1);
    });
});

test('fs requests respect project root, including absolute paths and symlinks', async () => {
    await withSession('fs', async ({ root, cwd, session }) => {
        await symlink(join(root, 'outside.txt'), join(cwd, 'link.txt'));
        await session.send('fs', []);
        const replies = (await packets(cwd)).filter(packet => packet.id >= 101 && packet.id <= 105);
        assert.equal(replies.find(packet => packet.id === 101).result.content, 'inside text');
        assert.ok(replies.filter(packet => packet.id !== 101).every(packet => packet.error.code === -32001));
        assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), 'outside text');
    });
});

test('auth and missing executable surface classified errors', async () => {
    await withSession('auth', async ({ session, events }) => {
        assert.equal(session.initialError.kind, 'auth');
        assert.equal(events.length, 0);
        await session.send('test', []);
        assert.equal(events[0].kind, 'auth');
        assert.equal(events.at(-1).type, 'turn.end');
        assert.equal(events.at(-1).ok, false);
    });
    const root = await mkdtemp(join(tmpdir(), 'akari-acp-missing-'));
    try {
        const adapter = new AcpAdapter(acpAgents[0], undefined, { home: root, path: '' });
        assert.equal((await adapter.info()).installed, false);
        const session = await adapter.start({ cwd: root, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        assert.equal(session.initialError.kind, 'not-installed');
        await session.send('test', []);
        assert.equal(events[0].kind, 'not-installed');
        assert.deepEqual(events[1], { type: 'turn.end', ok: false, reason: 'not-installed' });
        await session.close();
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('catalog IDs and executable candidate order follow partner catalog', () => {
    const catalog = require('../../akari-partner/src/common/partner-catalog.json');
    const ids = new Set(catalog.map(item => item.agent));
    assert.deepEqual(acpAgents.map(agent => agent.id), ['opencode', 'gemini', 'copilot', 'grok']);
    for (const agent of acpAgents) {
        if (agent.id !== 'gemini') { assert.ok(ids.has(agent.id)); }
    }
    const candidates = acpCandidates(acpAgents[0], { home: 'test-home', path: 'test-path' });
    assert.match(candidates[0], /test-home.*\.local.*bin.*opencode/);
    assert.match(candidates[1], /test-home.*\.opencode.*bin.*opencode/);
});

test('initialize session capabilities allow session/close without session/new capabilities', async () => {
    await withSession('init-close', async ({ cwd, session }) => {
        await session.close();
        assert.ok((await packets(cwd)).some(packet => packet.method === 'session/close'));
    });
});

test('config options update in both forms, command title and usage match ACP notifications', async () => {
    await withSession('measured-updates', async ({ session, events }) => {
        await session.send('updates', []);
        const capabilities = await session.capabilities();
        assert.deepEqual(capabilities.models.map(model => model.id), ['new-model']);
        assert.deepEqual(capabilities.efforts, ['medium']);
        const command = events.filter(event => event.type === 'tool' && event.id === 'execute-1');
        assert.deepEqual(command.map(event => event.title), ['実行しています node --version', '実行しました node --version']);
        assert.equal(command[0].detail.command, 'node --version');
        assert.equal(events.find(event => event.type === 'tool' && event.id === 'read-1').title, '読んでいます');
        assert.equal(events.find(event => event.type === 'tool' && event.id === 'search-1').title, '失敗しました needle');
        assert.deepEqual(events.find(event => event.type === 'usage'), { type: 'usage', usedTokens: 42, contextWindow: 1000 });
    });
});

test('process exit during prompt is crashed and ends the turn', async () => {
    await withSession('crash', async ({ session, events }) => {
        await session.send('crash', []);
        assert.ok(events.some(event => event.type === 'error' && event.kind === 'crashed'));
        assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'crashed' });
    });
});

test('auth error includes a redacted agent reason', async () => {
    await withSession('auth-reason', async ({ session }) => {
        assert.equal(session.initialError.kind, 'auth');
        assert.match(session.initialError.message, /This client is no longer supported/);
        assert.match(session.initialError.message, /\[伏せ字\]/);
        assert.equal(session.initialError.message.includes(`person${String.fromCharCode(64)}example.test`), false);
        assert.doesNotMatch(session.initialError.message, /A{32}/);
    });
});

test('failed initial model selection leaves a usable session without an error event', async () => {
    await withSession('model-error', async ({ cwd, session, events }) => {
        assert.equal(events.length, 0);
        assert.equal(events.some(event => event.type === 'error'), false);
        await session.send('still works', []);
        assert.equal(events[0].type, 'session');
        assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
        assert.ok((await packets(cwd)).some(packet => packet.method === 'session/set_config_option'));
    }, { model: 'large' });
});

test('start applies only models advertised by the selected agent', async () => {
    await withSession('normal', async ({ cwd }) => {
        assert.equal((await packets(cwd)).some(packet => packet.method === 'session/set_config_option'), false);
    }, { model: 'sonnet' });
    await withSession('normal', async ({ cwd }) => {
        assert.equal((await packets(cwd)).find(packet => packet.method === 'session/set_config_option').params.value, 'large');
    }, { model: 'large' });
    await withSession('models-list', async ({ cwd }) => {
        assert.equal((await packets(cwd)).find(packet => packet.method === 'session/set_model').params.modelId, 'another');
    }, { model: 'another' });
    assert.equal(acpAgents.find(agent => agent.id === 'copilot').modelArgs, undefined);
});

test('initialize, new and load requests allow 600 seconds', async () => {
    for (const [mode, method, resume] of [
        ['hold-initialize', 'initialize', undefined],
        ['hold-session-new', 'session/new', undefined],
        ['hold-session-load', 'session/load', 'saved-session']
    ]) {
        const root = await mkdtemp(join(tmpdir(), 'akari-acp-timeout-'));
        const cwd = join(root, 'project');
        await mkdir(cwd);
        await writeFile(join(cwd, 'mode.txt'), mode);
        const session = new AcpSession({ ...acpAgents[0], args: [fixture] }, process.execPath,
            { cwd, resume, permission: 'auto' });
        try {
            let requested;
            const requestSent = new Promise(resolve => { requested = resolve; });
            const request = session.request.bind(session);
            session.request = (name, ...args) => {
                const result = request(name, ...args);
                if (name === method) requested();
                return result;
            };
            const opening = session.open();
            await requestSent;
            assert.equal([...session.pending.values()][0].timer._idleTimeout, 600000, method);
            await session.close();
            await opening;
        } finally {
            await session.close();
            await rm(root, { recursive: true, force: true });
        }
    }
});

test('clear session/new also allows 600 seconds', async () => {
    await withSession('hold-clear', async ({ cwd, session }) => {
        let requested;
        const requestSent = new Promise(resolve => { requested = resolve; });
        const request = session.request.bind(session);
        session.request = (name, ...args) => {
            const result = request(name, ...args);
            if (name === 'session/new') requested();
            return result;
        };
        const clearing = session.clear();
        await requestSent;
        assert.equal([...session.pending.values()][0].timer._idleTimeout, 600000);
        await session.close();
        await assert.rejects(clearing, /closed/);
    });
});

test('stderr rate logs do not classify an unrelated request failure as rate-limit', async () => {
    await withSession('stderr-noise', async ({ session, events }) => {
        await session.send('fail', []);
        assert.equal(events.find(event => event.type === 'error').kind, 'other');
        assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'other' });
    });
});

test('rate-limit classification requires a specific rate signal', async () => {
    await withSession('rate-error', async ({ session, events }) => {
        await session.send('fail', []);
        assert.equal(events.find(event => event.type === 'error').kind, 'rate-limit');
    });
    await withSession('limit-word', async ({ session, events }) => {
        await session.send('fail', []);
        assert.equal(events.find(event => event.type === 'error').kind, 'other');
    });
});

test('session/prompt has no timer and remains pending until interrupted', async () => {
    await withSession('cancel', async ({ session }) => {
        let requested;
        const requestSent = new Promise(resolve => { requested = resolve; });
        const request = session.request.bind(session);
        session.request = (name, ...args) => {
            const result = request(name, ...args);
            if (name === 'session/prompt') requested();
            return result;
        };
        const turn = session.send('wait', []);
        await requestSent;
        assert.equal(session.pending.size, 1);
        assert.equal([...session.pending.values()][0].timer, undefined);
        await session.interrupt();
        await turn;
    });
});

test('search and file tool titles use project-relative paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-acp-title-'));
    try {
        const session = new AcpSession(acpAgents[0], undefined, { cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        session.toolUpdate({ toolCallId: 'search', kind: 'search', title: cwd.slice(1), status: 'in_progress' });
        session.toolUpdate({ toolCallId: 'read', kind: 'read', title: `${cwd}/inside.txt`,
            locations: [{ path: `${cwd}/inside.txt` }], status: 'in_progress' });
        assert.equal(events[0].title, '検索しています');
        assert.equal(events[1].title, '読んでいます inside.txt');
        assert.equal(events[1].detail.path, 'inside.txt');
    } finally { await rm(cwd, { recursive: true, force: true }); }
});
