#!/usr/bin/env node
// Windows の隔離起動: 公開済み manifest、架空の新版、配信不能を設定画面で確認する。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from '../../../akari-shell-strip/evidence/right-rail-regroup/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '../../../..');
const electron = path.join(shell, 'node_modules/electron/dist/electron.exe');
const scratch = process.env.AKARI_UPDATER_L1_DIR;
if (!scratch) throw new Error('AKARI_UPDATER_L1_DIR を隔離ディレクトリへ指定してください');
const manifest = readFileSync(path.join(here, 'latest.yml'), 'utf8');
const results = [];

async function waitFor(fn, label, timeout = 180000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const value = await fn(); if (value) { return value; } } catch { /* startup */ }
    await sleep(300);
  }
  throw new Error(`timeout: ${label}`);
}

const readAbout = page => evalOn(page, `(() => {
  const d = document.querySelector('[data-akari-settings-dialog]');
  if (!d) return null;
  const section = [...d.querySelectorAll('section, [id]')].find(e => e.id && e.id.includes('about') && e.offsetParent !== null && e.innerText.includes('受け取る版'));
  if (!section) return null;
  const all = section.innerText;
  const cut = all.indexOf('受け取る版');
  const text = (cut >= 0 ? all.slice(0, cut) : all).split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
  const row = [...section.querySelectorAll('*')].find(e => e.textContent.trim() === '受け取る版');
  const limit = row ? row.getBoundingClientRect().top : Infinity;
  const buttons = [...section.querySelectorAll('button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && r.top < limit; }).map(b => {
    const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  return { text, buttons };
})()`);

async function screenshot(page, name) {
  const clip = await evalOn(page, `(() => { const d = document.querySelector('[data-akari-settings-dialog] .dialogBlock') || document.querySelector('[data-akari-settings-dialog]'); const r = d.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height, scale: 1 }; })()`);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip });
  await writeFile(path.join(here, `${name}.png`), Buffer.from(data, 'base64'));
}

async function runScenario(scenario, index) {
  console.log(`starting ${scenario}`);
  const dir = path.join(scratch, scenario);
  const home = path.join(dir, 'akari');
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, 'update-preferences.json'), JSON.stringify({ channel: 'prerelease', autoCheck: false }));
  const feedPort = 49210 + index;
  const cdpPort = 49310 + index;
  const requests = [];
  let server;
  if (scenario !== 'unreachable') {
    server = createServer((req, res) => {
      const url = req.url.split('?')[0];
      requests.push(url);
      if (url === '/latest.yml') {
        const yml = scenario === 'new-version'
          ? manifest.replace('version: 0.1.94', 'version: 99.0.0').replaceAll(
            'https://github.com/AkariLabs/akari-video/releases/download/v0.1.94/shell-win-setup.exe',
            `http://127.0.0.1:${feedPort}/unavailable.exe`)
          : manifest;
        res.writeHead(200, { 'content-type': 'text/yaml' }); res.end(yml); return;
      }
      if (url === '/unavailable.exe' || url === '/unavailable.exe.blockmap') { return; }
      if (url === '/latest.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ schema: 1, product: '0.1.94', channel: 'prerelease', released: '2026-09-27', components: {} })); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(feedPort, '127.0.0.1', resolve));
  }
  const env = { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: path.join(dir, 'theia'),
    AKARI_UPDATER_TEST_FEED_URL: `http://127.0.0.1:${feedPort}/`, AKARI_UPDATE_FEED_URL: `http://127.0.0.1:${feedPort}/latest.json` };
  delete env.ELECTRON_RUN_AS_NODE;
  const fd = openSync(path.join(dir, 'electron.log'), 'w');
  const child = spawn(electron, [shell, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${path.join(dir, 'user-data')}`, '--no-sandbox'],
    { cwd: shell, env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  let page;
  try {
    const target = await waitFor(async () => (await listTargets(cdpPort)).find(t => t.type === 'page'), 'renderer');
    page = new CDP(target.webSocketDebuggerUrl);
    await page.connect();
    await waitFor(async () => {
      const ready = await evalOn(page, `!!window.theia?.container`);
      if (!ready) return false;
      const opened = await evalOn(page, `!!document.querySelector('[data-akari-settings-dialog]')`);
      if (opened) return true;
      await evalOn(page, `(() => { const d = document.querySelector('[role="dialog"]'); const c = d?.querySelector('[aria-label="閉じる"], .codicon-close'); if (c) c.click(); const b = window.theia.container._bindingDictionary; const k = [...b._map.keys()].find(k => typeof k === 'function' && typeof k.prototype?.executeCommand === 'function'); if (k) void window.theia.container.get(k).executeCommand('akari.settings.open', { section: 'about' }); return true; })()`);
      return false;
    }, 'settings dialog');
    console.log(`${scenario}: settings open`);
    const initial = await waitFor(async () => { const a = await readAbout(page); return a?.buttons.some(b => b.text === 'アップデートを確認') ? a : null; }, 'settings');
    console.log(`${scenario}: settings ready`);
    // この開発ビルドでは Theia の起動スプラッシュが DOM に残る。観測時のみ隠す。
    await evalOn(page, `(() => { const p = document.querySelector('.theia-preload'); if (p) p.style.display = 'none'; return true; })()`);
    await page.send('Page.bringToFront');
    await evalOn(page, `(() => { const d = document.querySelector('[data-akari-settings-dialog]'); const b = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'アップデートを確認'); b.click(); return true; })()`);
    console.log(`${scenario}: check clicked`);
    const expected = scenario === 'unreachable' ? 'もう一度確かめる' : scenario === 'new-version' ? 'ダウンロード中' : '最新です';
    const observed = await waitFor(async () => { const a = await readAbout(page); return a?.text.some(t => t.includes(expected)) || a?.buttons.some(b => b.text.includes(expected)) ? a : null; }, expected, 120000);
    await sleep(500);
    await screenshot(page, scenario);
    const text = observed.text.join(' ');
    const pass = scenario === 'unreachable' ? !/HttpError|ECONN|headers|stack|Cannot find/.test(text)
      : scenario === 'new-version' ? requests.includes('/latest.yml') : requests.every(url => !url.includes('0.1.95'));
    results.push({ scenario, status: pass ? 'PASS' : 'FAIL', splashHiddenForCapture: true, text, requests });
  } catch (error) {
    results.push({ scenario, status: 'ERROR', error: String(error.message ?? error).replace(/[A-Z]:\\[^\s:'"]+/gi, '<path>'), requests });
  } finally {
    page?.close();
    // この呼び出しが起動したプロセス木のみ終了する。
    if (child.pid) await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('exit', resolve); killer.once('error', resolve);
    });
    server?.closeAllConnections(); server?.close();
  }
}

await mkdir(scratch, { recursive: true });
const scenarios = ['published', 'new-version', 'unreachable'];
for (const [index, scenario] of scenarios.entries()) { if (!process.argv[2] || process.argv[2] === scenario) await runScenario(scenario, index); }
await writeFile(path.join(here, `l1-${process.argv[2] ?? 'all'}-results.json`), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ scenario, status, requests }) => ({ scenario, status, requests }))));
if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
