import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CodexNotificationParser, CodexAppServerAdapter } = require('../lib/node/adapters/codex-app-server.js');

async function fixture(name) {
    const source = await readFile(new URL(`./fixtures/codex/${name}.jsonl`, import.meta.url), 'utf8');
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    for (const row of source.trim().split('\n').map(JSON.parse)) {
        parser.accept(row);
    }
    return events;
}

async function withTemp(run) {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-codex-test-'));
    try { return await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function fakeExecutable(cwd) {
    const script = join(cwd, 'fake-codex');
    await writeFile(script, `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--version')) { console.log('codex-cli test'); process.exit(0); }
let buffer = '', threadNumber = 0, turnNumber = 0, active = '';
const record = value => fs.appendFileSync('received.jsonl', JSON.stringify(value) + '\\n');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (id, result) => send({jsonrpc:'2.0',id,result});
const complete = (status='completed') => send({jsonrpc:'2.0',method:'turn/completed',params:{threadId:active,turn:{id:'turn-'+turnNumber,status,error:null,items:[]}}});
const compactEnd = () => send({jsonrpc:'2.0',method:'turn/completed',params:{threadId:active,turn:{id:'compact-fixed',status:'completed',error:null,items:[]}}});
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk; let end;
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0,end); buffer = buffer.slice(end+1); if (!line) continue;
    const msg = JSON.parse(line); record(msg);
    if (msg.method === 'initialize') reply(msg.id,{userAgent:'test'});
    else if (msg.method === 'account/read') reply(msg.id,fs.existsSync('logged-out') ? {account:null,requiresOpenaiAuth:true} : {account:{type:'apiKey'},requiresOpenaiAuth:false});
    else if (msg.method === 'model/list') {
      if (fs.existsSync('no-catalog')) send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'catalog unavailable'}});
      else reply(msg.id,{data:[
        {id:'model-one',model:'model-one',displayName:'Model One',description:'Test',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low',description:''},{reasoningEffort:'high',description:''}]},
        {id:'model-two',model:'model-two',displayName:'Model Two',description:'Test',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'high',description:''}]},
        {id:'plain',model:'plain',displayName:'Plain',description:'Test',hidden:false,supportedReasoningEfforts:[]}
      ],nextCursor:null});
    }
    else if (msg.method === 'skills/list') reply(msg.id,{data:[{cwd:process.cwd(),skills:[{name:'edit-lint',description:'Check edit'}]}]});
    else if (msg.method === 'thread/start') { active = 'thread-'+(++threadNumber); reply(msg.id,{thread:{id:active},model:msg.params.model||'model-one'}); }
    else if (msg.method === 'thread/resume') {
      if (fs.existsSync('reject-resume')) send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'no rollout found for thread id missing'}});
      else { active = msg.params.threadId; reply(msg.id,{thread:{id:active},model:'model-one'}); }
    }
    else if (msg.method === 'turn/start') {
      if (fs.existsSync('reject-summary') && msg.params.summary) {
        send({jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'reasoning summary is unsupported'}});
        continue;
      }
      turnNumber++; reply(msg.id,{turn:{id:'turn-'+turnNumber}});
      const text = msg.params.input[0].text;
      if (text === 'approval') send({jsonrpc:'2.0',id:900,method:'item/commandExecution/requestApproval',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'command-fixed',command:'pwd'}});
      else if (text === 'file approval') send({jsonrpc:'2.0',id:901,method:'item/fileChange/requestApproval',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'write-fixed'}});
      else if (text === 'ask') send({jsonrpc:'2.0',id:902,method:'item/tool/requestUserInput',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'ask-fixed',questions:[{id:'choice',question:'どちら？',options:[{label:'一',description:''},{label:'二',description:''}]}],isBlocking:true}});
      else if (text === 'permissions') send({jsonrpc:'2.0',id:903,method:'item/permissions/requestApproval',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'permissions-fixed',reason:'追加の権限',permissions:{network:{enabled:true},fileSystem:null}}});
      else if (text === 'mcp') send({jsonrpc:'2.0',id:904,method:'mcpServer/elicitation/request',params:{threadId:active,turnId:'turn-'+turnNumber,serverName:'example',mode:'form',message:'名前を入力',requestedSchema:{type:'object',properties:{name:{type:'string'}}}}});
      else if (text === 'unknown') send({jsonrpc:'2.0',id:905,method:'unknown/request',params:{}});
      else if (text === 'legacy') send({jsonrpc:'2.0',id:906,method:'execCommandApproval',params:{}});
      else if (text === 'slow') {
        setTimeout(() => send({jsonrpc:'2.0',method:'thread/tokenUsage/updated',params:{threadId:active,turnId:'turn-'+turnNumber,tokenUsage:{last:{totalTokens:1},modelContextWindow:100}}}),700);
        setTimeout(() => complete(),1350);
      }
      else if (text === 'reasoning') {
        if (msg.params.summary === 'detailed') {
          send({jsonrpc:'2.0',method:'item/started',params:{threadId:active,turnId:'turn-'+turnNumber,item:{type:'reasoning',id:'reasoning-fixed',summary:[]}}});
          send({jsonrpc:'2.0',method:'item/reasoning/summaryPartAdded',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'reasoning-fixed',summaryIndex:0}});
          send({jsonrpc:'2.0',method:'item/reasoning/summaryTextDelta',params:{threadId:active,turnId:'turn-'+turnNumber,itemId:'reasoning-fixed',summaryIndex:0,delta:'考え中'}});
        }
        send({jsonrpc:'2.0',method:'item/completed',params:{threadId:active,turnId:'turn-'+turnNumber,item:{type:'reasoning',id:'reasoning-fixed',summary:['考え中']}}});
        complete();
      }
      else if (text === 'after compact') {
        send({jsonrpc:'2.0',method:'turn/started',params:{threadId:active,turn:{id:'compact-fixed',status:'inProgress'}}});
        compactEnd();
        setTimeout(() => complete(),60);
      }
      else if (text === 'crash') { complete(); setTimeout(() => process.exit(1), 10); }
      else if (text !== 'hold' && text !== 'silent') complete();
    }
    else if ([900,901,902,903,904,905,906].includes(msg.id)) complete();
    else if (msg.method === 'turn/interrupt') { reply(msg.id,{}); complete('interrupted'); }
    else if (msg.method === 'thread/compact/start') reply(msg.id,{});
  }
});
`);
    await chmod(script, 0o755);
    return script;
}

async function received(cwd) {
    return (await readFile(join(cwd, 'received.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
}

test('Codex fixture converts message, thinking, command, write, ask, usage and end', async () => {
    const events = await fixture('turn');
    assert.deepEqual(events.filter(event => event.type === 'message.delta').map(event => event.text), ['終わりました。']);
    assert.equal(events.filter(event => event.type === 'message.start').length, 1);
    assert.equal(events.filter(event => event.type === 'message.end').length, 1);
    assert.equal(events.find(event => event.type === 'tool' && event.kind === 'think' && event.status === 'done').detail.text, '確認します');
    const command = events.find(event => event.type === 'tool' && event.kind === 'command' && event.status === 'done');
    assert.equal(command.title, '実行しました pwd');
    assert.equal(command.detail.output, '/project\n');
    const write = events.find(event => event.type === 'tool' && event.kind === 'write' && event.status === 'done');
    assert.equal(write.title, '書きました edit.json');
    assert.deepEqual([write.detail.diff.added, write.detail.diff.removed], [1, 1]);
    assert.equal(events.find(event => event.type === 'files').files[0].path, 'edit.json');
    assert.equal(events.find(event => event.type === 'ask').question, '続けますか？');
    assert.deepEqual(events.find(event => event.type === 'usage'), { type: 'usage', usedTokens: 12, contextWindow: 128000 });
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
});

test('Codex lists app-server skills and streams reasoning deltas', async () => {
    await withTemp(async cwd => {
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            assert.deepEqual(await session.listCommands(), [{ name: 'edit-lint', description: 'Check edit', kind: 'skill' }]);
            const events = [];
            const parser = new CodexNotificationParser(cwd, event => events.push(event));
            parser.accept({ method: 'item/reasoning/textDelta', params: { itemId: 'r1', delta: '考えています' } });
            assert.deepEqual(events.filter(event => event.type === 'thinking.delta').map(event => event.text), ['考えています']);
        } finally { await session.close(); }
    });
});

test('Codex requests detailed reasoning summaries only for reasoning models', async () => {
    await withTemp(async cwd => {
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            await session.send('reasoning', []);
            assert.equal((await received(cwd)).find(row => row.method === 'turn/start').params.summary, 'detailed');
            assert.ok(events.some(event => event.type === 'thinking.delta' && event.text === '考え中'));
            await session.setModel('plain');
            await session.send('plain', []);
            const turns = (await received(cwd)).filter(row => row.method === 'turn/start');
            assert.equal(Object.hasOwn(turns[1].params, 'summary'), false);
        } finally { await session.close(); }
    });
});

test('actual app-server reasoning notification order produces one streamed thought', async () => {
    const events = await fixture('reasoning-stream');
    assert.deepEqual(events.filter(event => event.type === 'thinking.delta').map(event => event.text),
        ['高さを順に比較します']);
    assert.deepEqual(events.filter(event => event.type === 'tool' && event.kind === 'think').map(event => event.status),
        ['running', 'done']);
    assert.deepEqual(events.filter(event => event.type === 'message.delta').map(event => event.text), ['A']);
    assert.equal(events.at(-1).type, 'turn.end');
});

test('Codex retries without summary when the app server rejects it', async () => {
    await withTemp(async cwd => {
        await writeFile(join(cwd, 'reject-summary'), '1');
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            await session.send('plain answer', []);
            const turns = (await received(cwd)).filter(row => row.method === 'turn/start');
            assert.equal(turns.length, 2);
            assert.equal(turns[0].params.summary, 'detailed');
            assert.equal(Object.hasOwn(turns[1].params, 'summary'), false);
        } finally { await session.close(); }
    });
});

test('Codex auth fixture emits the login error and failed turn', async () => {
    const events = await fixture('auth');
    assert.deepEqual(events[0], { type: 'error', kind: 'auth', message: 'Codex でログインしてください' });
    assert.deepEqual(events[1], { type: 'turn.end', ok: false, reason: 'auth' });
});

test('failed turns classify limits, object codes and non-auth errors', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: {
        id: 'limit-fixed', status: 'failed', error: { message: 'Limit reached', codexErrorInfo: 'usageLimitExceeded' }
    } } });
    assert.deepEqual(events.splice(0), [
        { type: 'error', kind: 'rate-limit', message: 'Limit reached' },
        { type: 'turn.end', ok: false, reason: 'rate-limit' }
    ]);
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: {
        id: 'auth-fixed', status: 'failed', error: { message: 'Access denied', codexErrorInfo: { unauthorized: {} } }
    } } });
    assert.deepEqual(events.splice(0), [
        { type: 'error', kind: 'auth', message: 'Codex でログインしてください' },
        { type: 'turn.end', ok: false, reason: 'auth' }
    ]);
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: {
        id: 'failed-fixed', status: 'failed', error: { message: 'Something broke', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } }
    } } });
    assert.deepEqual(events.splice(0), [
        { type: 'error', kind: 'other', message: 'Something broke' },
        { type: 'turn.end', ok: false, reason: 'failed' }
    ]);
});

test('terminal error notification reports once; retrying and interrupted turns stay quiet', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    const error = { message: 'Connection failed', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: null } } };
    parser.accept({ method: 'error', params: { threadId: 'thread-fixed', turnId: 'retry-fixed', error, willRetry: true } });
    assert.deepEqual(events, []);
    parser.accept({ method: 'error', params: { threadId: 'thread-fixed', turnId: 'error-fixed', error, willRetry: false } });
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: { id: 'error-fixed', status: 'failed', error } } });
    assert.deepEqual(events.splice(0), [
        { type: 'error', kind: 'other', message: 'Connection failed' },
        { type: 'turn.end', ok: false, reason: 'failed' }
    ]);
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: { id: 'stopped-fixed', status: 'interrupted', error } } });
    assert.deepEqual(events, [{ type: 'turn.end', ok: false, reason: 'interrupted' }]);
});

test('sanitized app-server recording retains command and context usage', async () => {
    const events = await fixture('measured');
    const command = events.find(event => event.type === 'tool' && event.kind === 'command' && event.status === 'done');
    assert.equal(command.detail.output, '/project\n');
    assert.ok(events.some(event => event.type === 'usage' && event.contextWindow > 0));
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
});

test('sanitized measured actions label list and read commands', async () => {
    const events = await fixture('measured-actions');
    const list = events.find(event => event.type === 'tool' && event.id === 'list-fixed' && event.status === 'done');
    const read = events.find(event => event.type === 'tool' && event.id === 'read-fixed' && event.status === 'done');
    assert.equal(list.kind, 'command');
    assert.equal(list.title, '実行しました ls');
    assert.equal(list.detail.command, 'ls');
    assert.equal(read.kind, 'read');
    assert.equal(read.title, '読みました AGENTS.md');
    assert.equal(read.detail.path, 'AGENTS.md');
    assert.equal(read.detail.command, 'cat AGENTS.md');
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
});

test('structured actions identify search and skills, with a clean shell fallback', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    const command = (id, raw, actions = []) => parser.accept({ method: 'item/completed', params: {
        threadId: 'thread-fixed', turnId: 'turn-fixed', item: {
            type: 'commandExecution', id, command: raw, commandActions: actions, status: 'completed', exitCode: 0
        }
    } });
    command('search-fixed', '/bin/zsh -lc "rg needle src"', [
        { type: 'search', command: 'rg needle src', query: 'needle', path: '/project/src' }
    ]);
    command('skill-fixed', "/bin/zsh -lc 'cat .codex/skills/edit-lint/SKILL.md'", [
        { type: 'read', command: 'cat .codex/skills/edit-lint/SKILL.md', name: 'SKILL.md',
            path: '/project/.codex/skills/edit-lint/SKILL.md' }
    ]);
    command('multiple-fixed', '/bin/zsh -lc "pwd && ls"', [
        { type: 'unknown', command: 'pwd' }, { type: 'listFiles', command: 'ls', path: null }
    ]);
    command('fallback-fixed', "/bin/zsh -lc 'cat AGENTS.md | head -3'");
    const tools = events.filter(event => event.type === 'tool');
    assert.deepEqual(tools.map(event => [event.kind, event.title]), [
        ['search', '検索しました needle'],
        ['skill', '使いました edit-lint'],
        ['command', '実行しました pwd && ls'],
        ['command', '実行しました cat AGENTS.md | head -3']
    ]);
    assert.equal(tools[1].detail.path, '.codex/skills/edit-lint/SKILL.md');
    assert.equal(tools[3].detail.command, 'cat AGENTS.md | head -3');
});

test('added and deleted files count content lines as a patch', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    parser.accept({ method: 'item/completed', params: { threadId: 'thread-fixed', turnId: 'turn-fixed', item: {
        type: 'fileChange', id: 'add-fixed', status: 'completed',
        changes: [{ path: '/project/new.txt', kind: { type: 'add' }, diff: 'one\ntwo\n' }]
    } } });
    parser.accept({ method: 'item/completed', params: { threadId: 'thread-fixed', turnId: 'turn-fixed', item: {
        type: 'fileChange', id: 'delete-fixed', status: 'completed',
        changes: [{ path: '/project/old.txt', kind: { type: 'delete' }, diff: 'old\n' }]
    } } });
    const writes = events.filter(event => event.type === 'tool');
    assert.deepEqual(writes[0].detail.diff, { added: 2, removed: 0, patch: '+one\n+two' });
    assert.deepEqual(writes[1].detail.diff, { added: 0, removed: 1, patch: '-old' });
});

test('empty reasoning stays hidden and running tools finish at turn end', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    parser.accept({ method: 'item/started', params: { threadId: 'thread-fixed', turnId: 'turn-fixed',
        item: { type: 'reasoning', id: 'empty-fixed', summary: [], content: [] } } });
    parser.accept({ method: 'item/completed', params: { threadId: 'thread-fixed', turnId: 'turn-fixed',
        item: { type: 'reasoning', id: 'empty-fixed', summary: [], content: [] } } });
    assert.equal(events.length, 0);
    parser.accept({ method: 'item/started', params: { threadId: 'thread-fixed', turnId: 'turn-fixed',
        item: { type: 'commandExecution', id: 'running-fixed', command: '/bin/zsh -lc ls', status: 'inProgress' } } });
    parser.accept({ method: 'item/commandExecution/outputDelta', params: {
        threadId: 'thread-fixed', turnId: 'turn-fixed', itemId: 'running-fixed', delta: 'one\n'
    } });
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed',
        turn: { id: 'turn-fixed', status: 'completed', error: null } } });
    const final = events.find(event => event.type === 'tool' && event.id === 'running-fixed' && event.status === 'done');
    assert.equal(final.title, '実行しました ls');
    parser.accept({ method: 'item/commandExecution/outputDelta', params: {
        threadId: 'thread-fixed', turnId: 'turn-fixed', itemId: 'running-fixed', delta: 'two\n'
    } });
    const late = events.at(-1);
    assert.equal(late.status, 'done');
    assert.equal(late.detail.output, 'one\ntwo\n');
    assert.equal(events.filter(event => event.type === 'tool' && event.kind === 'think').length, 0);
});

test('failed turns mark all running tool kinds as errors', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    const started = item => parser.accept({ method: 'item/started', params: {
        threadId: 'thread-fixed', turnId: 'turn-fixed', item
    } });
    started({ type: 'commandExecution', id: 'read-fixed', command: 'cat note.txt',
        commandActions: [{ type: 'read', command: 'cat note.txt', name: 'note.txt', path: '/project/note.txt' }] });
    started({ type: 'commandExecution', id: 'search-fixed', command: 'rg word',
        commandActions: [{ type: 'search', command: 'rg word', query: 'word', path: null }] });
    started({ type: 'commandExecution', id: 'skill-fixed', command: 'cat .agents/skills/demo/SKILL.md',
        commandActions: [{ type: 'read', command: 'cat .agents/skills/demo/SKILL.md', name: 'SKILL.md',
            path: '/project/.agents/skills/demo/SKILL.md' }] });
    started({ type: 'fileChange', id: 'write-fixed', changes: [{ path: '/project/new.txt', kind: { type: 'add' }, diff: 'x\n' }] });
    started({ type: 'webSearch', id: 'web-fixed', query: 'example' });
    started({ type: 'mcpToolCall', id: 'mcp-fixed', server: 'example', tool: 'lookup' });
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: {
        id: 'turn-fixed', status: 'failed', error: { message: 'Stopped', codexErrorInfo: 'other' }
    } } });
    const finished = events.filter(event => event.type === 'tool' && event.status === 'error');
    assert.deepEqual(finished.map(event => event.title), [
        '読みました note.txt', '検索しました word', '使いました demo',
        '書きました new.txt', '検索しました example', '使いました example lookup'
    ]);
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'failed' });
});

test('nested JSON error message is shown without its wrapper', () => {
    const events = [];
    const parser = new CodexNotificationParser('/project', event => events.push(event));
    const message = JSON.stringify({ type: 'error', status: 400, error: {
        type: 'invalid_request_error', message: "The 'sonnet' model is not supported when using Codex with a ChatGPT account."
    } });
    parser.accept({ method: 'turn/completed', params: { threadId: 'thread-fixed', turn: {
        id: 'turn-fixed', status: 'failed', error: { message, codexErrorInfo: 'other' }
    } } });
    assert.equal(events[0].message, "The 'sonnet' model is not supported when using Codex with a ChatGPT account.");
    assert.deepEqual(events[1], { type: 'turn.end', ok: false, reason: 'failed' });
});

test('logged-out account emits an auth error without reading credentials', async () => {
    await withTemp(async cwd => {
        await writeFile(join(cwd, 'logged-out'), '');
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            assert.equal(session.initialError.kind, 'auth');
            await session.send('hello', []);
            assert.deepEqual(events.at(-2), { type: 'error', kind: 'auth', message: 'Codex でログインしてください' });
            assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'auth' });
            assert.equal((await received(cwd)).filter(row => row.method === 'turn/start').length, 0);
        } finally { await session.close(); }
    });
});

test('foreign model and effort are omitted, while a valid model refreshes the session', async () => {
    await withTemp(async cwd => {
        const adapter = new CodexAppServerAdapter(await fakeExecutable(cwd));
        const session = await adapter.start({ cwd, permission: 'auto', model: 'sonnet', effort: 'medium' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            await session.send('first', []);
            await session.setModel('model-two');
            await assert.rejects(session.setEffort('low'), /深さ/);
            await session.send('second', []);
            await assert.rejects(session.setModel('sonnet'), /モデル/);
            await session.send('third', []);
            const rows = await received(cwd);
            const thread = rows.find(row => row.method === 'thread/start');
            const turns = rows.filter(row => row.method === 'turn/start');
            assert.ok(rows.findIndex(row => row.method === 'model/list') < rows.findIndex(row => row.method === 'thread/start'));
            assert.equal(Object.hasOwn(thread.params, 'model'), false);
            assert.equal(Object.hasOwn(turns[0].params, 'model'), false);
            assert.equal(Object.hasOwn(turns[0].params, 'effort'), false);
            assert.equal(turns[1].params.model, 'model-two');
            assert.equal(Object.hasOwn(turns[1].params, 'effort'), false);
            assert.equal(turns[2].params.model, 'model-two');
            assert.deepEqual(events.filter(event => event.type === 'session').map(event => event.model),
                ['model-one', 'model-two']);
            const modelUpdate = events.findIndex(event => event.type === 'session' && event.model === 'model-two');
            const secondEnd = events.findIndex((event, index) => index > modelUpdate && event.type === 'turn.end');
            assert.ok(modelUpdate >= 0 && secondEnd > modelUpdate);
        } finally { await session.close(); }
        const resumed = await adapter.start({ cwd, resume: 'thread-fixed', permission: 'auto', model: 'sonnet' });
        try {
            assert.equal(Object.hasOwn((await received(cwd)).find(row => row.method === 'thread/resume').params, 'model'), false);
        } finally { await resumed.close(); }
    });
});

test('a rejected thread/resume is distinguishable from a process startup failure', async () => {
    await withTemp(async cwd => {
        await writeFile(join(cwd, 'reject-resume'), '1');
        const adapter = new CodexAppServerAdapter(await fakeExecutable(cwd));
        await assert.rejects(adapter.start({ cwd, resume: 'missing', permission: 'auto' }),
            /akari-chat:resume-missing:no rollout found/);
    });
});

test('model and effort pass through only when the catalog is unavailable', async () => {
    await withTemp(async cwd => {
        await writeFile(join(cwd, 'no-catalog'), '');
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd))
            .start({ cwd, permission: 'auto', model: 'custom-model', effort: 'max' });
        try {
            await session.send('first', []);
            const rows = await received(cwd);
            assert.equal(rows.find(row => row.method === 'thread/start').params.model, 'custom-model');
            assert.equal(rows.find(row => row.method === 'turn/start').params.model, 'custom-model');
            assert.equal(rows.find(row => row.method === 'turn/start').params.effort, 'max');
        } finally { await session.close(); }
    });
});

test('app-server starts, serializes sends, answers approvals and user input', async () => {
    await withTemp(async cwd => {
        const adapter = new CodexAppServerAdapter(await fakeExecutable(cwd));
        assert.equal((await adapter.info()).version, undefined);
        await assert.rejects(readFile(join(cwd, 'received.jsonl'), 'utf8'));
        const session = await adapter.start({ cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            const caps = await session.capabilities();
            assert.equal(caps.images, true);
            assert.deepEqual(caps.models.map(model => model.label), ['Model One', 'Model Two', 'Plain']);
            assert.deepEqual(caps.efforts, ['low', 'high']);
            await Promise.all([session.send('first', []), session.send('second', [])]);
            await session.send('approval', []);
            await session.send('file approval', []);
            await session.send('ask', []);
            assert.equal(events.find(event => event.type === 'ask').question, 'どちら？');
            await session.send('二', []);
            await session.send('permissions', []);
            await session.send('拒否', []);
            await session.send('mcp', []);
            await session.send('例', []);
            await session.send('unknown', []);
            await session.send('legacy', []);
            await writeFile(join(cwd, 'image.png'), Buffer.from([137, 80, 78, 71]));
            await session.send('image', [{ kind: 'file', path: 'image.png', label: '画像' }]);
            await session.send('review', [{ kind: 'review', label: '指摘', review: {
                tool: 'range', source: 'edit.json', sourceLabel: '下書き', time: 12, timeEnd: 15,
                elements: ['テロップ', '映像'], text: '直して'
            } }]);
            const rows = await received(cwd);
            const starts = rows.filter(row => row.method === 'turn/start');
            assert.deepEqual(starts.slice(0, 5).map(row => row.params.input[0].text), ['first', 'second', 'approval', 'file approval', 'ask']);
            assert.equal(starts[9].params.input[1].type, 'localImage');
            assert.equal(starts[9].params.input[1].path, join(cwd, 'image.png'));
            assert.match(starts[10].params.input[0].text, /0:12〜0:15/);
            assert.match(starts[10].params.input[0].text, /テロップ、映像/);
            assert.equal(rows.find(row => row.id === 900).result.decision, 'accept');
            assert.equal(rows.find(row => row.id === 901).result.decision, 'accept');
            assert.deepEqual(rows.find(row => row.id === 902).result.answers, { choice: { answers: ['二'] } });
            assert.deepEqual(rows.find(row => row.id === 903).result, { permissions: {}, scope: 'turn' });
            assert.deepEqual(rows.find(row => row.id === 904).result, { action: 'accept', content: { name: '例' }, _meta: null });
            assert.equal(rows.find(row => row.id === 905).error.code, -32601);
            assert.equal(rows.find(row => row.id === 906).result.decision, 'approved');
            assert.equal(events.filter(event => event.type === 'turn.end').length, 11);
            assert.equal(rows.find(row => row.method === 'thread/start').params.approvalsReviewer, 'guardian_subagent');
        } finally { await session.close(); }
    });
});

test('turn timeout tracks silence and extends on current-turn notifications', async () => {
    await withTemp(async cwd => {
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd), 900).start({ cwd, permission: 'auto' });
        const events = [];
        session.onEvent(event => events.push(event));
        try {
            await session.send('slow', []);
            assert.ok(events.some(event => event.type === 'usage'));
            assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
            await assert.rejects(session.send('silent', []), /timeout/);
            assert.deepEqual(events.at(-2), { type: 'error', kind: 'other', message: 'Codex の応答がありません' });
            assert.deepEqual(events.at(-1), { type: 'turn.end', ok: false, reason: 'timeout' });
        } finally { await session.close(); }
    });
});

test('a delayed compact turn cannot finish the next send', async () => {
    await withTemp(async cwd => {
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        const ends = [];
        session.onEvent(event => { if (event.type === 'turn.end') { ends.push(event); } });
        try {
            await session.compact();
            await session.send('after compact', []);
            assert.deepEqual(ends, [{ type: 'turn.end', ok: true }, { type: 'turn.end', ok: true }]);
            assert.equal((await received(cwd)).filter(row => row.method === 'turn/start').length, 1);
        } finally { await session.close(); }
    });
});

test('a crashed app-server restarts and resumes the thread on next send', async () => {
    await withTemp(async cwd => {
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            await session.send('crash', []).catch(() => undefined);
            if (session.child) {
                await new Promise(resolve => session.child.once('close', resolve));
            }
            await session.send('after crash', []);
            const rows = await received(cwd);
            assert.ok(rows.some(row => row.method === 'thread/resume' && row.params.threadId === 'thread-1'));
            assert.equal(rows.filter(row => row.method === 'turn/start').length, 2);
        } finally { await session.close(); }
    });
});

test('interrupt, clear, compact, resume and next-turn model and effort', async () => {
    await withTemp(async cwd => {
        const executable = await fakeExecutable(cwd);
        const adapter = new CodexAppServerAdapter(executable);
        const session = await adapter.start({ cwd, permission: 'all' });
        try {
            await session.send('first', []);
            await session.setModel('model-two');
            await session.setEffort('high');
            await session.send('second', []);
            let turnStarted;
            const turnStart = new Promise(resolve => { turnStarted = resolve; });
            const rpc = session.rpc.bind(session);
            session.rpc = (method, ...args) => {
                const result = rpc(method, ...args);
                if (method === 'turn/start') void result.then(turnStarted);
                return result;
            };
            const hold = session.send('hold', []);
            await turnStart;
            await session.interrupt();
            await hold;
            await session.clear();
            assert.equal(session.sessionRef, 'thread-2');
            await session.compact();
            const rows = await received(cwd);
            assert.equal(rows.find(row => row.method === 'turn/start' && row.params.input[0].text === 'second').params.model, 'model-two');
            assert.equal(rows.find(row => row.method === 'turn/start' && row.params.input[0].text === 'second').params.effort, 'high');
            assert.ok(rows.some(row => row.method === 'turn/interrupt'));
            assert.ok(rows.some(row => row.method === 'thread/compact/start' && row.params.threadId === 'thread-2'));
            assert.equal(rows.find(row => row.method === 'thread/start').params.sandbox, 'danger-full-access');
        } finally { await session.close(); }
        const resumed = await adapter.start({ cwd, resume: 'thread-fixed', permission: 'auto' });
        try {
            assert.equal(resumed.sessionRef, 'thread-fixed');
            assert.ok((await received(cwd)).some(row => row.method === 'thread/resume' && row.params.threadId === 'thread-fixed'));
        } finally { await resumed.close(); }
    });
});

test('Codex confirmation modes set distinct approval policies', async () => {
    await withTemp(async cwd => {
        const adapter = new CodexAppServerAdapter(await fakeExecutable(cwd));
        for (const permission of ['auto', 'checkpoints', 'every']) {
            const session = await adapter.start({ cwd, permission });
            await session.close();
        }
        const starts = (await received(cwd)).filter(row => row.method === 'thread/start').map(row => row.params);
        assert.equal(starts[0].approvalPolicy, 'on-request');
        assert.equal(starts[0].approvalsReviewer, 'guardian_subagent');
        assert.equal(starts[1].approvalPolicy, 'on-request');
        assert.equal(starts[1].approvalsReviewer, undefined);
        assert.equal(starts[2].approvalPolicy, 'untrusted');
    });
});

test('English approval labels retain their permission decision', async () => {
    const { setLanguage } = require('@akari-video/i18n');
    await withTemp(async cwd => {
        setLanguage('en');
        const session = await new CodexAppServerAdapter(await fakeExecutable(cwd)).start({ cwd, permission: 'auto' });
        try {
            await session.send('permissions', []);
            await session.send('Allow', []);
            const approval = (await received(cwd)).find(row => row.id === 903);
            assert.deepEqual(approval.result, { permissions: { network: { enabled: true } }, scope: 'turn' });
        } finally { await session.close(); setLanguage(undefined); }
    });
});
