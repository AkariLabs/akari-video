#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
const args = process.argv.slice(2);
const call = { args, cwd: process.cwd(), tmpdir: process.env.TMPDIR, stdinEnded: false,
  files: await import('node:fs/promises').then(fs => fs.readdir(process.cwd())) };
await Promise.race([new Promise(resolve => {
  process.stdin.on('end', () => { call.stdinEnded = true; resolve(); }); process.stdin.resume();
}), new Promise(resolve => setTimeout(resolve, 100))]);
await writeFile(process.env.FAKE_TASKIFY_CALL, JSON.stringify(call));
const stateFile = process.env.FAKE_TASKIFY_STATE;
let count = 0;
try { count = Number(await readFile(stateFile, 'utf8')); } catch { /* first attempt */ }
await writeFile(stateFile, String(count + 1));
const result = { summary: '案を作りました', tasks: [{ ref: 't1', title: '字幕を動かす', body: '字幕の位置を調整する',
  kind: 'edit', target: { outputT: 1, src: 'clip.mp4', sourceT: 1, cutIndex: 0, refs: ['cut:0'], region: null },
  evidence: { memo: 'c-0001', speech: [0, 1], quote: '字幕を動かす', ink: [] }, confidence: 'low',
  needsConfirm: true, question: '位置を確認してください', risk: 'reversible', route: 'agent', priority: 0, dependsOn: [] }] };
const mode = process.env.FAKE_TASKIFY_MODE;
if (mode === 'timeout') await new Promise(resolve => setInterval(resolve, 60_000));
if (mode === 'exit') process.exit(1);
if (mode === 'login') { process.stdout.write(JSON.stringify({ is_error: true, result: 'Not logged in' })); process.exit(1); }
if (mode === 'rate' && count < 1) { process.stdout.write(JSON.stringify({ is_error: true, result: 'rate limit' })); process.exit(1); }
if (mode === 'schema') { process.stdout.write('Error: --json-schema is not a valid JSON Schema'); process.exit(1); }
if (mode === 'bad' || mode === 'repair' && count < 1) { process.stdout.write('{broken'); process.exit(0); }
if (args[0] === 'exec') {
  await writeFile(args[args.indexOf('-o') + 1], JSON.stringify(result));
  process.stdout.write('{"type":"turn.completed"}\n');
} else process.stdout.write(JSON.stringify({ is_error: false, structured_output: result, usage: { input_tokens: 100 } }));
