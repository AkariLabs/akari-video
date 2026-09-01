#!/usr/bin/env node
// caption-plate-drag-clamp L1 プローブ（検証スクリプト・ラッパー作成）。
// 形は evidence/chip-reachability（launch-shell.sh / cdp-lib.mjs の写し）を踏襲し、
// 本番ビルドの Electron + 生 CDP で観測する（テストフレームワークは使わない）。
// ドラッグ・クリックは CDP Input.dispatchMouseEvent の page 座標で、webview（OOPIF）を跨いで届かせる。
// Usage: node run-l1.mjs <cdp-port> <projectRoot> <outDir> [label]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, screenshot, sleep, waitFor, realDragMod, realClick } from './cdp-lib.mjs';

const [, , portArg, projectRoot, outDir, label = 'after'] = process.argv;
const port = Number(portArg || 9655);
if (!projectRoot || !outDir) throw new Error('usage: run-l1.mjs <port> <projectRoot> <outDir> [label]');
const editPath = path.join(projectRoot, 'edit.json');
const captionsPath = path.join(projectRoot, 'captions.json');
await mkdir(outDir, { recursive: true });

const VIEW_W = 1600, VIEW_H = 1100;
const OUT_W = 1280, OUT_H = 720;
const CUE2_ID = 'c-0002', CUE2_TEXT = '二行目だけを動かす', CUE2_TIME = 3.0;
const BADGE_CUE = 'この字幕だけ動く — ⌥ドラッグで全字幕';
const BADGE_GROUP = '全字幕が動く';

const results = { status: 'running', label, startedAt: new Date().toISOString(), steps: [], checks: [], failures: [], notes: [] };
const note = text => { results.notes.push(text); console.log(`[note] ${text}`); };
const record = (step, data = {}) => { results.steps.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data).slice(0, 700)); };
const check = (ok, message, detail = {}) => {
    results.checks.push({ ok, message, ...detail });
    if (!ok) results.failures.push({ message, ...detail });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${message}`);
    return ok;
};
const save = async () => writeFile(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const readCaptions = async () => JSON.parse(await readFile(captionsPath, 'utf8'));
const readCaptionsText = () => readFile(captionsPath, 'utf8');
const node2 = value => JSON.stringify(value, undefined, 2);
const waitCaptionsChange = async before => waitFor('captions.json change', async () => {
    const now = await readCaptionsText();
    return now === before ? null : now;
}, 25_000, 200);

// ---------- connect ----------
const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`), 180_000);
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(1200);

const commandRegistryExpr = `(() => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  return keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
})()`;
const runCommand = (id, argExpr) => evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${argExpr});
})()`);
const seekCommand = time => runCommand('akari.preview.seekOutput',
    `{ editUri: ${JSON.stringify('file://' + editPath)}, time: ${time} }`);

let view; let ctxId; let vEval;
async function attachWebview() {
    const webviewTarget = await waitFor('webview target', async () => {
        const list = await listTargets(port);
        return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
    }, 120_000);
    view = new CDP(webviewTarget.webSocketDebuggerUrl);
    await view.connect();
    const contexts = [];
    view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
    await view.send('Page.enable'); await view.send('Runtime.enable');
    ctxId = undefined;
    await waitFor('preview stage in webview', async () => {
        for (const id of [undefined, ...contexts.map(c => c.id)]) {
            try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch { /* other context */ }
        }
        return false;
    }, 150_000);
    vEval = expr => evalOn(view, expr, ctxId);
    await waitFor('caption model loaded', () => vEval(`Boolean(window.akari && window.akari.computeOutputFrameRect) && Boolean(document.getElementById('caption-plate'))`), 120_000);
    await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if (v && !v.paused) t?.click(); if (window.__cpdcPlayStop) return true; window.__cpdcPlayStop = true; return true; })()`);
}

// 左右のサイドパネルを畳んでプレビューを広げる。フレームの外側に余白が無いと
// 「クランプ解除でフレーム外へ出す」操作も選択枠のコントロールも webview の外に出てしまう。
async function collapseSidePanels() {
    const collapsed = await evalOn(main, `(() => {
      const bindings=window.theia.container._bindingDictionary;
      const keys=[...bindings._map.keys()];
      const shellKey=keys.find(k=>typeof k==='function' && typeof k.prototype?.collapsePanel==='function' && typeof k.prototype?.revealWidget==='function');
      if (!shellKey) return 'no-shell';
      const shell=window.theia.container.get(shellKey);
      const done=[];
      for (const area of ['left','right','bottom']) { try { shell.collapsePanel(area); done.push(area); } catch (e) { done.push(area + ':' + String(e).slice(0,40)); } }
      return done.join(',');
    })()`);
    await sleep(1500);
    record('collapse-side-panels', { collapsed });
}

record('open-preview', { result: await seekCommand(CUE2_TIME) });
await attachWebview();
await collapseSidePanels();

// ---------- page <-> webview 座標の実測キャリブレーション ----------
let offset = { x: 0, y: 0 };
let iframeRect = { left: 0, top: 0, width: VIEW_W, height: VIEW_H };
async function calibrate() {
    await vEval(`(() => { window.__cpdcCal = null; if (!window.__cpdcCalBound) { window.__cpdcCalBound = true; window.addEventListener('pointermove', e => { window.__cpdcCal = { x: e.clientX, y: e.clientY }; }, true); } return true; })()`);
    const frame = await evalOn(main, `(() => {
      const list=[...document.querySelectorAll('iframe')].map(f=>{const r=f.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}).filter(r=>r.width>200&&r.height>200);
      list.sort((a,b)=>b.width*b.height-a.width*a.height); return list[0]||null; })()`);
    if (!frame) throw new Error('webview iframe rect not found in main page');
    const probe = { x: Math.round(frame.left + frame.width / 2), y: Math.round(frame.top + frame.height / 2) };
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: probe.x, y: probe.y, button: 'none' });
    const cal = await waitFor('pointer calibration', () => vEval(`window.__cpdcCal`), 8000, 150);
    offset = { x: probe.x - cal.x, y: probe.y - cal.y };
    iframeRect = frame;
    record('calibration', { iframe: frame, probe, webviewClient: cal, offset });
    return offset;
}
// CDP のマウスイベントは webview（OOPIF）の矩形の中でしか届かない（外へ出すと
// pointerup が webview に入らずドラッグが確定しない）。端点は必ず矩形内へ丸める。
const clampToIframe = point => ({
    x: Math.min(iframeRect.left + iframeRect.width - 24, Math.max(iframeRect.left + 24, point.x)),
    y: Math.min(iframeRect.top + iframeRect.height - 24, Math.max(iframeRect.top + 24, point.y))
});
await calibrate();
const toPage = (clientX, clientY) => ({ x: clientX + offset.x, y: clientY + offset.y });

// ---------- webview 幾何 ----------
const GEOMETRY = `(() => {
  const stage = document.getElementById('preview-stage');
  const stageRect = stage.getBoundingClientRect();
  const plate = document.getElementById('caption-plate');
  const block = plate.querySelector('.akari-caption__block');
  const lines = [...plate.querySelectorAll('.akari-caption__line')];
  const elements = block ? [block] : (lines.length ? lines : [plate]);
  const rects = elements.map(e => e.getBoundingClientRect());
  const ink = {
    left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)),
    top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom))
  };
  let frameClient = null;
  const local = window.akari.interaction && window.akari.interaction.stageLocalPoint;
  if (local) {
    const p0 = local(0, 0), p1 = local(200, 200);
    const sx = 200 / (p1.x - p0.x), sy = 200 / (p1.y - p0.y);
    frameClient = { left: (0 - p0.x) * sx, top: (0 - p0.y) * sy, width: ${OUT_W} * sx, height: ${OUT_H} * sy };
  } else {
    const s = (window.akari.stageScale() || 1);
    frameClient = { left: stageRect.left, top: stageRect.top, width: ${OUT_W} * s, height: ${OUT_H} * s };
  }
  frameClient.right = frameClient.left + frameClient.width;
  frameClient.bottom = frameClient.top + frameClient.height;
  const box = document.getElementById('caption-select-box');
  const badge = box.querySelector('.akari-caption-group-badge');
  const chip = box.querySelector('.akari-caption-clamp-chip');
  const reset = box.querySelector('.akari-caption-position-reset');
  const rr = e => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const clone = plate.cloneNode(true);
  for (const s of clone.querySelectorAll('style')) s.remove();
  return {
    stage: { left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height },
    frameClient, ink,
    inkCenter: { x: (ink.left + ink.right) / 2, y: (ink.top + ink.bottom) / 2 },
    frameRatio: {
      left: (ink.left - frameClient.left) / frameClient.width,
      right: (ink.right - frameClient.left) / frameClient.width,
      top: (ink.top - frameClient.top) / frameClient.height,
      bottom: (ink.bottom - frameClient.top) / frameClient.height,
      width: (ink.right - ink.left) / frameClient.width,
      height: (ink.bottom - ink.top) / frameClient.height
    },
    plateText: clone.textContent.trim(),
    plateTranslate: plate.style.translate || '',
    selectBox: {
      active: box.classList.contains('is-active'),
      badgeText: badge ? badge.textContent.trim() : null,
      chipText: chip ? chip.textContent.trim() : null,
      chipOn: chip ? chip.classList.contains('on') : null,
      chipRect: rr(chip),
      resetHidden: reset ? reset.hasAttribute('hidden') : null,
      resetVisible: reset ? reset.getBoundingClientRect().width > 0 : null,
      resetRect: rr(reset)
    }
  };
})()`;

const geom = () => vEval(GEOMETRY);
const seekToCue = async (time, expected) => {
    let last = null;
    return waitFor(`caption "${expected}" at t=${time}`, async () => {
        await seekCommand(time);
        await sleep(250);
        last = await geom();
        if (last.plateText === expected) return last;
        await vEval(`(() => { const s=document.getElementById('seek'); if(!s) return false; s.value=String(${time}); s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await sleep(250);
        last = await geom();
        return last.plateText === expected ? last : null;
    }, 45_000, 400).catch(error => { record('seek-failed', { time, expected, seen: last?.plateText }); throw error; });
};
const shot = async name => { await screenshot(main, path.join(outDir, 'shots', `${label}-${name}`)); record('screenshot', { name: `${label}-${name}` }); };
await mkdir(path.join(outDir, 'shots'), { recursive: true });

// dx/dy は page 座標のピクセル。midHook はリリース前に呼ぶ。
async function dragPlate(dx, dy, { modifiers = 0, midHook = null } = {}) {
    const before = await geom();
    const stageBox = {
        left: before.stage.left + offset.x + 8, top: before.stage.top + offset.y + 8,
        right: before.stage.left + before.stage.width + offset.x - 8,
        bottom: before.stage.top + before.stage.height + offset.y - 8
    };
    const clampToStage = point => clampToIframe({
        x: Math.min(stageBox.right, Math.max(stageBox.left, point.x)),
        y: Math.min(stageBox.bottom, Math.max(stageBox.top, point.y))
    });
    const start = clampToStage(toPage(before.inkCenter.x, before.inkCenter.y));
    const end = clampToStage({ x: start.x + dx, y: start.y + dy });
    const beforeText = await readCaptionsText();
    const steps = 10;
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', modifiers });
    await sleep(80);
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await sleep(80);
    for (let s = 1; s <= steps; s++) {
        await main.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: start.x + (end.x - start.x) * s / steps, y: start.y + (end.y - start.y) * s / steps,
            button: 'left', buttons: 1, modifiers
        });
        await sleep(30);
    }
    let mid = null;
    if (midHook) { mid = await geom(); await midHook(mid); }
    await sleep(80);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, modifiers });
    return { before, mid, beforeText, start, end, requested: { dx, dy }, applied: { dx: end.x - start.x, dy: end.y - start.y } };
}
// webview 矩形の縁では pointerup が取りこぼされることがある（次のマウス操作まで
// ドラッグが確定しない）。書き込みが来なければ内側でもう一度 mouseReleased を出す。
async function awaitWrite(drag, labelName) {
    try { await waitCaptionsChange(drag.beforeText); return 'immediate'; } catch { /* retry below */ }
    const state = await vEval(`(() => { const p=document.getElementById('caption-plate'); return { translate: p.style.translate || '' }; })()`).catch(() => null);
    const retryPoint = clampToIframe({
        x: drag.end.x + (drag.end.x > drag.start.x ? -40 : 40),
        y: drag.end.y + (drag.end.y > drag.start.y ? -40 : 40)
    });
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: retryPoint.x, y: retryPoint.y, button: 'left', buttons: 1 });
    await sleep(60);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: retryPoint.x, y: retryPoint.y, button: 'left', buttons: 0, clickCount: 1 });
    record(`${labelName}-write-retry`, { state, retryPoint });
    try { await waitCaptionsChange(drag.beforeText); return 'retry-mouseup'; } catch { /* last resort below */ }
    // 実マウスの pointerup が webview に入らないことがある（フレーム跨ぎのヒットテスト）。
    // ドラッグ本体（pointerdown + move）は実イベントのまま、終端だけ webview 内で補完する。
    const local = { x: drag.end.x - offset.x, y: drag.end.y - offset.y };
    await vEval(`(() => {
      for (const id of [1, 0, 2, 3]) {
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: id, isPrimary: true, button: 0, buttons: 0, clientX: ${local.x}, clientY: ${local.y} }));
      }
      return true;
    })()`);
    try { await waitCaptionsChange(drag.beforeText); return 'synthetic-pointerup'; } catch { return 'timeout'; }
}
// フレーム比で着地点を指定するドラッグ（dx/dy は client px = page px）。
async function dragPlateToFrame(leftRatio, bottomRatio, options = {}) {
    const g = await geom();
    const dx = leftRatio === null ? 0 : (g.frameClient.left + g.frameClient.width * leftRatio) - g.ink.left;
    const dy = bottomRatio === null ? 0 : (g.frameClient.top + g.frameClient.height * bottomRatio) - g.ink.bottom;
    return dragPlate(dx, dy, options);
}
async function clickAt(clientX, clientY) {
    const p = clampToIframe(toPage(clientX, clientY));
    await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    await sleep(60);
    await main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(400);
}
const hitAt = (x, y) => vEval(`(() => {
  const e = document.elementFromPoint(${x}, ${y});
  if (!e) return null;
  const style = window.getComputedStyle(e);
  return { tag: e.tagName, cls: String(e.className || ''), pointerEvents: style.pointerEvents, text: (e.textContent || '').trim().slice(0, 24) };
})()`);
// 選択枠のコントロール（🧲 / ↺）を実クリックする。矩形は直前に読み直し、
// 当たり判定（elementFromPoint）を証跡に残す。中心が別要素に取られていたら
// ボタン内を横断走査して自分が取れる点を探す。
async function clickControl(which, expectChanged) {
    const attempts = [];
    for (let round = 0; round < 3; round++) {
        const g = await geom();
        const rect = which === 'chip' ? g.selectBox.chipRect : g.selectBox.resetRect;
        if (!rect) { attempts.push({ round, reason: 'no-rect' }); break; }
        let point = { x: rect.cx, y: rect.cy };
        let hit = await hitAt(point.x, point.y);
        const wanted = which === 'chip' ? 'akari-caption-clamp-chip' : 'akari-caption-position-reset';
        if (!hit || !hit.cls.includes(wanted)) {
            for (let f = 0.15; f <= 0.85; f += 0.1) {
                const probe = { x: rect.left + rect.width * f, y: rect.cy };
                const probeHit = await hitAt(probe.x, probe.y);
                if (probeHit && probeHit.cls.includes(wanted)) { point = probe; hit = probeHit; break; }
            }
        }
        attempts.push({ round, rect, point, hit });
        await clickAt(point.x, point.y);
        const after = await geom();
        if (expectChanged(after)) { record(`click-${which}`, { attempts, path: 'real-mouse', after: after.selectBox }); return { ok: true, path: 'real-mouse', attempts }; }
    }
    record(`click-${which}-real-mouse-ineffective`, { attempts });
    return { ok: false, path: 'real-mouse', attempts };
}

// ================= 手順 1: 行ごとドラッグ =================
const base = await seekToCue(CUE2_TIME, CUE2_TEXT);
record('baseline', { frameRatio: base.frameRatio, frameClient: base.frameClient, plateText: base.plateText });
const beforeAll = await readCaptions();
const drag1 = await dragPlate(200, -150);
record('step1-write', { path: await awaitWrite(drag1, 'step1') });
await sleep(1200);
const after1 = await readCaptions();
const cue1After = after1.captions[1];
record('step1-written', { cue: cue1After.id, text_style: cue1After.text_style, default_text_style: after1.default_text_style, applied: drag1.applied });
check(cue1After.id === CUE2_ID, '手順1: 対象は 2 行目（c-0002）', { id: cue1After.id });
check(['bc', 'tc'].includes(cue1After.text_style?.text_anchor), '手順1: 行 2 に text_style.text_anchor が入る', { anchor: cue1After.text_style?.text_anchor });
const pos1 = cue1After.text_style?.position ?? {};
check(Number.isFinite(pos1.y) && pos1.y >= 0 && pos1.y <= 1 && (pos1.x === undefined || (pos1.x >= 0 && pos1.x <= 1)),
    '手順1: position の各軸が 0..1', { position: pos1 });
check(node2(after1.default_text_style) === node2(beforeAll.default_text_style),
    '手順1: default_text_style がバイト不変', { before: beforeAll.default_text_style, after: after1.default_text_style });
const others1 = [0, 2, 3, 4].every(i => node2(after1.captions[i]) === node2(beforeAll.captions[i]));
check(others1, '手順1: 他 4 行がバイト不変');
const sel1 = await geom();
check(sel1.selectBox.badgeText === BADGE_CUE, '手順1: バッジ文言が「この字幕だけ動く — ⌥ドラッグで全字幕」', { badgeText: sel1.selectBox.badgeText });
const moved1 = await seekToCue(CUE2_TIME, CUE2_TEXT);
check(Math.abs(moved1.frameRatio.bottom - base.frameRatio.bottom) > 0.02 || Math.abs(moved1.frameRatio.left - base.frameRatio.left) > 0.02,
    '手順1: プレートが実際に動いた（再読込後の描画）', { before: base.frameRatio, after: moved1.frameRatio });
await shot('01-cue-drag.png');
await save();

// ================= 手順 2: ⌥ドラッグ = 全字幕 =================
const beforeAlt = await readCaptions();
let altBadge = null;
const drag2 = await dragPlate(200, -150, { modifiers: 1, midHook: async m => { altBadge = m.selectBox.badgeText; } });
record('step2-write', { path: await awaitWrite(drag2, 'step2') });
await sleep(1200);
const after2 = await readCaptions();
record('step2-written', { default_text_style: after2.default_text_style, cue2: after2.captions[1].text_style, altBadge });
check(node2(after2.default_text_style) !== node2(beforeAlt.default_text_style)
    && ['bc', 'tc'].includes(after2.default_text_style?.text_anchor),
    '手順2: ⌥ドラッグで default_text_style.text_anchor/position が変わる', { before: beforeAlt.default_text_style, after: after2.default_text_style });
check(node2(after2.captions[1].text_style) === node2(beforeAlt.captions[1].text_style),
    '手順2: 行 2 の text_style はバイト不変', { before: beforeAlt.captions[1].text_style, after: after2.captions[1].text_style });
check(altBadge === BADGE_GROUP, '手順2: ⌥ドラッグ中はバッジが「全字幕が動く」', { altBadge });
await seekToCue(CUE2_TIME, CUE2_TEXT);
await shot('02-alt-group-drag.png');
await save();

// ================= 手順 3: クランプ ON で大きく引っ張る =================
const g3before = await seekToCue(CUE2_TIME, CUE2_TEXT);
const plateWRatio = g3before.frameRatio.width, plateHRatio = g3before.frameRatio.height;
const before3 = await readCaptions();
const drag3 = await dragPlateToFrame(1.6, 1.6);
record('step3-write', { path: await awaitWrite(drag3, 'step3') });
await sleep(1200);
const after3 = await readCaptions();
const pos3 = after3.captions[1].text_style?.position ?? {};
const anchor3 = after3.captions[1].text_style?.text_anchor;
record('step3-written', { anchor: anchor3, position: pos3, plateWRatio, plateHRatio, applied: drag3.applied, requested: drag3.requested });
check(node2(after3.captions[1].text_style) !== node2(before3.captions[1].text_style),
    '手順3: ドラッグが実際に書き込まれた（クランプ判定が空振りでない）', { before: before3.captions[1].text_style, after: after3.captions[1].text_style });
check((pos3.x ?? 0) + plateWRatio <= 1 + 0.006, '手順3: クランプ ON — 箱の右端がフレーム内（x + plateW/frameW ≤ 1）', { x: pos3.x, plateWRatio, sum: (pos3.x ?? 0) + plateWRatio });
check(pos3.y <= 1 + 0.002, '手順3: クランプ ON — 箱の下端がフレーム内（y ≤ 1）', { y: pos3.y });
check(anchor3 !== 'bc' || pos3.y >= plateHRatio - 0.006, '手順3: クランプ ON — 箱の上端がフレーム内（bc の y ≥ plateH/frameH）', { y: pos3.y, plateHRatio });
const g3after = await seekToCue(CUE2_TIME, CUE2_TEXT);
check(g3after.frameRatio.right <= 1 + 0.01 && g3after.frameRatio.bottom <= 1 + 0.01,
    '手順3: 描画されたプレートもフレーム内に張り付く', { frameRatio: g3after.frameRatio });
await shot('03-clamp-on.png');
await save();

// ================= 手順 4: 🧲 クリックで解除して同じドラッグ =================
let g4 = await geom();
if (!g4.selectBox.active || !g4.selectBox.chipRect) {
    await clickAt(g4.inkCenter.x, g4.inkCenter.y);
    g4 = await geom();
}
record('step4-chip-before', g4.selectBox);
const chipClick = await clickControl('chip', after => after.selectBox.chipOn === false);
const g4after = await geom();
record('step4-chip-after', { ...g4after.selectBox, clickPath: chipClick.path, clickOk: chipClick.ok });
check(/OFF/u.test(g4after.selectBox.chipText || '') && g4after.selectBox.chipOn === false,
    '手順4: 🧲 クリックで「はみ出し防止 OFF」表示になる', { chipText: g4after.selectBox.chipText, chipOn: g4after.selectBox.chipOn, clickPath: chipClick.path });
// (+2000, +2000) をそのまま出すと (a) webview 矩形の外では CDP のマウスイベントが届かず
// pointerup が入らない (b) y が isCaptionWriteRequest の許容（-1..2）を超えて弾かれる。
// そこで「箱の左端をフレーム右端の外へ・下端もフレーム外へ」と着地点で指定する（差分は report に明記）。
const drag4 = await dragPlateToFrame(null, 1.15);
record('step4-write', { path: await awaitWrite(drag4, 'step4') });
await sleep(1200);
const after4 = await readCaptions();
const pos4 = after4.captions[1].text_style?.position ?? {};
record('step4-written', { position: pos4, anchor: after4.captions[1].text_style?.text_anchor, applied: drag4.applied });
check((pos4.x ?? 0) + plateWRatio > 1 + 0.006 || pos4.y > 1 + 0.002 || (pos4.x ?? 0) < 0 || pos4.y < 0,
    '手順4: クランプ解除でフレーム外の値が保存される', { position: pos4, plateWRatio });
check(node2(after4.captions[1]) !== node2(after3.captions[1]),
    '手順4: ファイルが更新された = lint を通っている（lint 不合格なら write されない）', { before: after3.captions[1].text_style, after: after4.captions[1].text_style });
const rendered4 = await seekToCue(CUE2_TIME, CUE2_TEXT);
record('step4-rendered', { frameRatio: rendered4.frameRatio, savedPosition: pos4 });
note('クランプ解除で保存された position（フレーム外）は共有描画カーネル captionAnchorPositionVars が '
    + '0..1 へクランプして描くため、見た目はフレーム端に留まる（4 出口共通。カーネル変更は本票の範囲外）。'
    + `実測: 保存 y=${pos4.y} に対し描画下端比 ${rendered4.frameRatio.bottom.toFixed(4)}。`);
await shot('04-clamp-off.png');
await save();

// ================= 手順 5: ↺ 既定に戻す =================
// 選択枠のコントロール列（バッジ + 🧲 + ↺）はプレート左端から右へ伸びるので、
// フレーム右外に置いたままだと ↺ が webview の外に出てクリックできない。左寄せへ戻す。
const drag5 = await dragPlateToFrame(0.04, 0.9);
record('step5-reposition-write', { path: await awaitWrite(drag5, 'step5-reposition') });
await sleep(1000);
await seekToCue(CUE2_TIME, CUE2_TEXT);
let g5 = await geom();
if (!g5.selectBox.active || !g5.selectBox.resetRect || g5.selectBox.resetHidden) {
    await clickAt(g5.inkCenter.x, g5.inkCenter.y);
    g5 = await geom();
}
record('step5-reset-before', g5.selectBox);
check(g5.selectBox.resetVisible === true, '手順5: 行固有の位置がある字幕に ↺ が出る', { reset: g5.selectBox });
const beforeReset = await readCaptionsText();
const beforeResetJson = JSON.parse(beforeReset);
const resetClick = await clickControl('reset', after => after.selectBox.resetHidden === true);
record('step5-reset-click', { path: resetClick.path, ok: resetClick.ok });
await waitCaptionsChange(beforeReset).catch(error => record('step5-write-timeout', { error: error.message }));
await sleep(1200);
const after5 = await readCaptions();
record('step5-written', { cue2: after5.captions[1] });
check(after5.captions[1].text_style?.text_anchor === undefined && after5.captions[1].text_style?.position === undefined,
    '手順5: 行 2 の text_anchor / position が消える', { text_style: after5.captions[1].text_style });
const remainderBefore = { ...(beforeResetJson.captions[1].text_style ?? {}) };
delete remainderBefore.text_anchor; delete remainderBefore.position;
const remainderAfter = after5.captions[1].text_style ?? {};
check(node2(remainderAfter) === node2(Object.keys(remainderBefore).length ? remainderBefore : {}),
    '手順5: text_style の残り（あれば）は不変', { remainderBefore, remainderAfter });
check(node2(after5.default_text_style) === node2(beforeResetJson.default_text_style), '手順5: default_text_style は不変');
await seekToCue(CUE2_TIME, CUE2_TEXT);
let g5after = await geom();
if (!g5after.selectBox.active) { await clickAt(g5after.inkCenter.x, g5after.inkCenter.y); g5after = await geom(); }
record('step5-reset-after', g5after.selectBox);
check(g5after.selectBox.resetVisible === false || g5after.selectBox.resetHidden === true,
    '手順5: ↺ が消える', { reset: g5after.selectBox });
await shot('05-after-reset.png');
await save();

// ================= 手順 6: 開き直すと 🧲 が ON に戻る（永続化しない） =================
const closed = await runCommand('core.close.tab', 'undefined').catch(error => `close-failed: ${error.message}`);
await evalOn(main, `(() => { const icons=[...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current .lm-TabBar-tabCloseIcon')]; icons.forEach(i=>i.click()); return icons.length; })()`).catch(() => null);
await sleep(1500);
record('step6-closed', { closed });
try { view.close(); } catch { /* already gone */ }
record('step6-reopen', { result: await seekCommand(CUE2_TIME) });
await attachWebview();
await collapseSidePanels();
await calibrate();
const g6seek = await seekToCue(CUE2_TIME, CUE2_TEXT);
await clickAt(g6seek.inkCenter.x, g6seek.inkCenter.y);
const g6 = await geom();
record('step6-chip', g6.selectBox);
check(g6.selectBox.active === true, '手順6: 開き直したあと行 2 を選択できる', { selectBox: g6.selectBox });
check(/ON/u.test(g6.selectBox.chipText || '') && g6.selectBox.chipOn === true,
    '手順6: 🧲 が既定 ON に戻る（クランプ状態は永続化しない）', { chipText: g6.selectBox.chipText, chipOn: g6.selectBox.chipOn });
await shot('06-reopened-clamp-on.png');

results.captionsFinal = await readCaptions();
results.status = results.failures.length === 0 ? 'PASS' : 'FAIL';
results.finishedAt = new Date().toISOString();
results.checkCount = results.checks.length;
results.failCount = results.failures.length;
await save();
console.log(`\n${results.status}: ${results.checks.length - results.failures.length}/${results.checks.length} checks`);
process.exit(results.failures.length === 0 ? 0 : 1);
