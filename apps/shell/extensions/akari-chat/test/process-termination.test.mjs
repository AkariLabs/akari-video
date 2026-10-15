import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const { ClaudeStreamJsonAdapter } = require('../lib/node/adapters/claude-stream-json.js');
const { CodexAppServerAdapter } = require('../lib/node/adapters/codex-app-server.js');
const { AgyStreamJsonAdapter } = require('../lib/node/adapters/agy-stream-json.js');
const { reapChildGroup, terminateChild } = require('../lib/node/adapters/terminate.js');

async function waitForPid(cwd) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const value = await readFile(join(cwd, 'pid'), 'utf8').catch(() => undefined);
        if (value) return Number(value);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('fake process did not start');
}

async function gone(pid) {
    for (let attempt = 0; attempt < 100; attempt++) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === 'ESRCH') return true; throw error; }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return false;
}

for (const [name, Adapter] of [
    ['Claude', ClaudeStreamJsonAdapter], ['Codex', CodexAppServerAdapter], ['Antigravity', AgyStreamJsonAdapter]
]) test(`${name} close escalates when SIGTERM is ignored`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-chat-terminate-'));
    const executable = join(cwd, 'fake-agent');
    await writeFile(executable, `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--version')) process.exit(0);
if (process.argv.includes('models')) { console.log('model-a\\tModel A'); process.exit(0); }
fs.writeFileSync('pid', String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!line) continue;
    const row = JSON.parse(line);
    if (row.method && row.id) {
      const result = row.method === 'account/read' ? {account:{type:'apiKey'},requiresOpenaiAuth:false}
        : row.method === 'model/list' ? {data:[],nextCursor:null}
        : row.method === 'thread/start' ? {thread:{id:'thread-one'},model:'model-a'} : {};
      process.stdout.write(JSON.stringify({id:row.id,result}) + '\\n');
    }
  }
});
`);
    await chmod(executable, 0o755);
    let session;
    try {
        session = await new Adapter(executable).start({ cwd, permission: 'auto' });
        const pid = await waitForPid(cwd);
        const start = Date.now();
        await session.close();
        assert.equal(await gone(pid), true);
        assert.ok(Date.now() - start < 1500);
    } finally {
        await session?.close();
        await rm(cwd, { recursive: true, force: true });
    }
});

test('a child exiting on its own does not leave its process-group grandchild', {
    skip: process.platform === 'win32'
}, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'akari-chat-grandchild-'));
    const parentScript = join(cwd, 'parent.cjs');
    await writeFile(parentScript, `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  { stdio: 'ignore' });
writeFileSync('grandchild-pid', String(child.pid));
setTimeout(() => process.exit(0), 20);
`);
    let grandchild;
    try {
        for (const register of [true, false]) {
            const parent = spawn(process.execPath, [parentScript], { cwd, stdio: 'ignore', detached: true });
            if (register) reapChildGroup(parent);
            await once(parent, 'exit');
            grandchild = Number(await readFile(join(cwd, 'grandchild-pid'), 'utf8'));
            if (!register) await terminateChild(parent);
            assert.equal(await gone(grandchild), true);
        }
    } finally {
        if (grandchild) { try { process.kill(grandchild, 'SIGKILL'); } catch {} }
        await rm(cwd, { recursive: true, force: true });
    }
});
