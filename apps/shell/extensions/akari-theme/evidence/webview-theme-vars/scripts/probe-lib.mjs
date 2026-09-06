// webview-theme-vars L1 共有ライブラリ。
// - シェル本体（メイン frame）と Codex 拡張の webview（OOPIF）の両方へ CDP でつなぐ
// - webview ホストページ（@theia/plugin-ext の pre/index.html）と、その中の
//   実コンテンツ frame（./fake.html?id=… = 同一オリジン）を扱う
// - 画素は Page.captureScreenshot（合成後のサーフェス）を ffmpeg で rgb24 に落として読む
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, listTargets } from './cdp-lib.mjs';

const execFileAsync = promisify(execFile);
export { sleep };

export const VIEW_W = 1600;
export const VIEW_H = 1000;

export async function waitFor(description, fn, timeout = 60000, interval = 200) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; last = v; } catch (e) { last = String(e).slice(0, 200); }
    await sleep(interval);
  }
  throw new Error(`timed out: ${description} (last=${JSON.stringify(last)?.slice(0, 300)})`);
}

// CDP の send は相手が消えると解決しないことがあるので、必ず時間で切る。
export function withTimeout(promise, ms, label = 'cdp') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms); })
  ]);
}

export async function evalIn(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const r = await withTimeout(cdp.send('Runtime.evaluate', params), 30000, 'Runtime.evaluate');
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

export async function connectMain(port) {
  const targets = await listTargets(port);
  const t = targets.find(x => x.type === 'page' && /localhost/u.test(x.url)) ?? targets.find(x => x.type === 'page');
  if (!t) throw new Error('main page target not found');
  const main = new CDP(t.webSocketDebuggerUrl);
  main.targetId = t.id;   // (d) で「増えたウィンドウだけ」を閉じるために持っておく
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await main.send('Page.bringToFront');
  await waitFor('frontend ready', () => evalIn(main, 'Boolean(window.theia && window.theia.container) && document.readyState === "complete"'), 120000);
  return main;
}

// Theia の DI コンテナから「prototype にこのメソッドを全部持つクラス」を引く共通式。
const findClassExpr = names => `(() => {
  const keys = [...window.theia.container._bindingDictionary._map.keys()];
  return keys.find(k => typeof k === 'function' && ${names.map(n => `typeof k.prototype?.${n} === 'function'`).join(' && ')});
})()`;

export const commandRegistryExpr = findClassExpr(['executeCommand', 'registerCommand']);
export const themeServiceExpr = findClassExpr(['setCurrentTheme', 'getCurrentTheme']);
export const shellExpr = findClassExpr(['collapsePanel', 'expandPanel', 'revealWidget']);

export async function runCommand(main, id, ...args) {
  return evalIn(main, `(async () => {
    const C = ${commandRegistryExpr};
    if (!C) return 'no-command-registry';
    try { return { ok: true, value: await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}${args.length ? ', ' + args.map(a => JSON.stringify(a)).join(', ') : ''}) }; }
    catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
  })()`);
}

export async function setTheme(main, id) {
  return evalIn(main, `(() => {
    const C = ${themeServiceExpr};
    if (!C) return 'no-theme-service';
    const svc = window.theia.container.get(C);
    svc.setCurrentTheme(${JSON.stringify(id)}, true);
    return svc.getCurrentTheme().id;
  })()`);
}

// webview の OOPIF ターゲット一覧（ホストページ = /webview/index.html?id=…）
export async function webviewTargets(port) {
  const list = await listTargets(port);
  return list.filter(t => (t.type === 'iframe' || t.type === 'page') && /webview\/index\.html/u.test(t.url));
}

// ホストページの中の「実コンテンツ frame」に対して式を評価する。
// pre/main.js は id=active-frame / pending-frame の iframe を同一オリジンで作るので contentDocument が読める。
export const innerExpr = body => `(() => {
  const frames = [...document.querySelectorAll('iframe')];
  const f = document.getElementById('active-frame') || frames[frames.length - 1];
  if (!f || !f.contentDocument) return null;
  const d = f.contentDocument;
  const html = d.documentElement;
  ${body}
})()`;

export const MEASURE = innerExpr(`
  const vars = [...html.style].filter(p => p.startsWith('--vscode-'));
  return {
    n: vars.length,
    bodyBackgroundColor: d.body ? getComputedStyle(d.body).backgroundColor : null,
    htmlBackgroundColor: getComputedStyle(html).backgroundColor,
    htmlColorScheme: getComputedStyle(html).colorScheme,
    themeKindHtml: html.getAttribute('data-vscode-theme-kind'),
    themeKindBody: d.body ? d.body.getAttribute('data-vscode-theme-kind') : null,
    bodyClass: d.body ? String(d.body.className).slice(0, 120) : null,
    title: d.title,
    codexMarker: Boolean(d.querySelector('[data-codex-window-type]')),
    sampleVars: vars.slice(0, 3)
  };
`);

export async function attachWebview(target) {
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

export async function measure(view) {
  return withTimeout(evalIn(view, MEASURE), 10000, 'measure');
}

// Codex のコンテンツを持つ webview を探す（title=Codex or data-codex-window-type）。
export async function findCodexWebview(port, timeout = 120000) {
  return waitFor('codex webview', async () => {
    for (const t of await webviewTargets(port)) {
      let view;
      try {
        view = await attachWebview(t);
        const m = await measure(view);
        if (m && (m.codexMarker || /codex/iu.test(String(m.title)))) return { target: t, view, measurement: m };
        view.close();
      } catch { try { view?.close(); } catch { /* noop */ } }
    }
    return null;
  }, timeout, 1000);
}

// メイン frame から見た、その webview の外側 iframe 矩形（CSS px = スクショ px）。
export async function iframeRect(main, targetUrl) {
  const id = new URL(targetUrl).searchParams.get('id');
  return evalIn(main, `(() => {
    const el = [...document.querySelectorAll('iframe.webview')].find(e => (e.getAttribute('src') || '').includes(${JSON.stringify('id=' + id)}));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
}

let decodeScratch;
export async function decodePng(file) {
  decodeScratch ??= await mkdtemp(path.join(tmpdir(), 'akari-wtv-px-'));
  const raw = path.join(decodeScratch, path.basename(file) + '.rgb');
  await execFileAsync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const probe = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  return { width, height, raw: await readFile(raw) };
}

export const pixelAt = (decoded, x, y) => {
  const px = Math.round(x); const py = Math.round(y);
  if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) return null;
  const o = (py * decoded.width + px) * 3;
  return [decoded.raw[o], decoded.raw[o + 1], decoded.raw[o + 2]];
};

export const maxDelta = (a, b) => (a && b ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : null);

export async function shot(main, file) {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}

// パネル内 3 点（左端から 2px・高さ 15/50/85%）と、その外側の参照点を読む。
// 実測（before-healthy）: カードレイアウトのため iframe のすぐ左 4px は
// カードの隙間 --akari-ground (5,5,5)。Theia 右パネルの面は 12px 外の (10,10,10)。
// 受け入れ条件の「隣接する Theia 右パネル背景」は後者（panel）を採る。
export function samplePanel(decoded, rect) {
  const ys = [0.15, 0.5, 0.85].map(f => rect.top + rect.height * f);
  const at = (x, y) => pixelAt(decoded, x, y);
  const inside = ys.map((y, i) => ({ label: `inside-${i}`, x: rect.left + 2, y, rgb: at(rect.left + 2, y) }));
  const panel = ys.map((y, i) => ({ label: `panel-${i}`, x: rect.left - 12, y, rgb: at(rect.left - 12, y) }));
  const ground = ys.map((y, i) => ({ label: `ground-${i}`, x: rect.left - 4, y, rgb: at(rect.left - 4, y) }));
  const deltas = inside.map((p, i) => maxDelta(p.rgb, panel[i].rgb));
  return {
    inside, panel, ground, deltasToPanel: deltas,
    maxDeltaToPanel: deltas.every(d => d !== null) ? Math.max(...deltas) : null
  };
}

export const sanitize = (value, roots) => {
  if (typeof value === 'string') {
    let s = value;
    for (const [root, placeholder] of roots) s = s.split(root).join(placeholder);
    return s.replace(/\/Users\/[A-Za-z0-9_.-]+/gu, '<home>').replace(/\/private\/tmp/gu, '<tmp>').replace(/\/tmp\/[A-Za-z0-9_.-]+/gu, '<tmp>');
  }
  if (Array.isArray(value)) return value.map(v => sanitize(v, roots));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, roots)]));
  }
  return value;
};
