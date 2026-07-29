#!/usr/bin/env node
/**
 * PR #12 review checklist — automated verification with evidence output.
 * Usage: node scripts/verify-pr12-review.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function pass(id, msg, evidence = '') {
  results.push({ id, ok: true, msg, evidence });
  console.log(`PASS  [${id}] ${msg}${evidence ? `\n       ${evidence}` : ''}`);
}
function fail(id, msg, evidence = '') {
  results.push({ id, ok: false, msg, evidence });
  console.error(`FAIL  [${id}] ${msg}${evidence ? `\n       ${evidence}` : ''}`);
}

async function waitForServer(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/timeline`, (res) => {
          res.resume();
          res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on('error', reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server start timeout');
}

function startServer(projectDir, port) {
  const proc = spawn('node', [
    path.join(root, 'packages/preview-server/src/server.mjs'),
    projectDir,
    '--port', String(port),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return proc;
}

async function httpJson(method, port, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// B1: seek handler opens popup (static source check)
{
  const app = fs.readFileSync(path.join(root, 'packages/preview-server/public/app.js'), 'utf8');
  if (app.includes("seek.addEventListener('input', () => { showCutInfoAt(Number(seek.value));")) {
    pass('B1', 'シークバー input で showCutInfoAt を呼ぶ');
  } else fail('B1', 'シークバー input ハンドラ未修正');
}

// B2: lint tmp file
{
  const server = fs.readFileSync(path.join(root, 'packages/preview-server/src/server.mjs'), 'utf8');
  if (server.includes('await lintProject(projectRoot)') && !server.includes('await lintProject(editPath)')) {
    pass('B2', 'PUT lint が新 edit.json を projectRoot 経由で検査');
  } else fail('B2', 'PUT lint が旧 editPath/tmp のまま');
}

// B3: test-project lint + 422 message helper
{
  const lint = spawnSync('node', [path.join(root, 'packages/edit-lint/bin/edit-lint.mjs'), path.join(root, 'test-project')], { encoding: 'utf8' });
  const app = fs.readFileSync(path.join(root, 'packages/preview-server/public/app.js'), 'utf8');
  if (lint.status === 0 && app.includes('editSaveErrorMessage')) {
    pass('B3', 'test-project edit-lint PASS + 422 エラー表示関数あり', lint.stdout.trim().split('\n')[0]);
  } else fail('B3', 'test-project lint または 422 表示', lint.stdout + lint.stderr);
}

// B4: check_agent return
{
  const sh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  if (sh.includes('return 1') && sh.includes('No AI agent found') && !sh.includes('return $( [[ "$found" == "false" ]] )')) {
    pass('B4', 'install.sh check_agent 戻り値修正済み');
  } else fail('B4', 'check_agent 戻り値が未修正');
}

// B5: claude auto-confirm mapping + akari.sh arg forward
{
  const cli = fs.readFileSync(path.join(root, 'packages/akari-launcher/src/cli.mjs'), 'utf8');
  const akari = fs.readFileSync(path.join(root, 'akari.sh'), 'utf8');
  const harnessPath = path.join(root, 'packages/akari-launcher/src/harnesses.mjs');
  const harness = fs.existsSync(harnessPath) ? fs.readFileSync(harnessPath, 'utf8') : '';
  const ok = (cli.includes('acceptEdits') || harness.includes('acceptEdits'))
    && (akari.includes('"--opencode" "$@"') || akari.includes('akari.mjs" "$@"'));
  if (ok) pass('B5', 'Claude acceptEdits + akari.sh 引数転送');
  else fail('B5', 'ランチャー/akari.sh 未修正');
}

// B6: bind 127.0.0.1
const port = 4012 + (process.pid % 100);
const project = path.join(root, 'test-project');
let proc;
try {
  proc = startServer(project, port);
  await waitForServer(port);
  const listenOut = spawnSync('ss', ['-tlnp'], { encoding: 'utf8' }).stdout
    || spawnSync('netstat', ['-tlnp'], { encoding: 'utf8' }).stdout
    || '';
  if (listenOut.includes(`127.0.0.1:${port}`) && !listenOut.match(new RegExp(`0\\.0\\.0\\.0:${port}|\\*:${port}`))) {
    pass('B6', `プレビューサーバーが 127.0.0.1:${port} にバインド`, listenOut.split('\n').find((l) => l.includes(String(port)))?.trim());
  } else {
    fail('B6', '127.0.0.1 バインド未確認', listenOut.split('\n').filter((l) => l.includes(String(port))).join(' | '));
  }

  // B2 runtime: invalid PUT lints new content
  const bad = await httpJson('PUT', port, '/api/edit.json', {
    version: 0,
    output: { width: 1280, height: 720, fps: 30 },
    source: { path: 'source.mp4' },
    cuts: [{ in: 0, out: 5 }, { in: 2, out: 8 }],
    overlays: [],
  });
  const good = await httpJson('PUT', port, '/api/edit.json', JSON.parse(fs.readFileSync(path.join(project, 'edit.json'), 'utf8')));
  if (bad.status === 422 && good.status === 200) {
    pass('B2-RT', '不正 PUT→422 / 正当 PUT→200', `422 findings=${Array.isArray(bad.body.findings) ? bad.body.findings.length : 'n/a'}`);
  } else {
    fail('B2-RT', 'PUT lint 実機検証失敗', `bad=${bad.status} good=${good.status}`);
  }
} catch (e) {
  fail('B6', 'サーバー起動/検証エラー', e.message);
} finally {
  if (proc) proc.kill('SIGTERM');
}

// M1: waveform path resolution
{
  const app = fs.readFileSync(path.join(root, 'packages/preview-server/public/app.js'), 'utf8');
  if (app.includes('resolveMediaUrl') && app.includes('audio.bgm.path')) {
    pass('M1', 'BGM/ナレーション波形が path を URL 解決');
  } else fail('M1', 'resolveMediaUrl 未実装');
}

// M2: reloadSummary instead of {ok:true}
{
  const app = fs.readFileSync(path.join(root, 'packages/preview-server/public/app.js'), 'utf8');
  const bad = (app.match(/if \(res\.ok\) \{ summary = await res\.json\(\)/g) || []).length;
  if (app.includes('async function reloadSummary') && bad === 0) {
    pass('M2', 'PUT 成功後は reloadSummary（{ok:true} で summary 上書きしない）');
  } else fail('M2', `summary = await res.json() が ${bad} 箇所残存`);
}

// M3: intake.json path
{
  const sh = fs.readFileSync(path.join(root, 'akari.sh'), 'utf8');
  const cmd = fs.readFileSync(path.join(root, 'akari.cmd'), 'utf8');
  if (sh.includes('.akari/intake.json') && cmd.includes('.akari\\intake.json') && !sh.includes('> "$PROJECT/intake.json"')) {
    pass('M3', 'scaffold が .akari/intake.json を作成');
  } else fail('M3', 'intake.json パス未修正');
}

// M4: .opencode/skills symlinks
{
  const dir = path.join(root, '.opencode/skills');
  const count = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  if (count === 17) pass('M4', '.opencode/skills symlink 17 本', `count=${count}`);
  else fail('M4', '.opencode/skills 不足', `count=${count}`);
}

// M5: PUBLIC_DIR fileURLToPath
{
  const server = fs.readFileSync(path.join(root, 'packages/preview-server/src/server.mjs'), 'utf8');
  if (server.includes('fileURLToPath') && server.includes("fileURLToPath(new URL('../public/'")) {
    pass('M5', 'PUBLIC_DIR が fileURLToPath 使用');
  } else fail('M5', 'PUBLIC_DIR Windows 対応未修正');
}

// M6: install.ps1 akari.cmd
{
  const ps1 = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  if (ps1.includes('akari.cmd') && !ps1.includes('akari.ps1')) pass('M6', 'install.ps1 Quick Start が akari.cmd を案内');
  else fail('M6', 'install.ps1 の akari.ps1 参照残存');
}

// M7: git required
{
  const sh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  const ps1 = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  if (sh.includes('git is required') && ps1.includes('git is required')) pass('M7', 'install 脚本が git 未導入を検出');
  else fail('M7', 'git 検出未実装');
}

// M8: read from /dev/tty
{
  const sh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  if (sh.includes('</dev/tty')) pass('M8', 'install.sh の read が /dev/tty 使用');
  else fail('M8', 'read /dev/tty 未修正');
}

// M9: test media provenance doc
{
  const media = path.join(root, 'test-project/MEDIA.md');
  if (fs.existsSync(media) && fs.readFileSync(media, 'utf8').includes('ffmpeg')) {
    pass('M9', 'test-project/MEDIA.md に ffmpeg 生成手順');
  } else fail('M9', 'MEDIA.md なし');
}

// gen-skills-index
{
  const r = spawnSync('node', [path.join(root, 'scripts/gen-skills-index.mjs'), '--check'], { encoding: 'utf8', cwd: root });
  if (r.status === 0) pass('CI', 'gen-skills-index --check', r.stdout.trim());
  else fail('CI', 'gen-skills-index --check', r.stderr || r.stdout);
}

// launcher tests
{
  const testFiles = ['test/cli.test.mjs'];
  const harnessTest = path.join(root, 'packages/akari-launcher/test/harnesses.test.mjs');
  if (fs.existsSync(harnessTest)) testFiles.push('test/harnesses.test.mjs');
  const r = spawnSync('node', ['--test', ...testFiles], {
    cwd: path.join(root, 'packages/akari-launcher'),
    encoding: 'utf8',
  });
  if (r.status === 0) pass('CI', 'akari-launcher tests', testFiles.join(', '));
  else fail('CI', 'akari-launcher tests', r.stderr.slice(-500));
}

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(`Total: ${results.length}, PASS: ${results.length - failed.length}, FAIL: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
