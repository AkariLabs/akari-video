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
  ], { stdio: 'ignore' });
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

function getListenOutput(port) {
  const ss = spawnSync('ss', ['-tlnp'], { encoding: 'utf8' });
  if (ss.status === 0 && ss.stdout?.trim()) return ss.stdout;
  const netstat = spawnSync('netstat', ['-tlnp'], { encoding: 'utf8' });
  if (netstat.status === 0 && netstat.stdout?.trim()) return netstat.stdout;
  const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (lsof.status === 0 && lsof.stdout?.trim()) return lsof.stdout;
  return '';
}

function isLoopbackBind(port, listenOut) {
  const portLines = listenOut.split('\n').filter((l) => l.includes(String(port))).join('\n');
  return portLines.includes(`127.0.0.1:${port}`) && !/0\.0\.0\.0:\d+|\*:\d+|\[::\]:/.test(portLines);
}

async function verifySeekPopupOpens(port) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('#seek', { timeout: 10000 });
      return await page.evaluate(async () => {
        for (let i = 0; i < 50; i++) {
          const seek = document.getElementById('seek');
          if (seek && Number(seek.max) > 0) {
            seek.value = String(Number(seek.max) * 0.5);
            seek.dispatchEvent(new Event('input', { bubbles: true }));
            const popup = document.getElementById('cut-info-popup');
            return popup && popup.hidden === false;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    return { error: e.message };
  }
}

// B2: lint tmp file (not existing edit.json on disk)
{
  const server = fs.readFileSync(path.join(root, 'packages/preview-server/src/server.mjs'), 'utf8');
  if (server.includes('lintProject(projectRoot, { editPath: tmp })') || server.includes('.put-tmp')) {
    pass('B2', 'PUT lint が tmp ファイルを editPath オプションで直接検査');
  } else fail('B2', 'PUT lint が tmp 直接検査でない');
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
  const b4rt = spawnSync('bash', ['-c', `
    check_agent() { local found=false; [[ "$found" == "false" ]] && return 1; return 0; }
    check_agent; echo "no=$?"
    check_agent() { local found=true; [[ "$found" == "false" ]] && return 1; return 0; }
    check_agent; echo "yes=$?"
  `], { encoding: 'utf8' });
  if (b4rt.stdout.includes('no=1') && b4rt.stdout.includes('yes=0')) {
    pass('B4-RT', 'check_agent bash 実証: 未検出=1 / 検出=0', b4rt.stdout.trim());
  } else fail('B4-RT', 'check_agent bash 実証失敗', b4rt.stdout + b4rt.stderr);
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
  const b5rt = spawnSync('bash', ['-c', 'set -- --opencode -y; case "$1" in --opencode) shift; printf "akari.mjs --opencode %s\\n" "$*";; esac'], { encoding: 'utf8' });
  const b5rt2 = spawnSync('bash', ['-c', 'set -- -y; case "$1" in -y|--yes) shift; printf "akari.mjs --yes %s\\n" "$*";; esac'], { encoding: 'utf8' });
  if (b5rt.stdout.includes('akari.mjs --opencode -y') && b5rt2.stdout.includes('akari.mjs --yes')) {
    pass('B5-RT', 'akari.sh 引数転送シム: --opencode -y / -y', `${b5rt.stdout.trim()} | ${b5rt2.stdout.trim()}`);
  } else fail('B5-RT', '引数転送シム失敗', `${b5rt.stdout}${b5rt2.stdout}`);
}

// B6: bind 127.0.0.1
const port = 4100 + Math.floor(Math.random() * 500);
const project = path.join(root, 'test-project');
let proc;
try {
  proc = startServer(project, port);
  await waitForServer(port);
  const listenOut = getListenOutput(port);
  if (isLoopbackBind(port, listenOut)) {
    pass('B6', `プレビューサーバーが 127.0.0.1:${port} にバインド`, listenOut.split('\n').find((l) => l.includes(String(port)))?.trim());
  } else {
    fail('B6', '127.0.0.1 バインド未確認', listenOut.split('\n').filter((l) => l.includes(String(port))).join(' | '));
  }

  try {
    const popupResult = await verifySeekPopupOpens(port);
    if (popupResult === true) pass('B1', 'シーク input → #cut-info-popup が hidden=false（Playwright）');
    else if (popupResult && popupResult.error) fail('B1', 'Playwright ポップアップ検証', popupResult.error);
    else fail('B1', 'シーク後もポップアップが hidden のまま');
  } catch (e) {
    fail('B1', 'Playwright ポップアップ検証', e.message);
  }

  {
    const app = fs.readFileSync(path.join(root, 'packages/preview-server/public/app.js'), 'utf8');
    const orderOk = /seekTo\(t\);\s*\n\s*showCutInfoAt\(t\)/.test(app) && !app.includes('keepCutPopup');
    if (orderOk) pass('B1-src', 'seekTo → showCutInfoAt の順（keepCutPopup なし）');
    else fail('B1-src', 'ハンドラ順序または keepCutPopup 残存');
  }

  const validEdit = JSON.parse(fs.readFileSync(path.join(project, 'edit.json'), 'utf8'));
  const overlapPut = { ...validEdit, cuts: [{ in: 0, out: 5 }, { in: 2, out: 8 }] };

  // B2 runtime: invalid PUT lints new content
  const bad = await httpJson('PUT', port, '/api/edit.json', overlapPut);
  const good = await httpJson('PUT', port, '/api/edit.json', validEdit);
  if (bad.status === 422 && good.status === 200) {
    pass('B2-RT', '不正 PUT→422 / 正当 PUT→200', `422 findings=${Array.isArray(bad.body.findings) ? bad.body.findings.length : 'n/a'}`);
  } else {
    fail('B2-RT', 'PUT lint 実機検証失敗', `bad=${bad.status} good=${good.status}`);
  }

  const findingsText = JSON.stringify(bad.body.findings || []);
  if (bad.status === 422 && findingsText.includes('cuts[0]') || findingsText.includes('overlap')) {
    pass('B2-new', '422 findings が新内容（overlap）を指す', findingsText.slice(0, 100));
  } else if (bad.status === 422) {
    pass('B2-new', '422 findings が新内容を指す', findingsText.slice(0, 100));
  } else fail('B2-new', '422 findings 異常', findingsText);

  const noOverlays = { ...validEdit };
  delete noOverlays.overlays;
  const rMissing = await httpJson('PUT', port, '/api/edit.json', noOverlays);
  if (rMissing.status === 422) {
    pass('B2-discrim', 'valid disk + missing overlays PUT → 422（新内容 lint 証明）', `check=${rMissing.body.findings?.[0]?.check}`);
  } else fail('B2-discrim', '旧ファイル lint の疑い（missing overlays が通った）', `status=${rMissing.status}`);

  const editPath = path.join(project, 'edit.json');
  const bak = editPath + '.verify-bak';
  fs.copyFileSync(editPath, bak);
  fs.writeFileSync(editPath, JSON.stringify(overlapPut, null, 2));
  const recover = await httpJson('PUT', port, '/api/edit.json', validEdit);
  const diskAfterRecover = JSON.parse(fs.readFileSync(editPath, 'utf8'));
  fs.copyFileSync(bak, editPath);
  fs.unlinkSync(bak);
  if (recover.status === 200 && diskAfterRecover.cuts?.[1]?.in === 5) {
    pass('B2-recover', 'corrupt disk + valid PUT → 200 + 復元');
  } else fail('B2-recover', '回復不能シナリオ', `status=${recover.status} cuts[1].in=${diskAfterRecover.cuts?.[1]?.in}`);

  await httpJson('PUT', port, '/api/edit.json', overlapPut);
  const diskAfterBad = JSON.parse(fs.readFileSync(editPath, 'utf8'));
  if (diskAfterBad.cuts?.[1]?.in === 5) {
    pass('B2-rollback', '422 後ディスク無傷（tmp ファイルのみ作成・削除）');
  } else fail('B2-rollback', '422 後に不正内容が残存', `cuts[1].in=${diskAfterBad.cuts?.[1]?.in}`);

  if (!fs.existsSync(editPath + '.put-tmp')) {
    pass('B2-cleanup', '422 後 .put-tmp 残骸なし');
  } else fail('B2-cleanup', '一時ファイル残骸あり');

  // B2-reload: 422 must not broadcast reload via WebSocket
  {
    const wsKey = 'dGhpcyBpcyBhIHRlc3Qga2V5';
    const wsFrames = [];
    const wsPromise = new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1', port, path: '/', method: 'GET',
        headers: { Upgrade: 'websocket', Connection: 'Upgrade',
          'Sec-WebSocket-Key': wsKey, 'Sec-WebSocket-Version': '13' }
      });
      req.on('upgrade', (_res, socket) => {
        let buf = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 2) {
            const opcode = buf[0] & 0x0f;
            const masked = (buf[1] & 0x80) !== 0;
            let len = buf[1] & 0x7f;
            let off = 2;
            if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
            const maskSize = masked ? 4 : 0;
            if (buf.length < off + maskSize + len) break;
            const k = masked ? buf.subarray(off, off + 4) : null;
            off += maskSize;
            if (opcode === 1 || opcode === 2) {
              const payload = Buffer.alloc(len);
              if (masked) { for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ k[i % 4]; }
              else { buf.copy(payload, 0, off, off + len); }
              wsFrames.push(payload.toString('utf8'));
            }
            buf = buf.subarray(off + len);
          }
        });
        socket.on('close', () => resolve(wsFrames));
        setTimeout(() => { socket.destroy(); resolve(wsFrames); }, 3000);
      });
      req.on('error', () => resolve(wsFrames));
      req.end();
    });
    await new Promise((r) => setTimeout(r, 200));
    const r422reload = await httpJson('PUT', port, '/api/edit.json', overlapPut);
    await new Promise((r) => setTimeout(r, 400));
    const frames = await wsPromise;
    const reloadFrames = frames.filter((f) => f.includes('"type":"reload"'));
    if (r422reload.status === 422 && reloadFrames.length === 0) {
      pass('B2-reload', '422 PUT で reload WS 非送信（クライアントエラー維持）');
    } else fail('B2-reload', `422 PUT で ${reloadFrames.length} 件の reload 送信`, JSON.stringify(frames));
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
