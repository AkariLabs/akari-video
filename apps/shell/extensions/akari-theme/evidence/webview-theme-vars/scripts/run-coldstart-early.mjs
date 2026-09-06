#!/usr/bin/env node
// 起動直後 0〜N 秒の「白い時間」を 1 秒刻みで撮る（層 B の実害そのもの）。
// run-coldstart.mjs は内側 frame へ attach してから測り始めるので、実測で
// 25〜30 秒かかることがあり、肝心の起動直後の窓を取り逃す。こちらはメイン frame の
// スクリーンショットだけで右パネル（Codex コンテナ）の画素を追い、N は取れたときだけ足す。
//   node run-coldstart-early.mjs --port 9762 --out <dir> --phase before|after [--seconds 40]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalIn, runCommand, decodePng, samplePanel, shot, sleep, measure,
  webviewTargets, attachWebview, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const phase = args.get('--phase') ?? 'before';
const seconds = Number(args.get('--seconds') ?? 40);
if (!out) throw new Error('usage: run-coldstart-early.mjs --port <p> --out <dir> --phase <p> [--seconds N]');
await mkdir(out, { recursive: true });

const t0 = Date.now();
const main = await connectMain(port);
const connectedAtSec = Math.round((Date.now() - t0) / 100) / 10;
console.log('main connected at', connectedAtSec + 's');

// Codex コンテナを開く（拡張の activate 前は「no active handlers」で失敗するので毎周回試す）。
let opened = null;
const tryOpen = async () => {
  if (opened) return opened;
  const r = await runCommand(main, 'chatgpt.sidebarSecondaryView.focus').catch(() => null);
  if (r && r.ok) { opened = Math.round((Date.now() - t0) / 100) / 10; console.log('codex view opened at', opened + 's'); }
  return opened;
};

// メイン frame から「Codex コンテナの中の webview iframe」の矩形を引く。
const CODEX_RECT = `(() => {
  const el = [...document.querySelectorAll('iframe.webview')].find(e => {
    let n = e.parentElement;
    while (n) { if (String(n.id || '').includes('codexSecondaryViewContainer')) return true; n = n.parentElement; }
    return false;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
})()`;

let view = null;
const attachOnce = async () => {
  if (view) return view;
  for (const t of await webviewTargets(port)) {
    const id = new URL(t.url).searchParams.get('id');
    if (/^akari-output-preview-/u.test(String(id))) continue;
    try { view = await attachWebview(t); return view; } catch { /* まだ */ }
  }
  return null;
};

const series = [];
let whiteUntilSec = null;
let darkFromSec = null;
let i = 0;
const deadline = t0 + seconds * 1000;
while (Date.now() < deadline) {
  const elapsedSec = Math.round((Date.now() - t0) / 100) / 10;
  await tryOpen();
  let inside = null; let panel = null; let delta = null; let n = null; let bodyBg = null;
  const rect = await evalIn(main, CODEX_RECT).catch(() => null);
  if (rect && rect.width > 100) {
    const png = path.join(out, `${phase}-early-${String(i).padStart(2, '0')}.png`);
    await shot(main, png);
    const s = samplePanel(await decodePng(png), rect);
    inside = s.inside.map(p => p.rgb); panel = s.panel.map(p => p.rgb); delta = s.maxDeltaToPanel;
    const v = await attachOnce();
    if (v) {
      const m = await measure(v).catch(() => null);
      n = m?.n ?? null; bodyBg = m?.bodyBackgroundColor ?? null;
    }
  }
  const isWhite = Boolean(inside && inside.every(p => p && p[0] > 200));
  if (isWhite) whiteUntilSec = elapsedSec; else if (inside && darkFromSec === null) darkFromSec = elapsedSec;
  series.push({ elapsedSec, rect, n, bodyBackgroundColor: bodyBg, inside, panel, maxDeltaToPanel: delta, white: isWhite });
  console.log(elapsedSec + 's', 'n=' + n, 'inside=' + JSON.stringify(inside), 'delta=' + delta);
  i++;
  await sleep(1000);
}

const whiteSamples = series.filter(s => s.white).length;
const payload = sanitize({
  phase, seconds, connectedAtSec, codexViewOpenedAtSec: opened,
  whiteUntilSec, darkFromSec, whiteSamples, totalSamplesWithPixels: series.filter(s => s.inside).length, series
}, [[out, '<evidence>']]);
await writeFile(path.join(out, `${phase}-coldstart-early.json`), JSON.stringify(payload, null, 2) + '\n');
console.log('written', `${phase}-coldstart-early.json`, 'whiteUntilSec=', whiteUntilSec, 'darkFromSec=', darkFromSec, 'whiteSamples=', whiteSamples);
try { view?.close(); } catch { /* noop */ }
main.close();
