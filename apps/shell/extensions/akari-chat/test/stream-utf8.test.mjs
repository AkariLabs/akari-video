import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ClaudeStreamJsonAdapter } = require('../lib/node/adapters/claude-stream-json.js');
const { AcpAdapter } = require('../lib/node/adapters/acp.js');
const { acpAgents } = require('../lib/node/adapters/acp-agents.js');
const { AgyStreamJsonAdapter } = require('../lib/node/adapters/agy-stream-json.js');
const { CodexAppServerAdapter } = require('../lib/node/adapters/codex-app-server.js');
const acpFixture = fileURLToPath(new URL('./fixtures/acp/fake-agent.mjs', import.meta.url));
const originalText = 'あ'.repeat(22000) + '終わり';

async function fakeExecutables(root) {
    const idle = join(root, 'idle-agent');
    await writeFile(idle, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('test 1.0'); process.exit(0); }
process.stdin.resume();
setInterval(() => {}, 1000);
`);
    const codex = join(root, 'fake-codex');
    await writeFile(codex, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('test 1.0'); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (!line) continue;
    const packet = JSON.parse(line);
    if (packet.id === undefined) continue;
    let result = {};
    if (packet.method === 'account/read') result = { account: { type: 'apiKey' }, requiresOpenaiAuth: false };
    if (packet.method === 'model/list') result = { data: [], nextCursor: null };
    if (packet.method === 'thread/start') result = { thread: { id: 'thread-fixed' }, model: 'test' };
    process.stdout.write(JSON.stringify({ id: packet.id, result }) + '\\n');
  }
});
`);
    await Promise.all([chmod(idle, 0o755), chmod(codex, 0o755)]);
    return { idle, codex };
}

function splitAndPush(stream, packet, mode) {
    const bytes = Buffer.from(JSON.stringify(packet) + '\n', 'utf8');
    assert.ok(bytes.length > 64 * 1024);
    if (mode === 'one byte') {
        for (let index = 0; index < bytes.length; index++) stream.push(bytes.subarray(index, index + 1));
    } else {
        const insideCharacter = bytes.indexOf(Buffer.from('あ')) + 1;
        for (const boundary of [insideCharacter, 65536, bytes.length]) {
            const start = boundary === insideCharacter ? 0 : boundary === 65536 ? insideCharacter : 65536;
            stream.push(bytes.subarray(start, boundary));
        }
    }
}

for (const mode of ['one byte', 'split in character']) {
    test(`all four adapters preserve a long UTF-8 event split ${mode}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'akari-stream-utf8-'));
        const cwd = join(root, 'project');
        await mkdir(cwd);
        await writeFile(join(cwd, 'mode.txt'), 'normal');
        const executable = await fakeExecutables(root);
        const cases = [
            {
                name: 'claude-stream-json',
                open: () => new ClaudeStreamJsonAdapter(executable.idle).start({ cwd, permission: 'auto', model: 'test' }),
                packet: { type: 'stream_event', event: { type: 'content_block_delta', index: 0,
                    delta: { type: 'text_delta', text: originalText } } },
                before: stream => {
                    stream.push(Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } }) + '\n'));
                    stream.push(Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0,
                        content_block: { type: 'text', text: '' } } }) + '\n'));
                }
            },
            {
                name: 'acp',
                open: () => new AcpAdapter({ ...acpAgents[0], args: [acpFixture] }, process.execPath)
                    .start({ cwd, permission: 'auto' }),
                packet: { method: 'session/update', params: { sessionId: 'session-fixed', update: {
                    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: originalText }
                } } }
            },
            {
                name: 'agy-stream-json',
                open: () => new AgyStreamJsonAdapter(executable.idle).start({ cwd, permission: 'auto' }),
                packet: { event: 'step_update', step_update: { conversation_id: 'fixed', step_index: 1,
                    state: 'ACTIVE', step_type: 'agent_response', text_delta: originalText } }
            },
            {
                name: 'codex-app-server',
                open: () => new CodexAppServerAdapter(executable.codex).start({ cwd, permission: 'auto' }),
                packet: { method: 'item/agentMessage/delta', params: { threadId: 'thread-fixed', turnId: 'turn-fixed',
                    itemId: 'message-fixed', delta: originalText } }
            }
        ];
        try {
            for (const entry of cases) {
                const session = await entry.open();
                try {
                    const received = [];
                    session.onEvent(event => { if (event.type === 'message.delta') received.push(event.text); });
                    assert.equal(session.child.stdout.readableEncoding, 'utf8', entry.name);
                    assert.equal(session.child.stderr.readableEncoding, 'utf8', entry.name);
                    entry.before?.(session.child.stdout);
                    splitAndPush(session.child.stdout, entry.packet, mode);
                    await new Promise(resolve => setImmediate(resolve));
                    assert.equal(received.join(''), originalText, entry.name);
                    assert.doesNotMatch(received.join(''), /\uFFFD/, entry.name);
                } finally { await session.close(); }
            }
        } finally { await rm(root, { recursive: true, force: true }); }
    });
}
