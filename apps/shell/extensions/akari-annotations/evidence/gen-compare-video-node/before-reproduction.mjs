import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { runVideoCommand } from '../../../../../../packages/generate/src/cli/video.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-before-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let server;
try {
  // 修正前の node 口を Git object から取り出す。作業ツリーには触れない。
  const historicalRef = 'b60cfa7db';
  const historicalPath = 'apps/shell/extensions/akari-annotations/src/node/generation-cli.ts';
  const historicalSource = execFileSync('git', ['show', `${historicalRef}:${historicalPath}`], { cwd: repo, encoding: 'utf8' });
  const requireFromShell = createRequire(path.join(repo, 'apps/shell/package.json'));
  const ts = requireFromShell('typescript');
  const historicalJs = ts.transpileModule(historicalSource,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const historicalModule = path.join(root, 'historical-generation-cli.cjs');
  await writeFile(historicalModule, historicalJs);
  const { GenerationCliManager } = requireFromShell(historicalModule);
  let child;
  const manager = new GenerationCliManager({ env: { AKARI_GENERATE_CLI: path.join(root, 'stub-cli.mjs') },
    spawnImpl: () => {
      child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.exitCode = null;
      child.kill = () => true;
      return child;
    } });
  const firstModel = 'fal:h3-i2v';
  const secondModel = 'fal:kling-v3-standard-i2v';
  const first = manager.run('clip-a', ['generate', 'video', root, '--item', 'clip-a', '--model', firstModel]);
  await new Promise(resolve => setImmediate(resolve));
  const second = await manager.run('clip-a', ['generate', 'video', root, '--item', 'clip-a', '--model', secondModel]);
  child.emit('close', 0);
  await first;
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'この item は生成中です。');

  // 通常モードの CLI をローカル HTTP スタブで完走させ、edit 差し替えをハッシュで記録する。
  const project = path.join(root, 'project');
  await cp(path.join(repo, 'packages/generate/test/fixtures/cli-video'), project, { recursive: true });
  const editPath = path.join(project, 'edit.json');
  const before = await readFile(editPath);
  const beforeItem = JSON.parse(before).tracks[0].items[0];
  const videoBytes = await readFile(path.join(repo, 'packages/generate/test/fixtures/cli-video/assets/generated/done.mp4'));
  let stubReceives = 0;
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.method === 'POST') {
      stubReceives++;
      for await (const _ of req) { /* consume */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ request_id: 'before-1', status_url: `${origin}/status`, response_url: `${origin}/response` }));
    } else if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'COMPLETED' }));
    } else if (url.pathname === '/response') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ video: { url: `${origin}/video` } }));
    } else if (url.pathname === '/video') {
      res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(videoBytes);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const logs = [];
  const generated = await runVideoCommand([project, '--item', 'clip-a', '--model', firstModel,
    '--prompt', 'A garden moves.', '--resolution', '768P', '--yes'], {
    env: { AKARI_FAL_STUB_URL: `http://127.0.0.1:${server.address().port}`, FAL_KEY: 'local-stub-key',
      AKARI_HOME: path.join(root, 'isolated-home') },
    resolveFalKeyImpl: () => ({ key: 'local-stub-key', key_source: 'test' }),
    snapshotImpl: async () => {}, pollIntervalMs: 0,
    log: line => logs.push(line), errorLog: line => logs.push(line),
  });
  assert.equal(generated.exitCode, 0, logs.join(' / '));
  const after = await readFile(editPath);
  const afterEdit = JSON.parse(after);
  const afterItem = afterEdit.tracks[0].items[0];
  assert.notEqual(sha(before), sha(after));
  assert.equal(afterItem.source.src, 'gen-clip-a-video');
  assert.equal(stubReceives, 1);
  const result = {
    phase: 'BEFORE',
    historicalLock: { ref: historicalRef, sourceSha256: sha(historicalSource), itemId: 'clip-a',
      firstModel, secondModel, secondStart: { ok: second.ok, reason: second.reason } },
    normalVideo: { stubReceives, editSha256Before: sha(before), editSha256After: sha(after),
      beforeItem, afterItem, outputPath: afterEdit.sources.find(row => row.id === afterItem.source.src)?.path },
  };
  await writeFile(path.join(here, 'before.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ locked: second.reason, editChanged: sha(before) !== sha(after), stubReceives }));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
