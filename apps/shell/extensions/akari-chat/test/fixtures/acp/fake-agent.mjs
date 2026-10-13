import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
    process.stdout.write('fake-acp 1.0\n');
    process.exit(0);
}

let buffer = '';
let sequence = 100;
let promptId;
let permissionId;
let fsReplies = 0;
let newSessions = 0;
const mode = readFileSync(join(process.cwd(), 'mode.txt'), 'utf8').trim();
const log = join(process.cwd(), 'received.jsonl');
const send = packet => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...packet }) + '\n');
const update = value => send({ method: 'session/update', params: { sessionId: 'session-fixed', update: value } });
const reply = (id, result) => send({ id, result });

function finishPrompt(reason = 'end_turn') {
    if (promptId !== undefined) {
        reply(promptId, { stopReason: reason });
        promptId = undefined;
    }
}

function handle(packet) {
    appendFileSync(log, JSON.stringify(packet) + '\n');
    if (packet.method === 'initialize') {
        if (mode === 'hold-initialize') { return; }
        reply(packet.id, { protocolVersion: 1, agentCapabilities: {
            loadSession: true, promptCapabilities: { image: true },
            ...(mode === 'init-close' ? { sessionCapabilities: { close: true } } : {})
        } });
    } else if (packet.method === 'session/new') {
        newSessions++;
        if (mode === 'hold-session-new' || (mode === 'hold-clear' && newSessions > 1)) { return; }
        if (mode === 'auth' || mode === 'auth-reason') {
            send({ id: packet.id, error: { code: -32000, message: mode === 'auth'
                ? 'auth_required'
                : `This client is no longer supported. Contact person${String.fromCharCode(64)}example.test with ${'A'.repeat(40)} to migrate.` } });
        } else {
            if (mode === 'early-commands') {
                update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'first' }] });
                update({ sessionUpdate: 'available_commands_update', availableCommands: [
                    { name: 'first' }, { name: 'second' }
                ] });
            }
            reply(packet.id, { sessionId: 'session-fixed', ...(mode === 'init-close' ? {} : { sessionCapabilities: { close: true } }),
                ...(mode === 'models-list'
                    ? { models: { currentModelId: 'listed', availableModels: [{ modelId: 'listed', name: 'Listed' }, { modelId: 'another', name: 'Another' }] } }
                    : { configOptions: [{ id: 'model', category: 'model', currentValue: 'small', options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] },
                        { id: 'thought', category: 'thought_level', options: [{ value: 'low' }, { value: 'high' }] }] }) });
        }
    } else if (packet.method === 'session/load') {
        if (mode === 'hold-session-load') { return; }
        if (mode === 'early-commands') update({ sessionUpdate: 'available_commands_update',
            availableCommands: [{ name: 'first' }, { name: 'second' }] });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old message' } });
        reply(packet.id, { sessionId: packet.params.sessionId, sessionCapabilities: { close: true } });
    } else if (packet.method === 'session/prompt') {
        promptId = packet.id;
        if (mode === 'cancel') { return; }
        if (mode === 'crash') { setTimeout(() => process.exit(7), 10); return; }
        if (mode === 'stderr-noise') {
            process.stderr.write('unrelated quota and rate limit log\n');
            send({ id: packet.id, error: { code: -32005, message: 'temporary backend failure' } });
            promptId = undefined;
            return;
        }
        if (mode === 'rate-error' || mode === 'limit-word') {
            send({ id: packet.id, error: { code: -32005, message: mode === 'rate-error' ? 'HTTP 429 Too Many Requests' : 'context limit reached' } });
            promptId = undefined;
            return;
        }
        if (mode === 'measured-updates') {
            update({ sessionUpdate: 'config_option_update', configOptions: [
                { id: 'model', category: 'model', options: [{ value: 'new-model', name: 'New Model' }] }
            ] });
            update({ sessionUpdate: 'config_option_update', configOption: {
                id: 'thought', category: 'thought_level', options: [{ value: 'medium' }]
            } });
            update({ sessionUpdate: 'tool_call', toolCallId: 'execute-1', kind: 'execute', status: 'in_progress',
                title: 'Execute', locations: [{ path: '.' }], rawInput: { command: ['node', '--version'] } });
            update({ sessionUpdate: 'tool_call_update', toolCallId: 'execute-1', status: 'completed' });
            update({ sessionUpdate: 'tool_call', toolCallId: 'read-1', kind: 'read', status: 'pending', title: 'read' });
            update({ sessionUpdate: 'tool_call', toolCallId: 'search-1', kind: 'search', status: 'failed',
                title: 'Search', rawInput: { pattern: 'needle' } });
            update({ sessionUpdate: 'usage_update', used: 42, size: 1000 });
            finishPrompt();
            return;
        }
        if (mode === 'ask') {
            permissionId = ++sequence;
            send({ id: permissionId, method: 'session/request_permission', params: {
                sessionId: 'session-fixed', toolCall: { title: '確認' },
                options: [{ optionId: 'reject', name: '拒否', kind: 'reject_once' }] } });
            return;
        }
        if (mode === 'fs') {
            send({ id: ++sequence, method: 'fs/read_text_file', params: { sessionId: 'session-fixed', path: 'inside.txt' } });
            send({ id: ++sequence, method: 'fs/read_text_file', params: { sessionId: 'session-fixed', path: '../outside.txt' } });
            send({ id: ++sequence, method: 'fs/read_text_file', params: { sessionId: 'session-fixed', path: join(process.cwd(), '..', 'outside.txt') } });
            send({ id: ++sequence, method: 'fs/write_text_file', params: { sessionId: 'session-fixed', path: '../outside.txt', content: 'bad' } });
            send({ id: ++sequence, method: 'fs/read_text_file', params: { sessionId: 'session-fixed', path: 'link.txt' } });
            return;
        }
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'こんにちは' } });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' 世界' } });
        update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '考え中' } });
        update({ sessionUpdate: 'plan', entries: [{ status: 'in_progress', content: '確認' }] });
        update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] });
        update({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', kind: 'read', status: 'pending',
            title: 'Read', locations: [{ path: join(process.cwd(), 'inside.txt') }] });
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ type: 'content', text: 'ok' }] });
        permissionId = ++sequence;
        send({ id: permissionId, method: 'session/request_permission', params: {
            sessionId: 'session-fixed', toolCall: { title: 'Read' },
            options: [{ optionId: 'always', name: '常に許可', kind: 'allow_always' }, { optionId: 'once', name: '一度許可', kind: 'allow_once' }] } });
    } else if (packet.method === 'session/cancel') {
        finishPrompt('cancelled');
    } else if (packet.method === 'session/set_config_option') {
        if (mode === 'model-error') {
            send({ id: packet.id, error: { code: -32002, message: 'Unknown model' } });
        } else { reply(packet.id, { configOptions: [] }); }
    } else if (packet.method === 'session/set_model') {
        reply(packet.id, {});
    } else if (packet.method === 'session/close') {
        reply(packet.id, null);
    } else if (packet.id === permissionId) {
        finishPrompt();
    } else if (mode === 'fs' && packet.id >= 101 && packet.id <= 105) {
        fsReplies++;
        if (fsReplies === 5) { finishPrompt(); }
    } else if (packet.id !== undefined && packet.method) {
        send({ id: packet.id, error: { code: -32601, message: 'unknown' } });
    }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim()) { handle(JSON.parse(line)); }
    }
});
