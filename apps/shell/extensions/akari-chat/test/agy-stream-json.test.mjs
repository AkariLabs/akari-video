import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AgyStreamParser, AgyStreamJsonAdapter, agyArgs, agyToolKind, findAgy, parseAgyModels } =
    require('../lib/node/adapters/agy-stream-json.js');

async function fixture(name) {
    const source = await readFile(new URL(`./fixtures/agy/${name}.jsonl`, import.meta.url), 'utf8');
    const events = [];
    const parser = new AgyStreamParser('/workspace/project', event => events.push(event));
    for (const row of source.trim().split('\n').map(JSON.parse)) parser.accept(row);
    return { events, parser };
}

async function withTemp(run) {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-agy-test-'));
    try { return await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function fakeExecutable(cwd) {
    const script = join(cwd, 'fake-agy');
    await writeFile(script, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('agy 1.3.3'); process.exit(0); }
if (args.includes('models')) {
  if (fs.existsSync('models-fail')) process.exit(1);
  console.log('Fetching available models...\\nmodel-a\\tModel A\\nmodel-b\\tModel B');
  process.exit(0);
}
fs.appendFileSync('args.jsonl', JSON.stringify(args) + '\\n');
let buffer = '', index = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
process.on('SIGINT', () => { send({event:'result',result:{conversation_id:'conversation-fixed',status:'ERROR',error:'interrupted'}}); process.exit(0); });
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk; let end;
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
    if (!line) continue;
    const msg = JSON.parse(line);
    fs.appendFileSync('received.jsonl', JSON.stringify(msg) + '\\n');
    if (fs.existsSync('auth')) {
      process.stderr.write('Error: authentication required. Run agy to log in, then retry.\\n');
      send({event:'result',result:{conversation_id:'',status:'ERROR',error:'authentication failed or timed out'}});
      process.exit(1);
    }
    send({event:'init',conversation_id:'conversation-fixed',init:{model:'model-a',cwd:process.cwd()}});
    if (msg.message.content === 'hold') continue;
    if (msg.message.content === 'denied') {
      send({event:'step_update',step_update:{step_index:++index,state:'ACTIVE',step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'ls'}}}});
      send({event:'step_update',step_update:{step_index:index,state:'DONE',step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'ls'}}}});
      send({event:'result',result:{conversation_id:'conversation-fixed',status:'SUCCESS',response:'',denied_actions:[{action:'command',display_name:'RunCommand'}]}});
      continue;
    }
    send({event:'step_update',step_update:{step_index:++index,state:'DONE',step_type:'agent_response',text_delta:'ok\\n',usage:{input_tokens:50,output_tokens:2}}});
    send({event:'result',result:{conversation_id:'conversation-fixed',status:'SUCCESS',usage:{input_tokens:999999,output_tokens:999999}}});
  }
});
`);
    await chmod(script, 0o755);
    return script;
}

async function recorded(cwd, name) {
    return (await readFile(join(cwd, name), 'utf8')).trim().split('\n').map(JSON.parse);
}

test('recorded read and message keep one bubble, relative path and step usage', async () => {
    const { events, parser } = await fixture('read-message');
    assert.equal(parser.sessionId.length > 0, true);
    assert.equal(events.find(event => event.type === 'session').agent, 'antigravity');
    assert.deepEqual(events.filter(event => event.type === 'message.delta').map(event => event.text), ['hello', '\n']);
    assert.equal(events.filter(event => event.type === 'message.start').length, 1);
    assert.equal(events.filter(event => event.type === 'message.end').length, 1);
    const tools = events.filter(event => event.type === 'tool');
    assert.deepEqual(tools.map(event => event.status), ['running', 'done']);
    assert.equal(tools[0].id, tools[1].id);
    assert.equal(tools[1].title, '読みました note.txt');
    assert.equal(tools[1].detail.path, 'note.txt');
    assert.equal(tools[1].detail.output, '2 lines, 6 bytes');
    assert.deepEqual(events.filter(event => event.type === 'usage').map(event => event.usedTokens), [12033, 12284]);
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
});

test('recorded two turns convert command, write, read and edit without empty bubbles', async () => {
    const { events } = await fixture('tools-two-turns');
    assert.deepEqual(events.filter(event => event.type === 'turn.end').map(event => event.ok), [true, true]);
    assert.deepEqual(events.filter(event => event.type === 'message.delta').map(event => event.text), ['done', '\n', 'bye', '\n']);
    assert.equal(events.filter(event => event.type === 'message.start').length, 2);
    const done = events.filter(event => event.type === 'tool' && event.status === 'done');
    assert.deepEqual(done.map(event => event.kind), ['command', 'write', 'read', 'write']);
    assert.deepEqual(done.map(event => event.title), [
        '実行しました ls', '書きました out.txt', '読みました note.txt', '書きました note.txt'
    ]);
    assert.equal(done[0].detail.command, 'ls');
    assert.equal(done[0].detail.output, 'note.txt\r\n');
    assert.equal(done[1].detail.path, 'out.txt');
    assert.equal(done[3].detail.path, 'note.txt');
    assert.equal(events.filter(event => event.type === 'usage').at(-1).usedTokens, 12783);
});

test('recorded denial replaces the completed command and emits one error before a successful turn end', async () => {
    const { events } = await fixture('denied-command');
    const tools = events.filter(event => event.type === 'tool');
    assert.deepEqual(tools.map(event => event.status), ['running', 'done', 'error']);
    assert.equal(new Set(tools.map(event => event.id)).size, 1);
    assert.equal(tools[2].kind, 'command');
    assert.equal(tools[2].title, '止められました ls');
    assert.equal(tools[2].detail.command, 'ls');
    assert.deepEqual(events.filter(event => event.type === 'error'), [{
        type: 'error', kind: 'other',
        message: 'agy が確認を出せないため、コマンドの実行（RunCommand）を止めました'
    }]);
    assert.equal(events.filter(event => event.type === 'message.start').length, 0);
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
    assert.equal(events.at(-2).type, 'error');
    assert.match(await readFile(new URL('./fixtures/agy/denied-command.stderr.txt', import.meta.url), 'utf8'), /auto-denied/);
});

test('denied action matching uses the last relevant outputless tool', () => {
    const events = [];
    const parser = new AgyStreamParser('/workspace/project', event => events.push(event));
    for (const [step_index, tool_name, parameters, output] of [
        [1, 'run_command', { CommandLine: 'pwd' }, '/workspace/project'],
        [2, 'write_to_file', { TargetFile: '/workspace/project/first.txt' }, undefined],
        [3, 'write_to_file', { TargetFile: '/workspace/project/blocked.txt' }, undefined]
    ]) {
        parser.accept({ event: 'step_update', step_update: { step_index, state: 'DONE', step_type: 'tool',
            tool_name, tool_info: { parameters, ...(output === undefined ? {} : { output }) } } });
    }
    parser.accept({ event: 'result', result: { status: 'SUCCESS', denied_actions: [
        { action: 'edit', display_name: 'EditFile' },
        { action: 'command', display_name: 'RunCommand' },
        { action: 'browser', display_name: 'Browser' }
    ] } });
    const denied = events.filter(event => event.type === 'tool' && event.status === 'error');
    assert.deepEqual(denied.map(event => event.title), [
        '止められました blocked.txt', '止められました pwd', '止められました first.txt'
    ]);
    assert.equal(events.filter(event => event.type === 'error').length, 1);
    assert.deepEqual(events.at(-1), { type: 'turn.end', ok: true });
});

test('tool names map to the contract kinds', () => {
    const groups = {
        read: ['view_file', 'list_dir', 'find_by_name', 'grep_search'],
        write: ['replace_file_content', 'multi_replace_file_content', 'write_to_file', 'sed_file', 'notebook_edit'],
        command: ['run_command', 'send_command_input'],
        web: ['search_web', 'read_url_content'],
        ask: ['ask_question'],
        other: ['browser_click_element']
    };
    for (const [kind, names] of Object.entries(groups)) {
        for (const name of names) assert.equal(agyToolKind(name), kind, name);
    }
});

test('models parser ignores non-tab lines and auth result fails', async () => {
    const models = await readFile(new URL('./fixtures/agy/models.txt', import.meta.url), 'utf8');
    const parsed = parseAgyModels(models);
    assert.equal(parsed.length, 18);
    assert.deepEqual(parsed[0], { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' });
    assert.deepEqual(parseAgyModels('Fetching available models...\nmalformed\n'), []);
    const { events } = await fixture('auth-error');
    assert.deepEqual(events, [
        { type: 'error', kind: 'auth', message: 'ターミナルで agy を起動してログインしてください' },
        { type: 'turn.end', ok: false, reason: 'auth' }
    ]);
    assert.match(await readFile(new URL('./fixtures/agy/auth-error.stderr.txt', import.meta.url), 'utf8'), /authentication required/);
});

test('install hint and all parser error messages avoid the name that triggers the wrong UI copy', async () => {
    const events = [
        ...(await fixture('auth-error')).events,
        ...(await fixture('denied-command')).events
    ];
    const parser = new AgyStreamParser('/workspace/project', event => events.push(event));
    parser.accept({ event: 'result', result: { status: 'ERROR', error: 'Antigravity server failed' } });
    parser.accept({ event: 'result', result: { status: 'SUCCESS', denied_actions: [
        { action: 'command', display_name: 'AntigravityCommand' }
    ] } });
    assert.ok(events.filter(event => event.type === 'error').length >= 4);
    for (const event of events.filter(event => event.type === 'error')) {
        assert.doesNotMatch(event.message, /antigravity/i);
    }
    const info = await new AgyStreamJsonAdapter('/missing/agy').info();
    assert.doesNotMatch(info.installHint, /antigravity/i);
});

test('launch arguments use print equals, permission, model, effort and conversation', () => {
    assert.deepEqual(agyArgs({ permission: 'auto' }),
        ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print=', '--dangerously-skip-permissions']);
    assert.deepEqual(agyArgs({ permission: 'all', model: 'model-b', effort: 'xhigh' }, 'conversation-fixed'),
        ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print=',
            '--model', 'model-b', '--effort', 'xhigh', '--conversation', 'conversation-fixed', '--dangerously-skip-permissions']);
});

test('missing executable and failed model catalog are handled', async () => withTemp(async cwd => {
    assert.equal(await findAgy([join(cwd, 'missing-agy')]), undefined);
    const executable = await fakeExecutable(cwd);
    await writeFile(join(cwd, 'models-fail'), '1');
    const session = await new AgyStreamJsonAdapter(executable).start({ cwd, permission: 'auto', resume: 'conversation-saved' });
    assert.deepEqual((await session.capabilities()).models, []);
    await session.send('resume', []);
    assert.deepEqual((await recorded(cwd, 'args.jsonl'))[0].slice(-4),
        ['--print=', '--conversation', 'conversation-saved', '--dangerously-skip-permissions']);
    await session.close();
}));

test('fake agy persists turns, restarts after controls, and sends text attachments', async () => withTemp(async cwd => {
    const executable = await fakeExecutable(cwd);
    const adapter = new AgyStreamJsonAdapter(executable);
    const info = await adapter.info();
    assert.equal(info.id, 'antigravity');
    assert.equal(info.version, undefined);
    assert.equal(info.loginHint, 'agy');
    assert.equal(info.transport, 'agy-stream-json');
    assert.doesNotMatch(info.installHint, /antigravity/i);
    const session = await adapter.start({ cwd, permission: 'auto' });
    const events = [];
    session.onEvent(event => events.push(event));
    const capabilities = await session.capabilities();
    assert.deepEqual(capabilities.models, [{ id: 'model-a', label: 'Model A' }, { id: 'model-b', label: 'Model B' }]);
    assert.deepEqual(capabilities.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(capabilities.images, false);
    await session.send('first', [{ kind: 'file', path: 'photo.png', label: 'Photo' }]);
    await session.send('second', []);
    assert.equal(session.sessionRef, 'conversation-fixed');
    assert.equal((await recorded(cwd, 'args.jsonl')).length, 1);
    assert.equal((await recorded(cwd, 'args.jsonl'))[0].at(-1), '--dangerously-skip-permissions');
    assert.equal(events.filter(event => event.type === 'turn.end').length, 2);
    assert.deepEqual(events.filter(event => event.type === 'usage').map(event => event.usedTokens), [52, 52]);
    const received = await recorded(cwd, 'received.jsonl');
    assert.deepEqual(received[0], { event: 'user', message: { role: 'user', content: 'first\n\n[ファイル] Photo: photo.png' } });
    await session.setModel('model-b');
    await session.setEffort('high');
    await session.send('third', []);
    const args = await recorded(cwd, 'args.jsonl');
    assert.equal(args.length, 2);
    assert.ok(args[1].includes('--conversation'));
    assert.ok(args[1].includes('model-b'));
    assert.ok(args[1].includes('high'));
    await session.clear();
    await session.send('fourth', []);
    assert.equal((await recorded(cwd, 'args.jsonl'))[2].includes('--conversation'), false);
    await session.close();
}));

test('fake agy reports auth and interrupt restarts with conversation', async () => withTemp(async cwd => {
    const executable = await fakeExecutable(cwd);
    await writeFile(join(cwd, 'auth'), '1');
    const session = await new AgyStreamJsonAdapter(executable).start({ cwd, permission: 'all' });
    const events = [];
    session.onEvent(event => events.push(event));
    await assert.rejects(session.send('first', []), /auth/);
    assert.equal(events.find(event => event.type === 'error').kind, 'auth');
    assert.deepEqual(events.find(event => event.type === 'turn.end'), { type: 'turn.end', ok: false, reason: 'auth' });
    await rm(join(cwd, 'auth'));
    await session.send('next', []);
    const held = session.send('hold', []);
    await new Promise(resolve => setTimeout(resolve, 50));
    await session.interrupt();
    await held;
    await session.send('after', []);
    const args = await recorded(cwd, 'args.jsonl');
    assert.ok(args.at(-1).includes('--conversation'));
    assert.ok(args[0].includes('--dangerously-skip-permissions'));
    await session.close();
}));

test('fake denied turn resolves, and no adapter error message uses the conflicting name', async () => withTemp(async cwd => {
    const executable = await fakeExecutable(cwd);
    const adapter = new AgyStreamJsonAdapter(executable);
    const info = await adapter.info();
    assert.doesNotMatch(info.installHint, /antigravity/i);
    const session = await adapter.start({ cwd, permission: 'auto' });
    const events = [];
    session.onEvent(event => events.push(event));
    await session.send('denied', []);
    await session.send('after', []);
    assert.equal(events.filter(event => event.type === 'error').length, 1);
    assert.deepEqual(events.filter(event => event.type === 'turn.end').map(event => event.ok), [true, true]);
    for (const event of events.filter(event => event.type === 'error')) {
        assert.doesNotMatch(event.message, /antigravity/i);
    }
    await session.close();
}));
