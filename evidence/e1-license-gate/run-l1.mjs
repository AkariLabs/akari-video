#!/usr/bin/env node

// L1: 実機の Electron シェルで書き出しポップアップを開き、ライセンスの行（商用不可 = 赤 /
// 不明 = 灰 / 帰属表示 = 案内 + クレジットをコピー）を観測する。
//   node evidence/e1-license-gate/run-l1.mjs before   … 行が何も出ないこと（実装前の記録）
//   node evidence/e1-license-gate/run-l1.mjs after    … 3 行・名前の一覧・クリップボード・書き出し完走
// 環境変数: AKARI_CDP_PORT（既定 9546）

import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(evidenceDir, 'fixture-project');
const repoRoot = path.resolve(evidenceDir, '..', '..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const templateDir = path.join(repoRoot, 'templates', 'project-default');
const electron = path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const port = Number(process.env.AKARI_CDP_PORT ?? 9546);

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `libcanvas-e1-${phase}-`)));
const project = path.join(scratch, 'project');
const profile = path.join(scratch, 'profile');
const config = path.join(scratch, 'config');
const akariHome = path.join(scratch, 'akari-home');

await mkdir(project, { recursive: true });
await cp(templateDir, project, { recursive: true });
await cp(fixtureDir, project, { recursive: true });
await Promise.all([mkdir(profile), mkdir(config), mkdir(akariHome)]);
// 単色・無音だと render-cut の検査（verify.blank-frames / verify.audio-level）に掛かるので、試験パターン + 正弦波にする
for (const [dir, pattern] of [['nc-clip', 'testsrc2'], ['unknown-clip', 'smptebars'], ['by-clip', 'rgbtestsrc']]) {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `${pattern}=s=320x180:r=30:d=2`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(project, 'assets', 'broll', dir, 'clip.mp4')]);
  if (made.status !== 0) throw new Error(made.stderr.toString());
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 120000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

async function waitForJson(url, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await (await fetch(url)).json();
      if (predicate(value)) return value;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitFor(main, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(main, expression).catch(() => undefined);
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`timed out: ${expression.slice(0, 120)}`);
}

async function executeCommand(main, command, argument) {
  return evaluate(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function' && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry unavailable' };
      await window.theia.container.get(CommandClass).executeCommand(${JSON.stringify(command)}, ${JSON.stringify(argument)});
      return { ok: true };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  })()`);
}

async function shot(main, name, selector = '.akari-export-dialog-host .popup') {
  const rect = await evaluate(main, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  const params = { format: 'png', fromSurface: true };
  if (rect) params.clip = { ...rect, scale: 1 };
  const result = await main.send('Page.captureScreenshot', params);
  const file = path.join(evidenceDir, `${phase}-${name}.png`);
  await writeFile(file, Buffer.from(result.data, 'base64'));
  return path.relative(repoRoot, file);
}

const clickByText = (text, scope = 'document') => `(() => {
  const root = ${scope};
  if (!root) return false;
  const b = [...root.querySelectorAll('button')].find(x => x.textContent?.trim().startsWith(${JSON.stringify(text)}) && !x.disabled);
  if (!b) return false; b.click(); return true;
})()`;

const result = { phase, project: 'tmp/libcanvas-e1-*/project', steps: [] };
let child;
let main;
try {
  spawnSync('pbcopy', { input: 'libcanvas-e1-clipboard-sentinel' });
  child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: shellDir, env: { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome }, stdio: 'ignore',
  });
  result.pid = child.pid;
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`,
    values => values.find(value => value.type === 'page' && !value.url.startsWith('devtools:')), 90000);
  const target = targets.find(value => value.type === 'page' && !value.url.startsWith('devtools:'));
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  await waitFor(main, `Boolean(window.theia?.container)`, 120000);
  await sleep(8000);
  await evaluate(main, clickByText('開くだけ'));

  // メニューを出して「書き出し…」を押す（edit.json の存在確認が終わるまで押せない）
  const opened = await (async () => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await executeCommand(main, 'akari.menu.focus');
      await sleep(1000);
      if (await evaluate(main, clickByText('書き出し…'))) {
        const ok = await waitFor(main, `Boolean(document.querySelector('.akari-export-dialog-host .popup'))`, 10000).catch(() => false);
        if (ok) return true;
      }
      await sleep(1500);
    }
    return false;
  })();
  if (!opened) throw new Error('export dialog did not open');
  await sleep(3000);

  const popupState = () => evaluate(main, `(() => {
    const popup = document.querySelector('.akari-export-dialog-host .popup');
    const rows = [...(popup?.querySelectorAll('[data-akari-license-row]') ?? [])].map(row => ({
      kind: row.getAttribute('data-akari-license-row'),
      text: row.textContent.replace(/\\s+/g, ' ').trim(),
      color: getComputedStyle(row).color,
      background: getComputedStyle(row).backgroundColor,
    }));
    const start = [...(popup?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim().startsWith('書き出す'));
    return {
      title: popup?.querySelector('.ttl')?.textContent ?? null,
      popupHeight: popup ? Math.round(popup.getBoundingClientRect().height) : null,
      leftClipped: (() => { const left = popup?.querySelector('.pb>.left'); return left ? left.scrollHeight > left.clientHeight + 1 : null; })(),
      licenseRows: rows,
      mentionsLicense: /商用|ライセンス|帰属|クレジット/.test(popup?.innerText ?? ''),
      startButton: start ? { text: start.textContent.trim(), disabled: start.disabled } : null,
    };
  })()`);

  const setup = await popupState();
  result.steps.push({ step: 'open-popup', ...setup, screenshot: await shot(main, 'popup') });

  if (phase === 'after') {
    // 行を押すと名前の一覧が出る
    const expanded = await evaluate(main, `(async () => {
      const out = {};
      for (const row of document.querySelectorAll('.akari-export-dialog-host [data-akari-license-row]')) {
        const toggle = row.querySelector('[data-akari-license-toggle]') ?? row;
        toggle.click();
        await new Promise(r => setTimeout(r, 300));
        const list = row.querySelector('[data-akari-license-names]') ?? row.parentElement?.querySelector('[data-akari-license-names]');
        out[row.getAttribute('data-akari-license-row')] = list ? list.textContent.replace(/\\s+/g, ' ').trim() : null;
      }
      return out;
    })()`);
    result.steps.push({ step: 'expand-names', expanded, screenshot: await shot(main, 'popup-expanded') });

    // 実際のマウス操作（CDP Input）で押す: 利用者の操作と同じ経路を通す
    const realClick = async selector => {
      const rect = await evaluate(main, `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        node.scrollIntoView({ block: 'nearest' });
        const r = node.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: node.textContent.trim() };
      })()`);
      if (!rect) return null;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await main.send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      }
      return rect.text;
    };
    const copied = await realClick('.akari-export-dialog-host [data-akari-license-copy-credit]');
    await sleep(1500);
    const clipboard = spawnSync('pbpaste', { encoding: 'utf8' }).stdout;
    const copyLabelAfter = await evaluate(main, `document.querySelector('.akari-export-dialog-host [data-akari-license-copy-credit]')?.textContent?.trim() ?? null`);
    result.steps.push({ step: 'copy-credit', clickedLabel: copied, labelAfter: copyLabelAfter, clipboard,
      screenshot: await shot(main, 'copied') });

    await evaluate(main, `(() => {
      const b = [...document.querySelectorAll('.akari-export-dialog-host .popup button')].find(x => x.textContent.trim().startsWith('書き出す'));
      if (b) b.setAttribute('data-l1-start', '1'); return Boolean(b);
    })()`);
    const started = await realClick('.akari-export-dialog-host [data-l1-start]');
    const startedAt = Date.now();
    const transitions = [];
    const done = await (async () => {
      const deadline = Date.now() + 300000;
      let last = '';
      while (Date.now() < deadline) {
        const state = await evaluate(main, `(() => {
          const popup = document.querySelector('.akari-export-dialog-host .popup');
          const mini = document.querySelector('[data-akari-export-mini-status]');
          return { open: Boolean(popup), title: popup?.querySelector('.ttl')?.textContent ?? null,
            sub: popup?.querySelector('.sub')?.textContent ?? null, mini: mini?.getAttribute('data-akari-export-mini-status') ?? null };
        })()`).catch(() => null);
        const key = JSON.stringify(state);
        if (key !== last) { transitions.push({ ms: Date.now() - startedAt, ...state }); last = key; }
        if (state?.title === '書き出し完了' || state?.mini === 'done') return state;
        if (/lint で/.test(state?.sub ?? '') || state?.mini === 'failed') return { ...state, stopped: true };
        await sleep(500);
      }
      return { error: 'timeout' };
    })();
    result.steps.push({ step: 'export-transitions', transitions });
    const exportsDir = path.join(project, 'exports');
    const files = await readdir(exportsDir, { recursive: true }).catch(() => []);
    const mp4 = files.find(file => file.endsWith('.mp4'));
    let probe = null;
    if (mp4) {
      const out = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
        '-of', 'json', path.join(exportsDir, mp4)], { encoding: 'utf8' });
      probe = JSON.parse(out.stdout || 'null');
    }
    result.steps.push({ step: 'export', started, elapsedMs: Date.now() - startedAt, done, artifact: mp4 ?? null, probe,
      screenshot: await shot(main, 'done') });
  }
} catch (error) {
  result.error = error?.stack ?? String(error);
  if (main) result.errorScreenshot = await shot(main, 'error', 'body').catch(() => null);
} finally {
  main?.close();
  if (child?.pid) {
    // 自分が起動した Electron の子孫（Helper）も PID 指定で止める（一般パターンの pkill は使わない）
    const descendants = [];
    const walk = pid => {
      const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
      for (const kid of out) { descendants.push(Number(kid)); walk(kid); }
    };
    walk(child.pid);
    for (const pid of descendants) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
    await sleep(2000);
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}

await writeFile(path.join(evidenceDir, `${phase}-result.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.error ? 1 : 0;
