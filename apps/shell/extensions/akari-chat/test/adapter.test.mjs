import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const {
    ClaudeStreamParser,
    ClaudeStreamJsonAdapter,
    claudeUserMessage,
    normalizeClaudeModel
} = require('../lib/node/adapters/claude-stream-json.js');
const { describeAttachments, reviewTimeSpan } = require('../lib/common/chat-attachments.js');
const {
    addHistory,
    updateHistory,
    titleFromText,
    readHistory,
    writeHistory
} = require('../lib/node/history.js');
const { renderMarkdown } = require('../lib/browser/markdown.js');
const { isChatDropTarget } = require('../lib/browser/chat-drop-target.js');

async function parseFixture(name) {
    const source = await readFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), 'utf8');
    const rows = source.trim().split('\n').map(JSON.parse);
    const events = [];
    const parser = new ClaudeStreamParser('/project', event => events.push(event));
    for (const row of rows) {
        parser.accept(row);
    }
    return { rows, events, parser };
}

async function fakeExecutable(cwd) {
    const script = join(cwd, 'fake-claude');
    await writeFile(script, `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--version')) {
    console.log('test');
    process.exit(0);
}
const mode = fs.existsSync('mode.txt') ? fs.readFileSync('mode.txt', 'utf8').trim() : 'persistent';
if (mode === 'resume-init-exit') process.exit(2);
if (mode === 'hold-input-close') setInterval(() => {}, 1000);
if (mode === 'interrupt-result') process.on('SIGINT', () => {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true }) + '\\n', () => process.exit(0));
});
fs.appendFileSync('args.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const user = JSON.parse(line);
        fs.appendFileSync('received.jsonl', JSON.stringify(user) + '\\n');
        if (mode === 'permission') {
            if (user.type === 'control_response') {
                console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false }));
            } else {
                console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-fixed' }));
                console.log(fs.readFileSync('permission-request.json', 'utf8'));
            }
            continue;
        }
        console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-fixed', model: 'claude-haiku-5-5', slash_commands: ['edit-lint', 'help'], skills: ['edit-lint'] }));
        if (mode === 'hold-turn' || mode === 'interrupt-result') continue;
        console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000 } } }));
        if (mode === 'exit') setTimeout(() => process.exit(0), 5);
    }
});
`);
    await chmod(script, 0o755);
    return script;
}

async function withTempDirectory(prefix, run) {
    const cwd = await mkdtemp(join(tmpdir(), prefix));
    try {
        return await run(cwd);
    } finally {
        await rm(cwd, { recursive: true, force: true });
    }
}

function userText(message) {
    return message.message.content.find(part => part.type === 'text').text;
}

test('Claude lists initialized skills and restarts immediately with resume on model change', async () => {
    await withTempDirectory('akari-chat-immediate-', async cwd => {
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto', resume: 'session-fixed' });
        try {
            await session.send('hello', []);
            assert.deepEqual(await session.listCommands(), [
                { name: 'edit-lint', kind: 'skill' }, { name: 'help', kind: 'command' }
            ]);
            await session.setModel('haiku');
            for (let attempt = 0; attempt < 500; attempt++) {
                const lines = (await readFile(join(cwd, 'args.jsonl'), 'utf8')).trim().split('\n');
                if (lines.length >= 2) {
                    const args = JSON.parse(lines.at(-1));
                    assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', 'session-fixed']);
                    assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'haiku']);
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.fail('Claude did not restart after model change');
        } finally { await session.close(); }
    });
});

test('Claude resume process exit before init reports a missing conversation', async () => {
    await withTempDirectory('akari-chat-resume-', async cwd => {
        await writeFile(join(cwd, 'mode.txt'), 'resume-init-exit');
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto', resume: 'missing' });
        try {
            for (let attempt = 0; attempt < 100 && !session.initialError; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            assert.equal(session.initialError?.message, 'No conversation found');
        } finally { await session.close(); }
    });
});

test('review range uses the same time span in attachment text and chip', () => {
    const mark = { tool: 'range', source: 'preview', sourceLabel: '編集中のプレビュー', time: 20, timeEnd: 24, text: '確認' };
    assert.equal(reviewTimeSpan(mark), '0:20〜0:24');
    assert.match(describeAttachments([{ kind: 'review', label: '範囲', review: mark }]), /0:20〜0:24/);
});

test('Claude lists project and enabled plugin skills before init, then uses init commands', async () => {
    const root = await mkdtemp(join(process.cwd(), 'test', 'claude-commands-'));
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    const previousHome = process.env.HOME;
    const skill = async (directory, name, description) => {
        await mkdir(join(directory, name), { recursive: true });
        await writeFile(join(directory, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`);
    };
    try {
        await mkdir(cwd, { recursive: true });
        await skill(join(cwd, '.claude', 'skills'), 'edit-lint', '編集を検査');
        await skill(join(cwd, '.agents', 'skills'), 'project-only', '案件のスキル');
        const userPlugin = join(root, 'user-plugin');
        const projectPlugin = join(root, 'project-plugin');
        const disabledPlugin = join(root, 'disabled-plugin');
        await skill(join(userPlugin, 'skills'), 'draft', '下書きを作る');
        await skill(join(projectPlugin, 'skills'), 'review', '内容を確認');
        await skill(join(disabledPlugin, 'skills'), 'hidden', '表示しない');
        await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
        await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5', enabledPlugins: {
            'writing@market': true, 'project@market': true, 'disabled@market': false
        } }));
        await writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
            'writing@market': [{ scope: 'user', installPath: userPlugin }],
            'project@market': [{ scope: 'project', projectPath: cwd, installPath: projectPlugin }],
            'disabled@market': [{ scope: 'user', installPath: disabledPlugin }]
        } }));
        process.env.HOME = home;
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            const before = await session.listCommands();
            assert.deepEqual(before, [
                { name: 'edit-lint', description: '編集を検査', kind: 'skill' },
                { name: 'project-only', description: '案件のスキル', kind: 'skill' },
                { name: 'writing:draft', description: '下書きを作る', kind: 'skill' },
                { name: 'project:review', description: '内容を確認', kind: 'skill' }
            ]);
            const capabilities = await session.capabilities();
            assert.deepEqual(capabilities.models.map(model => model.id), ['opus', 'sonnet', 'haiku', 'fable']);
            assert.equal(capabilities.currentModel, 'haiku');
            assert.equal(normalizeClaudeModel('claude-opus-5-1'), 'opus');
            assert.equal(normalizeClaudeModel('sonnet'), 'sonnet');
            assert.equal(normalizeClaudeModel('fable'), 'fable');
            assert.equal(normalizeClaudeModel('other'), undefined);
            await writeFile(join(home, '.claude', 'settings.json'), '{broken');
            assert.deepEqual((await session.listCommands()).map(command => command.name), ['edit-lint', 'project-only']);
            await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5', enabledPlugins: {
                'writing@market': true, 'project@market': true, 'disabled@market': false
            } }));
            await session.send('hello', []);
            assert.deepEqual(await session.listCommands(), [
                { name: 'edit-lint', description: '編集を検査', kind: 'skill' },
                { name: 'help', kind: 'command' }
            ]);
        } finally { await session.close(); }
    } finally {
        if (previousHome === undefined) delete process.env.HOME;
        else process.env.HOME = previousHome;
        await rm(root, { recursive: true, force: true });
    }
});

test('measured Claude manual permission request answers through control_response', async () => {
    await withTempDirectory('akari-chat-permission-', async cwd => {
        const rows = (await readFile(new URL('./fixtures/claude-permission-manual.jsonl', import.meta.url), 'utf8'))
            .trim().split('\n').map(JSON.parse);
        const request = rows.find(row => row.type === 'control_request' && row.request?.subtype === 'can_use_tool');
        assert.ok(request);
        await writeFile(join(cwd, 'mode.txt'), 'permission');
        await writeFile(join(cwd, 'permission-request.json'), JSON.stringify(request));
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'checkpoints' });
        try {
            const tools = [];
            session.onEvent(event => { if (event.type === 'tool') tools.push(event); });
            const asked = new Promise(resolve => {
                const subscription = session.onEvent(event => {
                    if (event.type === 'ask') { subscription.dispose(); resolve(event); }
                });
            });
            const turn = session.send('write', []);
            const ask = await asked;
            assert.deepEqual(ask.options.map(option => option.label), ['許可', '拒否']);
            assert.equal(ask.question, `${request.request.tool_name} を許可しますか？ ${request.request.description}`);
            assert.equal(tools.at(-1).id, request.request.tool_use_id);
            assert.equal(tools.at(-1).status, 'running');
            assert.match(tools.at(-1).title, /^書いています .*hello\.txt$/);
            await session.send('許可', []);
            await turn;
            const responses = (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
            assert.deepEqual(responses[1], { type: 'control_response', response: {
                subtype: 'success', request_id: request.request_id,
                response: { behavior: 'allow', updatedInput: request.request.input }
            } });
            const args = JSON.parse((await readFile(join(cwd, 'args.jsonl'), 'utf8')).trim());
            assert.equal(args[args.indexOf('--permission-mode') + 1], 'default');
            assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'stdio');
        } finally { await session.close(); }
    });
});

test('measured Claude permission keeps a write pending until tool_result', async () => {
    const rows = (await readFile(new URL('./fixtures/claude-permission-manual.jsonl', import.meta.url), 'utf8'))
        .trim().split('\n').map(JSON.parse);
    const events = [];
    const parser = new ClaudeStreamParser('/workspace/project', event => events.push(event));
    for (const row of rows.slice(0, 17)) parser.accept(row);
    const request = rows[17].request;
    parser.permissionPending(request.tool_use_id, request.tool_name, request.input);
    assert.equal(events.filter(event => event.type === 'tool' && event.id === request.tool_use_id).at(-1).title,
        '書いています hello.txt');
    assert.equal(events.filter(event => event.type === 'tool' && event.id === request.tool_use_id).at(-1).status,
        'running');
    parser.accept(rows[18]);
    const denied = events.filter(event => event.type === 'tool' && event.id === request.tool_use_id).at(-1);
    assert.equal(denied.status, 'error');
    assert.equal(denied.title, '止められました hello.txt');
    const success = [];
    const accepted = new ClaudeStreamParser('/workspace/project', event => success.push(event));
    accepted.accept(rows[15]);
    accepted.permissionPending(request.tool_use_id, request.tool_name, request.input);
    accepted.accept({ type: 'user', message: { content: [{ type: 'tool_result',
        tool_use_id: request.tool_use_id, content: 'ok' }] } });
    assert.equal(success.filter(event => event.type === 'tool').at(-1).status, 'done');
    assert.equal(success.filter(event => event.type === 'tool').at(-1).title, '書きました hello.txt');
});

test('closing Claude while permission is pending sends a denial', async () => {
    await withTempDirectory('akari-chat-denial-', async cwd => {
        const rows = (await readFile(new URL('./fixtures/claude-permission-manual.jsonl', import.meta.url), 'utf8'))
            .trim().split('\n').map(JSON.parse);
        const request = rows.find(row => row.type === 'control_request' && row.request?.subtype === 'can_use_tool');
        await writeFile(join(cwd, 'mode.txt'), 'permission');
        await writeFile(join(cwd, 'permission-request.json'), JSON.stringify(request));
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'checkpoints' });
        const asked = new Promise(resolve => {
            const subscription = session.onEvent(event => {
                if (event.type === 'ask') { subscription.dispose(); resolve(); }
            });
        });
        const turn = session.send('write', []).catch(() => undefined);
        await asked;
        const packets = [];
        const write = session.child.stdin.write.bind(session.child.stdin);
        session.child.stdin.write = (chunk, callback) => {
            const packet = JSON.parse(String(chunk));
            if (packet.type === 'control_response') packets.push(packet);
            return write(chunk, callback);
        };
        await session.close();
        await turn;
        assert.equal(packets[0].response.request_id, request.request_id);
        assert.equal(packets[0].response.response.behavior, 'deny');
    });
});

test('Claude permission question omits missing description', async () => {
    await withTempDirectory('akari-chat-question-', async cwd => {
        const rows = (await readFile(new URL('./fixtures/claude-permission-manual.jsonl', import.meta.url), 'utf8'))
            .trim().split('\n').map(JSON.parse);
        const request = rows.find(row => row.type === 'control_request' && row.request?.subtype === 'can_use_tool');
        delete request.request.description;
        await writeFile(join(cwd, 'mode.txt'), 'permission');
        await writeFile(join(cwd, 'permission-request.json'), JSON.stringify(request));
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'checkpoints' });
        try {
            const asked = new Promise(resolve => {
                const subscription = session.onEvent(event => {
                    if (event.type === 'ask') { subscription.dispose(); resolve(event); }
                });
            });
            const turn = session.send('write', []);
            assert.equal((await asked).question, `${request.request.tool_name} を許可しますか？`);
            await session.send('拒否', []);
            await turn;
        } finally { await session.close(); }
    });
});

test('drop target predicate claims only chat descendants', () => {
    const chatRoot = { closest: selector => selector === '[data-akari-chat]' ? chatRoot : null };
    const child = { closest: selector => selector === '[data-akari-chat]' ? chatRoot : null };
    const textNode = { parentElement: child };
    const outside = { closest: () => null };
    assert.equal(isChatDropTarget(chatRoot), true);
    assert.equal(isChatDropTarget(child), true);
    assert.equal(isChatDropTarget(textNode), true);
    assert.equal(isChatDropTarget(outside), false);
    assert.equal(isChatDropTarget(null), false);
});

test('measured stream emits each thinking block once and converts tools and text deltas', async () => {
    const { rows, events, parser } = await parseFixture('run1');
    assert.ok(rows.some(row => row.type === 'stream_event' && row.event.type === 'content_block_delta'));
    assert.equal(events.filter(event => event.type === 'tool' && event.kind === 'think').length, 1);
    assert.deepEqual(
        [...new Set(events.filter(event => event.type === 'tool').map(event => event.kind))],
        ['think', 'read', 'command', 'write']
    );
    assert.ok(events.filter(event => event.type === 'message.delta').length > 1);
    assert.ok(events.some(event => event.type === 'message.delta' && event.text.includes('| 項目 |')));
    assert.deepEqual(events.find(event => event.type === 'usage'), {
        type: 'usage',
        usedTokens: 31667,
        contextWindow: 1000000
    });
    assert.equal(events.at(-1).type, 'turn.end');
    assert.equal(events.at(-1).ok, true);
    assert.equal(parser.sessionId, 'session-fixed');
    assert.deepEqual(parser.skills, ['edit-lint']);
    const read = events.find(event => event.type === 'tool' && event.kind === 'read');
    assert.equal(read.title, '読みました CLAUDE.md');
    assert.equal(read.detail.path, 'CLAUDE.md');
});

test('measured edit result retains structured patch, relative path and file event', async () => {
    const { rows, events } = await parseFixture('run4');
    assert.ok(rows.some(row => row.tool_use_result?.structuredPatch?.[0]?.lines));
    const edit = events.find(event => event.type === 'tool' && event.kind === 'write' && event.status === 'done');
    assert.equal(edit.title, '書きました edit.json');
    assert.equal(edit.detail.path, 'edit.json');
    assert.deepEqual(edit.detail.diff, {
        added: 1,
        removed: 1,
        patch: ' context\n-old\n+new\n context\n context'
    });
    assert.ok(events.some(event => event.type === 'files' && event.files[0].path === 'edit.json'));
    assert.equal(events.filter(event => event.type === 'tool' && event.kind === 'think').length, 2);
});

test('project-external paths stay absolute', () => {
    const events = [];
    const parser = new ClaudeStreamParser('/project', event => events.push(event));
    parser.accept({
        type: 'assistant',
        message: {
            id: 'message-fixed-outside',
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: 'tool-fixed-outside',
                name: 'Read',
                input: { file_path: '/outside/notes.md' }
            }]
        }
    });
    assert.equal(events[0].title, '読みました /outside/notes.md');
    assert.equal(events[0].detail.path, '/outside/notes.md');
});

test('recorded auth and interrupted turns retain error meaning', async () => {
    const auth = (await parseFixture('auth')).events;
    assert.ok(auth.some(event => event.type === 'error' && event.kind === 'auth'));
    const interrupted = (await parseFixture('run3')).events;
    assert.ok(interrupted.some(event => event.type === 'tool' && event.status === 'error'));
    assert.equal(interrupted.at(-1).type, 'turn.end');
    assert.equal(interrupted.at(-1).ok, false);
});

test('compact uses post tokens and skips the empty compact result', async () => {
    const { rows, events } = await parseFixture('run2');
    assert.ok(rows.some(row => row.subtype === 'compact_boundary'));
    assert.deepEqual(
        events.filter(event => event.type === 'usage').map(event => event.usedTokens),
        [30551, 3128, 22571]
    );
});

test('partial text arrives before block stop', () => {
    const events = [];
    const parser = new ClaudeStreamParser('/project', event => events.push(event));
    parser.accept({
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    });
    parser.accept({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'これはストリームで届く長い文章です。' } }
    });
    assert.ok(events.some(event => event.type === 'message.delta'));
    parser.accept({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    assert.equal(events.filter(event => event.type === 'message.end').length, 1);
});

test('partial ask fence stays out of bubbles', () => {
    const events = [];
    const parser = new ClaudeStreamParser('/project', event => events.push(event));
    parser.accept({
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    });
    parser.accept({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '```akari-' } }
    });
    parser.accept({
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ask\n{"question":"どちら？","options":[{"label":"A"},{"label":"B"}]}\n```' } }
    });
    parser.accept({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    assert.equal(events.filter(event => event.type === 'ask').length, 1);
    assert.equal(events.filter(event => event.type === 'message.delta').length, 0);
});

test('AskUserQuestion tool becomes an ask event', () => {
    const events = [];
    const parser = new ClaudeStreamParser('/project', event => events.push(event));
    parser.accept({
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: 'tool-fixed-ask',
                name: 'AskUserQuestion',
                input: { questions: [{ question: '選んで', options: [{ label: '一' }, { label: '二' }] }] }
            }]
        }
    });
    assert.equal(events[0].type, 'ask');
    assert.equal(events[0].options.length, 2);
});

test('attachments become prose and image content', async () => {
    await withTempDirectory('akari-chat-image-', async cwd => {
        await writeFile(join(cwd, 'image.png'), Buffer.from([137, 80, 78, 71]));
        const attachments = [
            { kind: 'file', path: 'image.png', label: '写真' },
            { kind: 'review', label: '確認', review: { tool: 'pin', source: 'edit.json', sourceLabel: '下書き', time: 12, text: '直して' } }
        ];
        assert.match(describeAttachments(attachments), /\[レビュー\].*0:12 ピン.*直して/);
        const message = await claudeUserMessage('見て', attachments, cwd);
        assert.equal(message.message.content[1].source.media_type, 'image/png');
        assert.match(userText(message), /\[ファイル\] 写真: image\.png/);
    });
});

test('a dead process restarts with --resume and receives the next message', async () => {
    await withTempDirectory('akari-chat-exit-', async cwd => {
        await writeFile(join(cwd, 'mode.txt'), 'exit');
        const adapter = new ClaudeStreamJsonAdapter(await fakeExecutable(cwd));
        assert.equal((await adapter.info()).version, undefined);
        await assert.rejects(readFile(join(cwd, 'args.jsonl'), 'utf8'));
        const session = await adapter.start({ cwd, permission: 'auto' });
        await session.send('one', []);
        const child = session.child;
        if (child && child.exitCode === null) await once(child, 'exit');
        await session.send('two', []);
        const received = (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        const args = (await readFile(join(cwd, 'args.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(received.map(userText), ['one', 'two']);
        assert.equal(args[1][args[1].indexOf('--resume') + 1], 'session-fixed');
        await session.close();
    });
});

test('interrupt resolves the Claude send and the next turn can proceed', async () => {
    await withTempDirectory('akari-chat-interrupt-', async cwd => {
        await writeFile(join(cwd, 'mode.txt'), 'hold-turn');
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const events = [];
        let started;
        const sessionStarted = new Promise(resolve => { started = resolve; });
        session.onEvent(event => { events.push(event); if (event.type === 'session') started(); });
        try {
            const first = session.send('one', []);
            await sessionStarted;
            await session.interrupt();
            await first;
            assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'interrupted' });
            await writeFile(join(cwd, 'mode.txt'), 'persistent');
            await session.send('two', []);
            assert.equal(events.at(-1).type, 'turn.end');
            assert.equal(events.at(-1).ok, true);
        } finally { await session.close(); }
    });
});

test('Claude SIGINT result is reported as stopped without an error', async () => {
    await withTempDirectory('akari-chat-interrupt-result-', async cwd => {
        await writeFile(join(cwd, 'mode.txt'), 'interrupt-result');
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const events = [];
        let started;
        const sessionStarted = new Promise(resolve => { started = resolve; });
        session.onEvent(event => { events.push(event); if (event.type === 'session') started(); });
        try {
            const turn = session.send('one', []);
            await sessionStarted;
            await session.interrupt();
            await turn;
            assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'interrupted' });
            assert.equal(events.some(event => event.type === 'error'), false);
        } finally { await session.close(); }
    });
});

test('closed stdin on a live process restarts before writing', async () => {
    await withTempDirectory('akari-chat-stdin-', async cwd => {
        await writeFile(join(cwd, 'mode.txt'), 'hold-input-close');
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            await session.send('one', []);
            session.child.stdin.end();
            await session.send('two', []);
            const received = (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
            const args = (await readFile(join(cwd, 'args.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
            assert.deepEqual(received.map(userText), ['one', 'two']);
            assert.equal(args[1][args[1].indexOf('--resume') + 1], 'session-fixed');
        } finally {
            await session.close();
        }
    });
});

test('concurrent sends are queued and none is lost', async () => {
    await withTempDirectory('akari-chat-queue-', async cwd => {
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        await Promise.all([
            session.send('one', []),
            session.send('two', []),
            session.send('three', [])
        ]);
        const received = (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(received.map(userText), ['one', 'two', 'three']);
        await session.close();
    });
});

test('write callback failure produces error and failed turn', async () => {
    await withTempDirectory('akari-chat-write-', async cwd => {
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            await session.send('first', []);
            session.child.stdin.write = (_line, callback) => {
                callback(new Error('fake write failure'));
                return false;
            };
            await assert.rejects(session.send('second', []), /write-failed/);
            assert.ok(events.some(event => event.type === 'error' && event.kind === 'crashed'));
            assert.ok(events.some(event => event.type === 'turn.end' && event.ok === false));
        } finally {
            await session.close();
        }
    });
});

test('model and effort changes restart with the session reference', async () => {
    await withTempDirectory('akari-chat-model-', async cwd => {
        const session = await new ClaudeStreamJsonAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'all' });
        await session.send('one', []);
        await session.setModel('haiku');
        await session.setEffort('high');
        await session.send('two', []);
        const args = (await readFile(join(cwd, 'args.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        assert.equal(args.length, 2);
        assert.ok(args[0].includes('--dangerously-skip-permissions'));
        assert.equal(args[1][args[1].indexOf('--resume') + 1], 'session-fixed');
        assert.equal(args[1][args[1].indexOf('--model') + 1], 'haiku');
        assert.equal(args[1][args[1].indexOf('--effort') + 1], 'high');
        await session.close();
    });
});

test('history title, add, update and atomic persistence', async () => {
    await withTempDirectory('akari-chat-history-', async cwd => {
        const now = '2026-01-01T00:00:00.000Z';
        const entry = {
            id: 'c-fixed',
            agent: 'claude',
            sessionRef: 'session-fixed',
            title: titleFromText('あ'.repeat(45)),
            createdAt: now,
            updatedAt: now
        };
        assert.equal([...entry.title].length, 40);
        const history = updateHistory(addHistory({ version: 1, sessions: [] }, entry), entry.id, { title: '更新' });
        await writeHistory(cwd, history);
        assert.equal((await readHistory(cwd)).sessions[0].title, '更新');
    });
});

test('Markdown tables and HTML escaping', () => {
    const html = renderMarkdown('# 見出し\n\n| 名前 | 値 |\n| --- | --- |\n| A | **B** |\n\n- 一\n\n```js\n<script>x</script>\n```\n\n[安全](https://example.test) [危険](javascript:alert(1))');
    assert.match(html, /<table>/);
    assert.match(html, /<strong>B<\/strong>/);
    assert.match(html, /<ul>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /href="javascript:/);
});
