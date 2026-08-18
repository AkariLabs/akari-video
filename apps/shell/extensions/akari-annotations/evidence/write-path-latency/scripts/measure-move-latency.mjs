#!/usr/bin/env node
// 依存ゼロ（Node 組み込みのみ）の生 CDP 計測ドライバ。
// task 2026-08-18-shell-write-path-latency の受け入れ条件
// 「クリップ 1 個の移動が pointerup から画面反映まで 150ms 未満」を実測する。
//
// 計測の定義:
//   t0      = 実 pointerup がレンダラへ配送された瞬間（window の capture リスナで採取）
//   domMs   = タイムライン上の当該クリップ要素の style.left が変わったのを検出した rAF
//   paintMs = その次の rAF（= 変更後フレームの描画が済んだ時点）  ← 受け入れ条件の値
//   settleMs= strip への DOM 変異が 700ms 途切れるまで（保存後の後段処理まで含む総鎮静時間）
//
// 使い方: node measure-move-latency.mjs <cdpPort> <workspaceDir> <outJson> [--runs N] [--dx PX]
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, realClick, screenshot } from
  '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, outArg, ...rest] = process.argv;
const CDP_PORT = Number(portArg || 9334);
const WORKSPACE = workspaceArg;
const OUT = outArg;
if (!WORKSPACE || !OUT) {
  throw new Error('usage: measure-move-latency.mjs <cdpPort> <workspaceDir> <outJson> [--runs N] [--dx PX]');
}
const runsIndex = rest.indexOf('--runs');
const RUNS = runsIndex >= 0 ? Number(rest[runsIndex + 1]) : 5;
const dxIndex = rest.indexOf('--dx');
const DX = dxIndex >= 0 ? Number(rest[dxIndex + 1]) : 140;
const EDIT_PATH = path.join(WORKSPACE, 'edit.json');

const log = [];
function record(step, data) {
  log.push({ t: new Date().toISOString(), step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
}

const WIDGET_REFS = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const timelineViewport = w.children[1];
  const stripScroll = timelineViewport.children[1];
  return { w, strip: stripScroll.children[0], footer: w.children[4] };
})()`;


/** ホーム画面の edit.json カード（「... · edit.json」行）の中心座標。 */
function cardExpression() {
  return [
    "(function(){",
    "  var nodes = Array.from(document.querySelectorAll('span'));",
    "  var hit = nodes.filter(function(e){",
    "    var own = Array.from(e.childNodes).filter(function(n){return n.nodeType===3})",
    "      .map(function(n){return n.textContent.trim()}).join('');",
    "    return own.indexOf('edit.json') >= 0;",
    "  })[0];",
    "  if (!hit) return null;",
    "  var r = hit.getBoundingClientRect();",
    "  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };",
    "})()"
  ].join('\n');
}

async function widgetFound(main) {
  return evalOn(main, `Boolean(${WIDGET_REFS})`);
}

async function clipRect(main, index = 0) {
  return evalOn(main, `(() => {
    const el = document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="${index}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height,
             styleLeft: el.style.left, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

/** pointerup 到達時刻を基点に「left が変わった rAF」「その次の rAF」「DOM 変異の鎮静」を測る観測器を仕込む。 */
async function armWatcher(main, index) {
  return evalOn(main, `(() => {
    const el = document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="${index}"]');
    if (!el) return { armed: false };
    const refs = ${WIDGET_REFS};
    const state = {
      leftBefore: el.style.left, t0: null, domMs: null, paintMs: null,
      settleMs: null, mutations: 0, lastMutationMs: null, done: false
    };
    window.__akariWatch = state;
    const onUp = () => { if (state.t0 === null) state.t0 = performance.now(); };
    window.addEventListener('pointerup', onUp, true);
    const observer = new MutationObserver(records => {
      state.mutations += records.length;
      state.lastMutationMs = performance.now();
    });
    observer.observe(refs.strip, { childList: true, subtree: true, attributes: true });
    let sawChange = false;
    const tick = () => {
      const now = performance.now();
      if (state.t0 !== null) {
        if (!sawChange) {
          const current = document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="${index}"]');
          if (current && current.style.left !== state.leftBefore) {
            sawChange = true;
            state.domMs = now - state.t0;
          }
        } else if (state.paintMs === null) {
          state.paintMs = now - state.t0;
        }
        const quietFrom = state.lastMutationMs ?? state.t0;
        if (state.paintMs !== null && now - quietFrom > 700) {
          state.settleMs = quietFrom - state.t0;
          state.done = true;
          observer.disconnect();
          window.removeEventListener('pointerup', onUp, true);
          return;
        }
        if (now - state.t0 > 20000) {
          state.done = true;
          observer.disconnect();
          window.removeEventListener('pointerup', onUp, true);
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { armed: true, leftBefore: state.leftBefore };
  })()`);
}

async function readWatch(main) {
  return evalOn(main, 'window.__akariWatch ? { ...window.__akariWatch } : null');
}

async function drag(cdp, from, to) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1
  });
  await sleep(40);
  const steps = 12;
  for (let s = 1; s <= steps; s++) {
    const x = from.x + (to.x - from.x) * (s / steps);
    const y = from.y + (to.y - from.y) * (s / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await sleep(60);
}

async function releaseAt(cdp, point) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left' });
}

async function readCutAt() {
  const value = JSON.parse(await readFile(EDIT_PATH, 'utf8'));
  const cut = value.cuts?.[0] ?? {};
  return { at: cut.at ?? null, in: cut.in ?? null, out: cut.out ?? null };
}

async function main() {
  const targets = await listTargets(CDP_PORT);
  const target = targets.find(t => t.type === 'page');
  if (!target) throw new Error('main page target not found');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  record('connected', { url: target.url });

  // ホーム画面の「編集データ（edit.json）」カードをダブルクリックして開く実ユーザー導線。
  // これで出力プレビュー（webview）とタイムラインの両方が開くため、オーナー実機と同じ構成になる。
  let found = await widgetFound(cdp);
  for (let attempt = 0; attempt < 4 && !found; attempt++) {
    const card = await evalOn(cdp, cardExpression());
    if (!card) {
      await sleep(1000);
      continue;
    }
    await realClick(cdp, card.x, card.y, { clickCount: 2 });
    for (let w = 0; w < 20 && !found; w++) {
      await sleep(500);
      found = await widgetFound(cdp);
    }
  }
  if (!found) throw new Error('timeline widget did not open');
  record('timeline-open', { found });
  await sleep(1500);

  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const before = await clipRect(cdp, 0);
    if (!before) throw new Error('clip element not found');
    const editBefore = await readCutAt();
    const direction = run % 2 === 0 ? 1 : -1;
    const from = { x: before.x, y: before.y };
    const to = { x: before.x + DX * direction, y: before.y };
    await drag(cdp, from, to);
    const armed = await armWatcher(cdp, 0);
    if (!armed.armed) throw new Error('watcher could not be armed');
    await releaseAt(cdp, to);

    let watch = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      watch = await readWatch(cdp);
      if (watch && watch.done) break;
      await sleep(100);
    }
    await sleep(400);
    const editAfter = await readCutAt();
    const after = await clipRect(cdp, 0);
    const entry = {
      run, direction, dx: DX,
      leftBefore: armed.leftBefore, leftAfter: after?.styleLeft ?? null,
      moved: (after?.styleLeft ?? null) !== armed.leftBefore,
      editBefore, editAfter,
      t0Seen: watch?.t0 !== null && watch?.t0 !== undefined,
      domMs: watch?.domMs ?? null,
      paintMs: watch?.paintMs ?? null,
      settleMs: watch?.settleMs ?? null,
      stripMutations: watch?.mutations ?? null
    };
    runs.push(entry);
    record('run', entry);
    await sleep(1200);
  }

  const valid = runs.filter(r => r.moved && typeof r.paintMs === 'number');
  const paints = valid.map(r => r.paintMs).sort((a, b) => a - b);
  const settles = valid.map(r => r.settleMs).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const summary = {
    runsRequested: RUNS, runsValid: valid.length,
    paintMs: paints.length ? {
      min: +paints[0].toFixed(1),
      median: +paints[Math.floor(paints.length / 2)].toFixed(1),
      max: +paints[paints.length - 1].toFixed(1)
    } : null,
    settleMs: settles.length ? {
      min: +settles[0].toFixed(1),
      median: +settles[Math.floor(settles.length / 2)].toFixed(1),
      max: +settles[settles.length - 1].toFixed(1)
    } : null
  };
  record('summary', summary);
  await writeFile(OUT, `${JSON.stringify({ summary, runs, log }, null, 2)}\n`);
  cdp.close();
  console.log(JSON.stringify(summary));
}

await main();
