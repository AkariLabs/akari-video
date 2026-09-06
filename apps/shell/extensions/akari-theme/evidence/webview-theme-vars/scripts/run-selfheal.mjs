#!/usr/bin/env node
// 層 A の自己修復（契約 指示 3）を実測する。
//  1. ベースライン N を撮る
//  2. 内側 document から --vscode-* を強制的に全部消す
//  3. 5 秒間隔で N をポーリングし、ベースラインへ戻った時刻を記録する（上限 90 秒）
//  4. 戻った後に入力欄をクリックしてフォーカスが入ることを確認する
//  5. アイドル 5 分の styles 再送回数を数える（ホストページで受けた {channel:'styles'} の数）
//   node run-selfheal.mjs --port 9762 --out <dir> [--idle-sec 300]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { keyPress, realClick } from './cdp-lib.mjs';
import {
  connectMain, evalIn, findCodexWebview, iframeRect, runCommand, sleep, measure, innerExpr,
  decodePng, samplePanel, shot, sanitize
} from './probe-lib.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const port = Number(args.get('--port') ?? 9762);
const out = args.get('--out');
const idleSec = Number(args.get('--idle-sec') ?? 300);
if (!out) throw new Error('usage: run-selfheal.mjs --port <p> --out <dir> [--idle-sec N]');
await mkdir(out, { recursive: true });

const main = await connectMain(port);
await runCommand(main, 'chatgpt.sidebarSecondaryView.focus');
await sleep(2500);
const { target, view } = await findCodexWebview(port);
const rect = await iframeRect(main, target.url);

await evalIn(view, `(() => {
  window.__akariStylesMsgs = window.__akariStylesMsgs || [];
  if (!window.__akariStylesListener) {
    window.__akariStylesListener = e => { if (e && e.data && e.data.channel === 'styles') window.__akariStylesMsgs.push(Date.now()); };
    window.addEventListener('message', window.__akariStylesListener);
  }
  return window.__akariStylesMsgs.length;
})()`);

const baseline = await measure(view);
const n0 = baseline.n;
console.log('baseline n=', n0, 'rect', JSON.stringify(rect));

const strip = () => evalIn(view, innerExpr(`
  let removed = 0;
  for (const p of [...html.style]) if (p.startsWith('--vscode-')) { removed++; html.style.removeProperty(p); }
  return removed;
`));

const removed = await strip();
const t0 = Date.now();
await sleep(500);
const pngStripped = path.join(out, 'after-selfheal-t0.png');
await shot(main, pngStripped);
const strippedSamples = samplePanel(await decodePng(pngStripped), rect);
const strippedMeasure = await measure(view);
console.log('stripped', removed, 'inside', JSON.stringify(strippedSamples.inside.map(p => p.rgb)), 'maxDeltaToPanel', strippedSamples.maxDeltaToPanel);

const series = [{ elapsedSec: 0.5, n: strippedMeasure.n, bodyBackgroundColor: strippedMeasure.bodyBackgroundColor }];
let restoredAtSec = null;
for (let i = 1; i <= 18; i++) {
  await sleep(5000);
  const m = await measure(view).catch(() => null);
  const elapsedSec = Math.round((Date.now() - t0) / 100) / 10;
  series.push({ elapsedSec, n: m?.n ?? null, bodyBackgroundColor: m?.bodyBackgroundColor ?? null });
  console.log('poll', elapsedSec + 's', 'n=' + (m?.n ?? 'null'));
  if (m && m.n >= n0) { restoredAtSec = elapsedSec; break; }
}

const pngRestored = path.join(out, 'after-selfheal-restored.png');
await shot(main, pngRestored);
const restoredSamples = samplePanel(await decodePng(pngRestored), rect);

// 入力欄へフォーカス（復帰後）。
const inputInfo = await evalIn(view, innerExpr(`
  const candidates = [...d.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], input:not([type]), input[type="search"]')]
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 20 && x.r.height > 10);
  const pick = candidates[candidates.length - 1];
  if (!pick) {
    return { found: false, buttons: [...d.querySelectorAll('button')].slice(0, 6).map(b => String(b.textContent || '').trim().slice(0, 40)) };
  }
  return { found: true, kind: 'input', tag: pick.el.tagName, rect: { x: pick.r.x, y: pick.r.y, width: pick.r.width, height: pick.r.height } };
`));
// ログインしていない Codex は入力欄を持たない（オンボーディングの Back / Next だけ）。
// その場合はフォーカス可能な操作要素（ボタン）で「復帰後に webview が入力を受ける」ことを見る。
const fallbackInfo = inputInfo && inputInfo.found ? null : await evalIn(view, innerExpr(`
  const b = [...d.querySelectorAll('button')].map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(x => x.r.width > 20 && x.r.height > 10).pop();
  if (!b) return { found: false };
  return { found: true, kind: 'button', tag: b.el.tagName, label: String(b.el.textContent || '').trim().slice(0, 40),
    rect: { x: b.r.x, y: b.r.y, width: b.r.width, height: b.r.height } };
`));
const focusTarget = inputInfo && inputInfo.found ? inputInfo : fallbackInfo;
console.log('input candidates', JSON.stringify(inputInfo), 'fallback', JSON.stringify(fallbackInfo));
let focus = { attempted: false, info: inputInfo, fallback: fallbackInfo };
if (focusTarget && focusTarget.found) {
  const x = rect.left + focusTarget.rect.x + focusTarget.rect.width / 2;
  const y = rect.top + focusTarget.rect.y + focusTarget.rect.height / 2;
  await realClick(main, x, y);
  await sleep(800);
  const active = await evalIn(view, innerExpr(`
    const a = d.activeElement;
    return a ? { tag: a.tagName, editable: a.isContentEditable === true, type: a.getAttribute('type') } : null;
  `));
  focus = { attempted: true, kind: focusTarget.kind, clickedAt: { x, y }, info: inputInfo, fallback: fallbackInfo, activeElement: active };
  console.log('focus', JSON.stringify(focus.activeElement));
}

// 復帰後に webview が実入力を受けることの直接確認。
// 未ログインの Codex は入力欄も onboarding ボタンも出さない（startup-loader のまま／
// 内部エラーページ）ので、入力欄クリックだけでは「操作を受ける」ことを示せない。
// 内側 document に pointerdown / click / keydown のリスナーを張り、CDP の実マウス・
// 実キーを送って届くことと activeElement を記録する。
await evalIn(view, innerExpr(`
  window.__akariInteract = { pointerdown: 0, click: 0, keydown: 0, keys: [] };
  const w = window.__akariInteract;
  d.addEventListener('pointerdown', () => { w.pointerdown++; }, true);
  d.addEventListener('click', () => { w.click++; }, true);
  d.addEventListener('keydown', e => { w.keydown++; w.keys.push(e.key); }, true);
  return true;
`));
const clickX = rect.left + rect.width / 2;
const clickY = rect.top + rect.height / 2;
await realClick(main, clickX, clickY);
await sleep(400);
await keyPress(main, { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' });
await sleep(600);
const interaction = await evalIn(view, innerExpr(`
  const a = d.activeElement;
  return {
    counters: window.__akariInteract,
    activeElement: a ? { tag: a.tagName, editable: a.isContentEditable === true, id: String(a.id || '').slice(0, 40) } : null,
    hasFocus: d.hasFocus(),
    title: d.title
  };
`));
console.log('interaction', JSON.stringify(interaction));

// アイドル再送のカウント。webview のホストページが作り直されるとリスナーごと消えるので、
// 数える直前に必ず張り直し、読み出しも配列でなければ空として扱う。
const installCounter = () => evalIn(view, `(() => {
  if (!Array.isArray(window.__akariStylesMsgs)) window.__akariStylesMsgs = [];
  if (!window.__akariStylesListener) {
    window.__akariStylesListener = e => { if (e && e.data && e.data.channel === 'styles') window.__akariStylesMsgs.push(Date.now()); };
    window.addEventListener('message', window.__akariStylesListener);
  }
  window.__akariStylesMsgs.length = 0;
  return 'ready';
})()`);
console.log('counter', await installCounter());
const idleStart = Date.now();
await sleep(idleSec * 1000);
const raw = await evalIn(view, '(() => { const a = window.__akariStylesMsgs; return Array.isArray(a) ? a.slice() : null; })()').catch(e => { console.log('read error', String(e).slice(0, 120)); return null; });
console.log('raw idle counter', JSON.stringify(raw));
const msgs = Array.isArray(raw) ? raw : [];
const idleElapsedSec = Math.round((Date.now() - idleStart) / 1000);
const perMinute = msgs.length / (idleElapsedSec / 60);
console.log('idle resends', msgs.length, 'in', idleElapsedSec, 's =>', perMinute.toFixed(2), '/min');

const payload = sanitize({
  baselineN: n0, removed, rect,
  stripped: { measurement: strippedMeasure, samples: strippedSamples, png: path.basename(pngStripped) },
  series, restoredAtSec,
  restored: { samples: restoredSamples, png: path.basename(pngRestored), measurement: await measure(view) },
  focus, interaction, interactionClickedAt: { x: clickX, y: clickY },
  idle: { elapsedSec: idleElapsedSec, resends: msgs.length, perMinute: Number(perMinute.toFixed(3)), timestampsRelativeSec: msgs.map(t => Math.round((t - idleStart) / 100) / 10) }
}, [[out, '<evidence>']]);
await writeFile(path.join(out, 'after-selfheal.json'), JSON.stringify(payload, null, 2) + '\n');
console.log('written after-selfheal.json restoredAtSec=', restoredAtSec);
view.close(); main.close();
