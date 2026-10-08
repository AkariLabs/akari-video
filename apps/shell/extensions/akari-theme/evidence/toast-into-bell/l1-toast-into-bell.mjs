// L1 計測スクリプト（検証専用・製品コードではない）。
// 起動済みの dev shell（--remote-debugging-port=<PORT>・隔離ホーム・scaffold 済みプロジェクト）へ CDP で接続し、
// 通知を既存の MessageService 経由で出して、札の生涯（出現 → 吸い込み開始 → 削除 → ベルの数字）を実測する。
//
// 使い方:
//   node l1-toast-into-bell.mjs --port <PORT> --out <出力先> [--akari-home <隔離した AKARI_HOME>] [--case 1,2,3,…] [--repo <WORKTREE>]
//
// --akari-home は場面 1（「更新しました」）で shell-last-version.json を古い版に書き換えるために使う。
// 追加の場面（r3-*）: r3-center（一覧を開いて閉じる）・r3-five（5 件連続）・r3-silent・r3-refade（× のフェード中の再表示）・
//   r3-history-empty（履歴の行と空表示）・r3-dot（右下の小さな色付き要素の列挙）。
//   r3-consent は AKARI プロジェクトではない空のフォルダを開いた起動で --consent-dir <そのフォルダ> を付けて、
//   r3-migrate は version 1 の edit.json を置いたプロジェクトを開いた起動で --legacy-dir <そのフォルダ> を付けて、それぞれ単独で回す。
// 製品コードにテスト専用の入口は無い。Theia の container から MessageService などを duck typing で引く。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const PORT = Number(arg('port', '9481'));
const OUT = path.resolve(arg('out', './l1-out'));
const REPO = path.resolve(arg('repo', process.env.AKARI_L1_REPO ?? path.resolve(HERE, '../../../../../..')));
const AKARI_HOME = arg('akari-home');
const CASES = new Set((arg('case', '1,2,3,4,5,6,7,8a,8c,8d,8e,8b') ?? '').split(',').map(s => s.trim()).filter(Boolean));
const require = createRequire(path.join(REPO, 'package.json'));
const { chromium } = require('playwright-core');
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = n => (typeof n === 'number' ? Math.round(n) : n);
const results = {};
const save = () => fs.writeFileSync(path.join(OUT, 'l1-results.json'), JSON.stringify(results, null, 2) + '\n');
const log = (...a) => console.log(`[l1 ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---- ページ内の記録係 -------------------------------------------------------------------------
// 札（右下）の出現・data-exit の変化（そのときの Web Animations も）・削除と、ベルの数字の変化を performance.now() で残す。
const RECORDER = `(() => {
  if (window.__tibRec) { return 'already'; }
  const rec = window.__tibRec = { events: [] };
  const push = (type, data) => { const o = Object.assign({ type, t: performance.now() }, data); rec.events.push(o); return o; };
  window.__tibToastRows = () => Array.from(document.querySelectorAll('.theia-notifications-overlay .akari-notification-row')).filter(el => !el.closest('.theia-notification-center'));
  const text = el => (el.querySelector('.theia-notification-message')?.textContent || '').slice(0, 80);
  const seen = new WeakSet(); const live = new Set();
  const scan = () => {
    window.__tibToastRows().forEach(el => {
      if (!seen.has(el)) { seen.add(el); live.add(el); const o = push('row-add', { id: el.dataset.messageId, kind: el.dataset.kind, text: text(el) }); const cs = getComputedStyle(el); o.enter = { css: cs.animationName, cssDuration: cs.animationDuration, waapi: anims(el) }; }
    });
    for (const el of Array.from(live)) { if (!el.isConnected) { live.delete(el); push('row-remove', { id: el.dataset.messageId, kind: el.dataset.kind, exit: el.dataset.exit }); } }
  };
  const anims = el => el.getAnimations().filter(a => a.effect && a.effect.getKeyframes).map(a => { const k = a.effect.getKeyframes(); return { duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing, frames: k.length, first: k[0] && { transform: k[0].transform, opacity: k[0].opacity }, last: k[k.length - 1] && { transform: k[k.length - 1].transform, opacity: k[k.length - 1].opacity, borderRadius: k[k.length - 1].borderRadius } }; });
  const bellState = () => { const bell = document.getElementById('status-bar-theia-notification-center'); const b = bell && bell.querySelector('.akari-notification-badge'); return JSON.stringify({ badge: b && !b.hidden ? b.textContent : null, error: bell ? bell.dataset.unreadError || null : null, ring: !!(bell && bell.classList.contains('akari-bell-ring')) }); };
  let last = bellState();
  const mo = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-exit' && r.target instanceof HTMLElement && r.target.classList.contains('akari-notification-row') && !r.target.closest('.theia-notification-center')) {
        const el = r.target; const o = push('row-exit', { id: el.dataset.messageId, kind: el.dataset.kind, exit: el.dataset.exit, text: text(el) });
        requestAnimationFrame(() => { o.origin = el.style.transformOrigin; o.animations = anims(el); o.ringAtExit = (() => { const fg = el.querySelector('.akari-ring-fg'); return fg ? Number((1 - parseFloat(getComputedStyle(fg).strokeDashoffset) / 56.55).toFixed(4)) : null; })(); });
      }
    }
    scan();
    const now = bellState();
    if (now !== last) { last = now; push('bell', JSON.parse(now)); }
  });
  const start = () => { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-exit', 'class', 'hidden', 'data-unread-error'], characterData: true }); scan(); };
  if (document.documentElement) { start(); } else { document.addEventListener('DOMContentLoaded', start); }
  return 'installed';
})()`;

const FIND = `(() => {
  const c = window.theia && window.theia.container; if (!c) { return { ready: false }; }
  const keys = [...c._bindingDictionary._map.keys()];
  const has = (k, names) => typeof k === 'function' && k.prototype && names.every(n => typeof k.prototype[n] === 'function');
  const pick = (...names) => { const k = keys.find(x => has(x, names)); try { return k && c.get(k); } catch (e) { return undefined; } };
  const t = window.__tib = window.__tib || { results: {}, progress: {} };
  t.ms = pick('info', 'warn', 'error', 'showProgress');
  t.nm = pick('showMessage', 'toggleCenter');
  t.commands = pick('executeCommand', 'registerCommand');
  t.themes = pick('setCurrentTheme', 'getCurrentTheme');
  t.updateToast = pick('showForTest', 'setState');
  return { ready: true, ms: !!t.ms, nm: !!t.nm, commands: !!t.commands, themes: !!t.themes, updateToast: !!t.updateToast };
})()`;

let browser; let page; let cdp;

async function attach() {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const pages = browser.contexts().flatMap(c => c.pages());
    page = pages.find(p => /frontend\/index\.html/.test(p.url())) ?? pages[0];
    cdp = await page.context().newCDPSession(page);
}

async function waitReady(timeoutMs = 240000) {
    const end = Date.now() + timeoutMs;
    let nudged = 0;
    for (;;) {
        const ok = await page.evaluate(`Boolean(window.theia && window.theia.container && document.getElementById('theia-app-shell') && document.getElementById('status-bar-theia-notification-center') && (() => { const p = document.querySelector('.theia-preload'); return !p || getComputedStyle(p).display === 'none' || Number(getComputedStyle(p).opacity) === 0; })())`).catch(() => false);
        if (ok) { break; }
        if (Date.now() - nudged > 5000) { nudged = Date.now(); await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 10 }).catch(() => undefined); } // 画面消灯時に 1 コマ進める
        if (Date.now() > end) { throw new Error('app not ready'); }
        await sleep(300);
    }
    await page.evaluate(RECORDER);
    return page.evaluate(FIND);
}

const viewport = () => page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
async function shot(name, clip) {
    const params = { format: 'png' };
    if (clip) { params.clip = { ...clip, scale: clip.scale ?? 1 }; }
    const r = await cdp.send('Page.captureScreenshot', params);
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return name;
}
async function cornerClip(w = 460, h = 360, scale = 1) { const v = await viewport(); return { x: v.w - w, y: v.h - h, width: w, height: h, scale }; }

const events = () => page.evaluate('window.__tibRec.events.slice()');

async function notify(key, kind, text, actions = [], options) {
    return page.evaluate(({ key, kind, text, actions, options }) => {
        const t = window.__tib; const at = performance.now();
        t.results[key] = { state: 'pending' };
        const args = options ? [text, options, ...actions] : [text, ...actions];
        t.ms[kind](...args).then(v => { t.results[key] = { state: 'resolved', value: v === undefined ? null : v, afterMs: Math.round(performance.now() - at) }; });
        return at;
    }, { key, kind, text, actions, options });
}
const resultOf = key => page.evaluate(k => window.__tib.results[k], key);

async function state() {
    return page.evaluate(() => {
        const nm = window.__tib.nm;
        const bell = document.getElementById('status-bar-theia-notification-center');
        const badge = bell && bell.querySelector('.akari-notification-badge');
        const mapRows = list => list.map(el => {
            const r = el.getBoundingClientRect(); const fg = el.querySelector('.akari-ring-fg');
            return { id: el.dataset.messageId, kind: el.dataset.kind, exit: el.dataset.exit, text: (el.querySelector('.theia-notification-message')?.textContent || '').slice(0, 80),
                buttons: Array.from(el.querySelectorAll('.akari-notification-button')).map(b => b.textContent + (b.classList.contains('primary') ? '*' : '')),
                time: el.querySelector('.akari-notification-time')?.textContent ?? null, close: !!el.querySelector('.akari-notification-close'),
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                ring: fg ? Number((1 - parseFloat(getComputedStyle(fg).strokeDashoffset) / 56.55).toFixed(4)) : null };
        });
        const rows = sel => mapRows(Array.from(document.querySelectorAll(sel + ' .akari-notification-row')));
        return {
            t: performance.now(), visibility: nm.visibilityState, toastsModel: [...nm.toasts.keys()], notificationsModel: [...nm.notifications.keys()],
            badge: badge && !badge.hidden ? badge.textContent : null, bellError: bell ? bell.dataset.unreadError || null : null,
            bellTooltip: bell ? (bell.getAttribute('aria-label') || bell.getAttribute('title')) : null,
            toasts: mapRows(window.__tibToastRows()), center: rows('.theia-notification-center'),
            centerOpen: !!document.querySelector('.theia-notification-center.open'),
            centerTitle: document.querySelector('.theia-notification-center-header-title')?.textContent ?? null,
            centerEmpty: document.querySelector('.theia-notification-center .akari-notification-empty')?.textContent ?? null,
            centerClear: document.querySelector('.theia-notification-center .akari-notification-clear')?.textContent ?? null
        };
    });
}

async function clearAll() {
    await page.evaluate(() => { const nm = window.__tib.nm; nm.clearAll(); nm.hideCenter(); });
    await page.mouse.move(40, 40);
    await sleep(450);
}

// 札 1 枚の生涯: 出現 → data-exit（absorbing / dismissing）→ 削除、と削除前後のベルの変化
async function lifecycle(textPart, timeoutMs, sinceT = 0) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const ev = await events();
        const add = ev.filter(e => e.type === 'row-add' && e.t >= sinceT && e.text.includes(textPart)).pop();
        if (add) {
            const after = ev.filter(e => e.t >= add.t && e.id === add.id);
            const exit = after.find(e => e.type === 'row-exit' && e.exit !== 'none');
            const remove = after.find(e => e.type === 'row-remove');
            if (remove) {
                await sleep(900);
                const ev2 = await events();
                const exit2 = ev2.find(e => e.type === 'row-exit' && e.id === add.id && e.t >= add.t && e.exit !== 'none');
                const bell = ev2.filter(e => e.type === 'bell' && e.t >= (exit ? exit.t : remove.t) - 20 && e.t <= remove.t + 800);
                return {
                    id: add.id, kind: add.kind, addT: add.t, exit: exit ? exit.exit : null,
                    exitStartMs: exit ? round(exit.t - add.t) : null, removedMs: round(remove.t - add.t),
                    exitDurationMs: exit ? round(remove.t - exit.t) : null,
                    bell: bell.map(b => ({ atMs: round(b.t - add.t), afterRemoveMs: round(b.t - remove.t), badge: b.badge, error: b.error, ring: b.ring })),
                    animations: exit2 ? exit2.animations : undefined, origin: exit2 ? exit2.origin : undefined, ringAtExit: exit2 ? exit2.ringAtExit : undefined, enter: add.enter
                };
            }
        }
        if (Date.now() > end) { return { timeout: true, textPart, appeared: !!add }; }
        await sleep(40);
    }
}

async function toastRow(textPart) {
    return page.evaluate(part => {
        const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes(part));
        if (!el) { return null; }
        const r = el.getBoundingClientRect();
        return { id: el.dataset.messageId, x: r.x, y: r.y, w: r.width, h: r.height };
    }, textPart);
}
async function waitToast(textPart, timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    for (;;) { const r = await toastRow(textPart); if (r) { return r; } if (Date.now() > end) { throw new Error('toast not shown: ' + textPart); } await sleep(30); }
}
const bellClick = () => page.evaluate(() => document.getElementById('status-bar-theia-notification-center').click());
async function openCenter() { if (!(await state()).centerOpen) { await bellClick(); await sleep(350); } }
async function closeCenter() { await page.evaluate(() => window.__tib.nm.hideCenter()); await sleep(250); }

// ---- 場面 -------------------------------------------------------------------------------------

async function case1() {
    if (!AKARI_HOME) { results.case1 = { skipped: '--akari-home が無い' }; return; }
    fs.mkdirSync(AKARI_HOME, { recursive: true });
    fs.writeFileSync(path.join(AKARI_HOME, 'shell-last-version.json'), JSON.stringify({ lastVersion: '0.0.1', updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n');
    await page.addInitScript(RECORDER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady();
    const life = await lifecycle('に更新しました', 90000);
    const before = await state();
    await openCenter();
    const opened = await state();
    const shotName = await shot('l1-1-updated-in-center.png');
    const row = opened.center.find(r => r.text.includes('に更新しました'));
    await closeCenter();
    const closed = await state();
    results.case1 = {
        text: row ? row.text : null, life, badgeAfterAbsorb: before.badge, tooltipAfterAbsorb: before.bellTooltip,
        centerHasRow: !!row, centerButtons: row ? row.buttons : null, badgeAfterOpen: opened.badge, tooltipAfterOpen: closed.bellTooltip,
        stillListedAfterClose: closed.notificationsModel.length, screenshot: shotName
    };
}

async function case2() {
    const table = [
        { key: 'plain', kind: 'info', text: '字幕をコピーしました', actions: [], expect: 3000 },
        { key: 'one', kind: 'info', text: '書き出しが終わりました（計測）', actions: ['フォルダを開く'], expect: 5000 },
        { key: 'two', kind: 'info', text: '拡張の新しい版があります（計測）', actions: ['今すぐ更新', '後で'], expect: 8000 },
        { key: 'error', kind: 'error', text: 'Codex を起動できませんでした（計測）', actions: [], expect: 8000 },
        { key: 'warning', kind: 'warn', text: '素材を移動しています（計測・警告）', actions: [], expect: 8000 },
        { key: 'explicit', kind: 'info', text: '明示の timeout 1500（計測）', actions: ['ボタン'], options: { timeout: 1500 }, expect: 1500 }
    ];
    results.case2 = {};
    for (const row of table) {
        await clearAll();
        const at = await notify('c2-' + row.key, row.kind, row.text, row.actions, row.options);
        await waitToast(row.text.slice(0, 8));
        if (row.key === 'two' || row.key === 'error') { await sleep(500); await shot(`l1-2-${row.key}-toast.png`, await cornerClip()); }
        const life = await lifecycle(row.text.slice(0, 10), row.expect + 6000, at - 5);
        const st = await state();
        results.case2[row.key] = { expectMs: row.expect, ...life, addT: undefined, result: await resultOf('c2-' + row.key), listedAfter: st.notificationsModel.includes(life.id), badge: st.badge, bellError: st.bellError };
        log('case2', row.key, 'exitStart', life.exitStartMs, 'removed', life.removedMs);
        save();
    }
    // timeout: 0 は 12 秒たっても右下に残り、輪が無い
    await clearAll();
    await notify('c2-pinned', 'error', '保存できませんでした（計測・timeout 0）', ['もう一度'], { timeout: 0 });
    await waitToast('保存できません');
    await sleep(12000);
    const pinned = (await state()).toasts.find(t => t.text.includes('保存できません'));
    results.case2.pinned = { stillShownAfter12s: !!pinned, ring: pinned ? pinned.ring : undefined, exit: pinned ? pinned.exit : undefined };
    await shot('l1-2-pinned-toast.png', await cornerClip());
    await clearAll();
}

async function case3() {
    await clearAll();
    const text = '止まる計測の通知';
    const at = await notify('c3', 'info', text, ['ボタン']);
    const row = await waitToast(text);
    await sleep(1500);
    await page.mouse.move(row.x + 60, row.y + row.h / 2);
    await sleep(300);
    const s1 = await state();
    const shot1 = await shot('l1-3-hover-start.png', await cornerClip());
    await sleep(11700);
    const s2 = await state();
    const shot2 = await shot('l1-3-hover-12s.png', await cornerClip());
    const t1 = s1.toasts.find(t => t.text.includes(text)); const t2 = s2.toasts.find(t => t.text.includes(text));
    await page.mouse.move(40, 40);
    const leftAt = await page.evaluate('performance.now()');
    const life = await lifecycle(text, 9000, at - 5);
    results.case3 = {
        hoveredAtMs: round(s1.t - at), ringAtHoverStart: t1 ? t1.ring : null, ringAfter12s: t2 ? t2.ring : null, stillShownAfter12s: !!t2,
        expectedRemainingMs: t2 ? round(t2.ring * 5000) : null,
        absorbStartAfterLeaveMs: life.exitStartMs !== null && life.exitStartMs !== undefined ? round(life.addT + life.exitStartMs - leftAt) : null,
        removedAfterLeaveMs: life.removedMs !== undefined ? round(life.addT + life.removedMs - leftAt) : null,
        exit: life.exit, screenshots: [shot1, shot2]
    };
    // フォーカスが札の中にある間も止まる
    await clearAll();
    const text2 = 'フォーカスで止まる計測';
    const at2 = await notify('c3f', 'info', text2, ['ボタン']);
    await waitToast(text2);
    await sleep(800);
    await page.evaluate(part => { const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes(part)); el.querySelector('.akari-notification-button').focus(); }, text2);
    await sleep(7000);
    const f1 = (await state()).toasts.find(t => t.text.includes(text2));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const blurAt = await page.evaluate('performance.now()');
    const life2 = await lifecycle(text2, 9000, at2 - 5);
    results.case3.focus = { stillShownAfter7s: !!f1, ringWhileFocused: f1 ? f1.ring : null, absorbStartAfterBlurMs: life2.exitStartMs !== null && life2.exitStartMs !== undefined ? round(life2.addT + life2.exitStartMs - blurAt) : null };
}

async function case4() {
    await clearAll();
    // 上 = 2 ボタン（8 秒）・真ん中 = ボタンなし（3 秒）・下 = 1 ボタン（5 秒）。真ん中が先に吸い込まれる
    await notify('c4a', 'info', 'Claude Code 拡張の新しい版があります', ['今すぐ更新', '後で']);
    await waitToast('Claude Code 拡張');
    const atB = await notify('c4b', 'info', '字幕をコピーしました');
    await waitToast('字幕をコピー');
    await notify('c4c', 'info', 'AKARI Video を v9.9.9 に更新しました（見本）', ['変更点を見る']);
    await waitToast('v9.9.9');
    await sleep(500);
    await shot('l1-4-three-stacked.png', await cornerClip());
    // 並びの記録（毎コマ）: 残った札が詰まる様子を数値で残す
    await page.evaluate(() => {
        const s = window.__tib.sampler = { rows: [], on: true };
        const f = () => { if (!s.on) { return; } s.rows.push({ t: performance.now(), y: Array.from(window.__tibToastRows()).map(el => [(el.textContent || '').slice(0, 6), Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().height), el.dataset.exit]) }); requestAnimationFrame(f); };
        requestAnimationFrame(f);
    });
    // 連続スクショ: 画面の録画（screencast・描かれたコマごとに届く）を吸い込みの前後で受け取り、あとで 60ms 刻みに間引く。
    // 1 枚ずつ撮る方式は機械が混んでいると 1 枚に 80ms 以上かかり、60ms 刻みを保てない
    const offset = await page.evaluate('performance.timeOrigin');
    const pageNow = () => performance.timeOrigin + performance.now() - offset;
    const cast = [];
    const onFrame = f => { cast.push({ t: f.metadata.timestamp * 1000 - offset, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined); };
    cdp.on('Page.screencastFrame', onFrame);
    while (pageNow() < atB + 2300) { await sleep(10); }
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    const life = await lifecycle('字幕をコピー', 8000, atB - 5);
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', onFrame);
    await page.evaluate(() => { window.__tib.sampler.on = false; });
    const exitT = life.addT + (life.exitStartMs ?? 0);
    const removeT = life.addT + life.removedMs;
    const frames = [];
    let next = exitT - 130;
    for (const f of cast) { if (f.t >= next && f.t <= removeT + 520) { frames.push({ i: frames.length, t: f.t, data: f.data }); next = f.t + 60; } }
    const index = [];
    for (const f of frames) {
        const name = `l1-4-absorb-${String(f.i).padStart(2, '0')}.png`;
        fs.writeFileSync(path.join(OUT, name), Buffer.from(f.data, 'base64'));
        index.push({ file: name, sinceAbsorbStartMs: round(f.t - exitT), sinceRemovedMs: round(f.t - removeT) });
    }
    results.case4capture = { recordedFrames: cast.length, recordedGapMs: cast.slice(1).map((f, i) => round(f.t - cast[i].t)).filter((g, i) => cast[i + 1].t >= exitT - 130 && cast[i + 1].t <= removeT + 520) };
    const samples = await page.evaluate(() => window.__tib.sampler.rows);
    const pick = ms => { const s = samples.find(x => x.t >= ms); return s ? s.y : null; };
    results.case4 = {
        life: { ...life, addT: undefined }, frameCount: frames.length,
        frameIntervalMs: frames.slice(1).map((f, i) => round(f.t - frames[i].t)), frames: index,
        layout: { beforeAbsorb: pick(exitT - 100), midAbsorb: pick(exitT + 300), atRemove: pick(removeT + 20), after120: pick(removeT + 120), after200: pick(removeT + 200), after400: pick(removeT + 400), settled: pick(removeT + 700) },
        bell: await page.evaluate(() => { const b = document.getElementById('status-bar-theia-notification-center').getBoundingClientRect(); return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) }; })
    };
    await sleep(600);
    await shot('l1-4-after-absorb.png', await cornerClip());
    await clearAll();
}

async function case5() {
    await clearAll();
    const base = await state();
    // ×
    const at = await notify('c5x', 'info', '× で閉じる通知（計測）', ['ボタン']);
    await waitToast('× で閉じる');
    await sleep(600);
    await page.evaluate(() => { const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes('× で閉じる')); el.querySelector('.akari-notification-close').click(); });
    const lifeX = await lifecycle('× で閉じる', 4000, at - 5);
    const sx = await state();
    // ボタン
    const at2 = await notify('c5b', 'info', 'ボタンを押す通知（計測）', ['今すぐ更新', '後で']);
    await waitToast('ボタンを押す');
    await sleep(600);
    await page.evaluate(() => { const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes('ボタンを押す')); Array.from(el.querySelectorAll('.akari-notification-button')).find(b => b.textContent === '後で').click(); });
    const lifeB = await lifecycle('ボタンを押す', 4000, at2 - 5);
    const sb = await state();
    results.case5 = {
        badgeBefore: base.badge,
        close: { exit: lifeX.exit, exitDurationMs: lifeX.exitDurationMs, animations: lifeX.animations, bellEvents: lifeX.bell, listedAfter: sx.notificationsModel.includes(lifeX.id), inCenterDom: sx.center.some(r => r.text.includes('× で閉じる')), badgeAfter: sx.badge, result: await resultOf('c5x') },
        button: { exit: lifeB.exit, exitDurationMs: lifeB.exitDurationMs, bellEvents: lifeB.bell, listedAfter: sb.notificationsModel.includes(lifeB.id), badgeAfter: sb.badge, result: await resultOf('c5b') }
    };
}

async function case6() {
    await clearAll();
    const text = 'Claude Code 拡張の新しい版 2.1.291 があります';
    const at = await notify('c6', 'info', text, ['今すぐ更新', '後で']);
    await waitToast('Claude Code 拡張');
    const life = await lifecycle('Claude Code 拡張', 15000, at - 5);
    const pending = await resultOf('c6');
    const absorbed = await state();
    await openCenter();
    const opened = await state();
    const shotName = await shot('l1-6-center-with-buttons.png', await cornerClip());
    await page.evaluate(() => { const el = Array.from(document.querySelectorAll('.theia-notification-center .akari-notification-row')).find(e => (e.textContent || '').includes('Claude Code 拡張')); Array.from(el.querySelectorAll('.akari-notification-button')).find(b => b.textContent === '今すぐ更新').click(); });
    await sleep(500);
    const after = await state();
    results.case6 = {
        life: { ...life, addT: undefined }, resultAfterAbsorb: pending, badgeAfterAbsorb: absorbed.badge, listedAfterAbsorb: absorbed.notificationsModel.includes(life.id),
        centerRow: opened.center.find(r => r.text.includes('Claude Code 拡張')) ?? null, badgeAfterOpen: opened.badge,
        resultAfterClick: await resultOf('c6'), listedAfterClick: after.notificationsModel.includes(life.id), screenshot: shotName
    };
    await closeCenter();
}

async function setTheme(id) { await page.evaluate(i => window.__tib.themes.setCurrentTheme(i), id); await sleep(900); }

async function case7() {
    results.case7 = {};
    for (const theme of ['dark', 'light']) {
        await setTheme(theme);
        await clearAll();
        await notify('c7i-' + theme, 'info', 'AKARI Video を v1.2.0-beta.5 に更新しました', ['変更点を見る']);
        await waitToast('に更新しました');
        await sleep(700);
        const single = await shot(`l1-7-${theme}-toast.png`, await cornerClip(460, 300, 2));
        const full = await shot(`l1-7-${theme}-full.png`);
        await notify('c7w-' + theme, 'warn', '素材の場所を確認できませんでした', []);
        await notify('c7e-' + theme, 'error', 'Codex を起動できませんでした', ['もう一度試す'], { timeout: 1600 });
        await waitToast('Codex を起動');
        await sleep(500);
        const stack = await shot(`l1-7-${theme}-stack.png`, await cornerClip(460, 330, 2));
        const life = await lifecycle('Codex を起動', 6000);
        await sleep(300);
        const st = await state();
        const bellShot = await shot(`l1-7-${theme}-bell-error.png`, await cornerClip(230, 60, 4));
        const badgeColor = await page.evaluate(() => { const b = document.querySelector('#status-bar-theia-notification-center .akari-notification-badge'); return b ? getComputedStyle(b).backgroundColor : null; });
        const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { danger: cs.getPropertyValue('--akari-danger').trim(), accent: cs.getPropertyValue('--akari-accent').trim() }; });
        await page.mouse.move(40, 40);
        const rest = await lifecycle('に更新しました', 9000);
        await sleep(300);
        await openCenter();
        const centerShot = await shot(`l1-7-${theme}-center.png`, await cornerClip(460, 360, 2));
        const opened = await state();
        const style = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.theia-notification-center')); const r = document.querySelector('.theia-notification-center .akari-notification-row'); return { radius: c.borderRadius, background: c.backgroundColor, backdrop: c.backdropFilter, border: c.border, rowRadius: r ? getComputedStyle(r).borderRadius : null }; });
        await closeCenter();
        results.case7[theme] = { screenshots: [single, full, stack, bellShot, centerShot], errorAbsorb: { exit: life.exit, removedMs: life.removedMs }, badge: st.badge, bellError: st.bellError, badgeColor, tokens, infoAbsorbed: rest.exit, centerTitle: opened.centerTitle, centerClear: opened.centerClear, centerRows: opened.center.map(r => ({ kind: r.kind, text: r.text.slice(0, 30), buttons: r.buttons, time: r.time })), centerStyle: style };
        await clearAll();
        await openCenter();
        const empty = await state();
        results.case7[theme].empty = { text: empty.centerEmpty, title: empty.centerTitle, tooltip: empty.bellTooltip, screenshot: await shot(`l1-7-${theme}-center-empty.png`, await cornerClip(460, 200, 2)) };
        await closeCenter();
        save();
    }
    await setTheme('dark');
    // 札の意匠の実測（ダーク）
    await clearAll();
    await notify('c7s', 'info', '意匠の実測', ['ひとつ']);
    await waitToast('意匠の実測');
    await sleep(500);
    results.case7.toastStyle = await page.evaluate(() => { const el = window.__tibToastRows()[0]; const c = getComputedStyle(el); const b = getComputedStyle(el.querySelector('.akari-notification-button')); const icon = getComputedStyle(el.querySelector('.theia-notification-icon')); return { radius: c.borderRadius, border: c.border, background: c.backgroundColor, backdrop: c.backdropFilter, shadow: c.boxShadow, width: Math.round(el.getBoundingClientRect().width), button: { radius: b.borderRadius, background: b.backgroundColor, color: b.color, classes: el.querySelector('.akari-notification-button').className }, icon: { radius: icon.borderRadius, w: icon.width, color: icon.color }, enterAnimation: el.getAnimations().map(a => a.animationName || a.id) }; });
    await clearAll();
    // 動きを減らす設定: 吸い込みの代わりに 160ms のフェード。未読の加算は同じ。
    // 前の吸い込みで付いた akari-bell-ring が残っていると「揺れない」の証拠にならないので、測る前に外す
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ringCleared = await page.evaluate(() => { const b = document.getElementById('status-bar-theia-notification-center'); const had = b.classList.contains('akari-bell-ring'); b.classList.remove('akari-bell-ring'); return { had, now: b.classList.contains('akari-bell-ring') }; });
    const before = await state();
    const at = await notify('c7r', 'info', '動きを減らす設定の計測');
    await waitToast('動きを減らす');
    const reduced = await lifecycle('動きを減らす', 8000, at - 5);
    const afterReduced = await state();
    const ringAfter = await page.evaluate(() => { const b = document.getElementById('status-bar-theia-notification-center'); const icon = b.querySelector('.codicon'); return { ringClass: b.classList.contains('akari-bell-ring'), iconAnimations: icon ? icon.getAnimations().length : null, iconAnimationName: icon ? getComputedStyle(icon).animationName : null }; });
    await page.emulateMedia({ reducedMotion: null });
    results.case7.reducedMotion = { ringClearedBefore: ringCleared, life: { ...reduced, addT: undefined }, badgeBefore: before.badge, badgeAfter: afterReduced.badge, ringAfter };
    // ベルの要素が見つからないとき: 同じく 160ms のフェード
    await clearAll();
    await page.evaluate(() => { document.getElementById('status-bar-theia-notification-center').id = 'tib-bell-away'; });
    const at2 = await notify('c7n', 'info', 'ベルが無いときの計測');
    await waitToast('ベルが無い');
    const noBell = await lifecycle('ベルが無い', 8000, at2 - 5);
    await page.evaluate(() => { document.getElementById('tib-bell-away').id = 'status-bar-theia-notification-center'; });
    await sleep(300);
    const afterNoBell = await state();
    results.case7.noBell = { life: { ...noBell, addT: undefined }, listedAfter: afterNoBell.notificationsModel.includes(noBell.id), unreadModel: await page.evaluate(() => { const l = window.__tib.nm.life; return l ? l.unreadCount : null; }) };
    await clearAll();
}

async function case8a() {
    await clearAll();
    await page.evaluate(() => window.__tib.commands.executeCommand('akari.update.testFound'));
    await sleep(900);
    const style = await page.evaluate(() => { const t = document.querySelector('.akari-update-toast'); if (!t) { return null; } const c = getComputedStyle(t); const b = t.querySelector('.akari-update-button'); const p = t.querySelector('.akari-update-button.primary'); return { radius: c.borderRadius, background: c.backgroundColor, backdrop: c.backdropFilter, border: c.border, shadow: c.boxShadow, title: t.querySelector('.akari-update-title')?.textContent, buttons: Array.from(t.querySelectorAll('.akari-update-button')).map(x => x.textContent), buttonRadius: b ? getComputedStyle(b).borderRadius : null, primaryBackground: p ? getComputedStyle(p).backgroundColor : null }; });
    const s1 = await shot('l1-8a-update-toast.png', await cornerClip(460, 300, 2));
    await page.evaluate(() => { const t = document.querySelector('.akari-update-toast'); Array.from(t.querySelectorAll('.akari-update-button')).find(b => b.textContent === '後で').click(); });
    await sleep(400);
    const hiddenAfterLater = await page.evaluate(() => !document.querySelector('.akari-update-toast'));
    await openCenter();
    await sleep(300);
    const history = await page.evaluate(() => { const h = document.querySelector('.theia-notification-center .theia-notification-list .akari-update-history'); if (!h) { return null; } const c = getComputedStyle(h); return { text: h.textContent, radius: c.borderRadius, borderBottom: c.borderBottomWidth, firstInList: h.parentElement.firstElementChild === h }; });
    const s2 = await shot('l1-8a-history-row.png', await cornerClip(460, 300, 2));
    await page.evaluate(() => document.querySelector('.theia-notification-center .akari-update-history')?.click());
    await sleep(500);
    const reopened = await page.evaluate(() => ({ toast: !!document.querySelector('.akari-update-toast'), centerOpen: !!document.querySelector('.theia-notification-center.open') }));
    const s3 = await shot('l1-8a-reopened.png', await cornerClip(460, 300, 2));
    // 後片付け: 見本の状態を消す（× = この版は出さない）
    await page.evaluate(() => document.querySelector('.akari-update-toast .akari-update-close')?.click());
    await sleep(300);
    await page.evaluate(() => window.__tib.updateToast && window.__tib.updateToast.setState(undefined));
    await sleep(200);
    const cleared = await page.evaluate(() => !document.querySelector('.akari-update-history') && !document.querySelector('.akari-update-toast'));
    results.case8a = { style, hiddenAfterLater, history, reopened, clearedAfter: cleared, screenshots: [s1, s2, s3] };
    await clearAll();
}

async function case8c() {
    await clearAll();
    await page.evaluate(async () => { const t = window.__tib; t.progress.p = await t.ms.showProgress({ text: '素材を移動しています…（計測）' }); t.progress.p.report({ message: '3 / 12', work: { done: 3, total: 12 } }); });
    await waitToast('素材を移動して');
    await sleep(10000);
    const st = await state();
    const row = st.toasts.find(t => t.text.includes('素材を移動して'));
    const s1 = await shot('l1-8c-progress-10s.png', await cornerClip());
    await page.evaluate(() => window.__tib.progress.p.cancel());
    await sleep(700);
    const after = await state();
    results.case8c = { stillShownAfter10s: !!row, kind: row ? row.kind : null, ring: row ? row.ring : null, closeButton: row ? row.close : null, goneAfterDone: !after.toasts.some(t => t.text.includes('素材を移動して')), listedAfterDone: after.notificationsModel.length, badgeAfterDone: after.badge, screenshot: s1 };
}

async function case8d() {
    await clearAll();
    // クリップボードは利用者のものなので書き換えない。右クリック → メニュー項目 → コマンド実行（引数つき）までを確かめ、
    // 実行そのものは横取りして止める。平文への変換は同じ contribution のメソッドで確かめる。
    await page.evaluate(() => { const t = window.__tib; const c = t.commands; if (!t.origExecute) { t.origExecute = c.executeCommand.bind(c); c.executeCommand = (id, ...args) => { if (id === 'notifications.commands.copyMessage') { t.copyCall = { id, message: args[0] && args[0].message, enabled: c.isEnabled(id, ...args) }; return Promise.resolve(); } return t.origExecute(id, ...args); }; } });
    await notify('c8d', 'info', 'コピーされる本文 <b>太字</b> と https://example.com', ['ボタン'], { timeout: 0 });
    const row = await waitToast('コピーされる本文');
    await sleep(400);
    await page.mouse.click(row.x + 80, row.y + 20, { button: 'right' });
    await sleep(600);
    const menu = await page.evaluate(() => Array.from(document.querySelectorAll('.lm-Menu .lm-Menu-item')).map(i => (i.querySelector('.lm-Menu-itemLabel')?.textContent || '').trim()).filter(Boolean));
    const s1 = await shot('l1-8d-context-menu.png', await cornerClip(560, 330));
    const clicked = await page.evaluate(() => { const item = Array.from(document.querySelectorAll('.lm-Menu .lm-Menu-item')).find(i => /Copy Message|メッセージ/.test(i.textContent || '')); if (!item) { return false; } const r = item.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (clicked) { await page.mouse.click(clicked.x, clicked.y); }
    await sleep(500);
    const call = await page.evaluate(() => { const t = window.__tib; const c = t.commands; c.executeCommand = t.origExecute; t.origExecute = undefined; return t.copyCall ?? null; });
    await page.keyboard.press('Escape').catch(() => undefined);
    results.case8d = { menuItems: menu, clicked: !!clicked, commandCall: call, clipboardWritten: false, note: '利用者のクリップボードを書き換えないため、コマンドの実行は横取りして止めた', screenshot: s1 };
    await clearAll();
}

async function case8e() {
    await clearAll();
    const text = '最小化の計測';
    const at = await notify('c8e', 'info', text, ['ボタン']);
    await waitToast(text);
    await sleep(1000);
    const before = (await state()).toasts.find(t => t.text.includes(text));
    const minimizedAt = await page.evaluate(() => { window.electronTheiaCore.minimize(); return performance.now(); });
    await sleep(12000);
    const during = await page.evaluate(() => ({ visibility: document.visibilityState, screenX: window.screenX, outerWidth: window.outerWidth }));
    const st = await state();
    const mid = st.toasts.find(t => t.text.includes(text));
    results.case8e = { ringBeforeMinimize: before ? before.ring : null, minimizedForMs: 12000, during, stillShownWhileMinimized: !!mid, ringWhileMinimized: mid ? mid.ring : null, exitWhileMinimized: mid ? mid.exit : null, listedAsAbsorbed: !mid && st.notificationsModel.length > 0, minimizedAtMs: round(minimizedAt - at), restore: 'この後、呼び出し側が窓を戻す（--after-restore）' };
}

async function case8eAfterRestore() {
    const text = '最小化の計測';
    const restoredAt = await page.evaluate('performance.now()');
    const st = await state();
    const row = st.toasts.find(t => t.text.includes(text));
    const life = row ? await lifecycle(text, 9000) : null;
    results.case8eAfterRestore = { shownAtRestore: !!row, ringAtRestore: row ? row.ring : null, absorbStartAfterRestoreMs: life && life.exitStartMs !== null ? round(life.addT + life.exitStartMs - restoredAt) : null, removedAfterRestoreMs: life && !life.timeout ? round(life.addT + life.removedMs - restoredAt) : null, exit: life ? life.exit : null };
    await clearAll();
}

async function case8b() {
    // vibe dock を出した状態で札が持ち上がる。dock は設定 akari.vibePreview.enabled（利用者設定）で付くので、隔離した設定に書いて読み込み直す
    const setVibe = value => page.evaluate(async v => {
        const c = window.theia.container; let ps;
        for (const [, list] of c._bindingDictionary._map) { for (const b of list) { const i = b.cache; if (!i || typeof i !== 'object') { continue; } try { if (i.ready instanceof Promise && typeof i.onPreferenceChanged === 'function' && typeof i.set === 'function' && typeof i.inspect === 'function') { ps = i; } } catch (e) { /* RPC proxy */ } } }
        if (!ps) { return 'no preference service'; }
        await ps.set('akari.vibePreview.enabled', v, 1);
        await new Promise(r => setTimeout(r, 400));
        return localStorage.getItem('akari.vibePreview.enabled');
    }, value);
    await clearAll();
    await notify('c8b0', 'info', 'dock なしの位置（計測）', ['ボタン'], { timeout: 0 });
    await waitToast('dock なし');
    await sleep(500);
    const plain = await page.evaluate(() => { const c = document.querySelector('.theia-notifications-container.theia-notification-toasts').getBoundingClientRect(); return { bottom: Math.round(innerHeight - c.bottom), right: Math.round(innerWidth - c.right) }; });
    await clearAll();
    const mirrorOn = await setVibe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady();
    await sleep(2500);
    const dock = await page.evaluate(() => { const d = document.querySelector('.akari-vibe-dock'); const r = d && d.getBoundingClientRect(); const cs = getComputedStyle(document.documentElement); return { present: !!d, layout: d ? d.dataset.layout : null, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, lift: cs.getPropertyValue('--akari-vibe-dock-toast-lift').trim(), right: cs.getPropertyValue('--akari-vibe-dock-toast-right').trim() }; });
    await clearAll();
    await notify('c8b1', 'info', 'dock ありの位置（計測）', ['ボタン'], { timeout: 0 });
    await waitToast('dock あり');
    await sleep(900);
    const withDock = await page.evaluate(() => { const c = document.querySelector('.theia-notifications-container.theia-notification-toasts').getBoundingClientRect(); const row = window.__tibToastRows()[0].getBoundingClientRect(); const d = document.querySelector('.akari-vibe-dock'); const dr = d && d.getBoundingClientRect(); const cs = getComputedStyle(document.documentElement); return { bottom: Math.round(innerHeight - c.bottom), right: Math.round(innerWidth - c.right), rowBottom: Math.round(row.bottom), dockTop: dr ? Math.round(dr.top) : null, dockLeft: dr ? Math.round(dr.left) : null, lift: cs.getPropertyValue('--akari-vibe-dock-toast-lift').trim(), rightVar: cs.getPropertyValue('--akari-vibe-dock-toast-right').trim(), overlapsDock: dr ? !(row.bottom <= dr.top || row.right <= dr.left || row.left >= dr.right || row.top >= dr.bottom) : null }; });
    const s1 = await shot('l1-8b-vibe-dock-lift.png');
    await clearAll();
    const mirrorOff = await setVibe(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady();
    results.case8b = { withoutDock: plain, mirrorOn, mirrorOff, dock, withDock, screenshot: s1 };
}

// 見本との見比べ用: 見本と同じ 3 場面（札 1 枚・3 枚重ね・一覧）を同じ大きさ（右下 460×330・2 倍）で撮る
async function case9() {
    results.case9 = { screenshots: [] };
    for (const [theme, suffix] of [['dark', ''], ['light', '-light']]) {
        await setTheme(theme);
        await clearAll();
        await notify('c9a' + theme, 'info', 'AKARI Video を v1.2.0-beta.5 に更新しました', ['変更点を見る']);
        await waitToast('に更新しました');
        await sleep(900);
        results.case9.screenshots.push(await shot(`l1-9-app-single${suffix}.png`, await cornerClip(460, 330, 2)));
        await clearAll();
        await notify('c9b' + theme, 'info', 'Claude Code 拡張の新しい版があります', ['今すぐ更新', '後で']);
        await waitToast('Claude Code 拡張');
        await notify('c9c' + theme, 'info', '字幕をコピーしました');
        await waitToast('字幕をコピー');
        await notify('c9d' + theme, 'info', 'AKARI Video を v1.2.0-beta.5 に更新しました', ['変更点を見る']);
        await waitToast('に更新しました');
        await sleep(700);
        results.case9.screenshots.push(await shot(`l1-9-app-three${suffix}.png`, await cornerClip(460, 330, 2)));
        await clearAll();
        // 一覧: 見本の一覧と同じ顔ぶれ（エラー・更新しました・書き出し・取り込み）を短い timeout で吸い込ませてから開く
        await notify('c9e' + theme, 'info', '素材を 12 件取り込みました', [], { timeout: 400 });
        await sleep(150);
        await notify('c9f' + theme, 'info', '書き出しが終わりました', ['フォルダを開く'], { timeout: 400 });
        await sleep(150);
        await notify('c9g' + theme, 'info', 'AKARI Video を v1.2.0-beta.5 に更新しました', ['変更点を見る'], { timeout: 400 });
        await sleep(150);
        await notify('c9h' + theme, 'error', 'Codex を起動できませんでした', ['もう一度試す'], { timeout: 400 });
        await sleep(2200);
        await openCenter();
        await sleep(400);
        results.case9.screenshots.push(await shot(`l1-9-app-center${suffix}.png`, await cornerClip(460, 330, 2)));
        await closeCenter();
        await clearAll();
    }
    await setTheme('dark');
}

// ---- 差し戻し r1 の追加場面（r3-*） -------------------------------------------------------------

const unreadModel = () => page.evaluate(() => { const l = window.__tib.nm.life; return { unread: l.unreadCount, ringable: l.ringableUnreadCount, error: l.hasUnreadError, counting: l.hasCounting }; });
const clearRing = () => page.evaluate(() => document.getElementById('status-bar-theia-notification-center').classList.remove('akari-bell-ring'));
const ringEventsSince = async t => (await events()).filter(e => e.type === 'bell' && e.t >= t && e.ring).map(e => ({ atMs: round(e.t - t), badge: e.badge }));
const pageNow = () => page.evaluate('performance.now()');
// PreferenceService は container のキー（Symbol の説明）で引く。duck typing だと RPC の proxy を掴むことがある
const setPreference = (name, value) => page.evaluate(async ({ name, value }) => {
    const c = window.theia.container;
    const key = [...c._bindingDictionary._map.keys()].find(k => typeof k === 'symbol' && k.description === 'PreferenceService');
    const ps = c.get(key);
    await ps.set(name, value, 1);
    await new Promise(r => setTimeout(r, 500));
    return ps.get(name);
}, { name, value });
const idOfText = part => page.evaluate(p => { for (const [id, n] of window.__tib.nm.notifications) { if (String(n.message).includes(p)) { return id; } } return null; }, part);

// L1-2: 札が出ている → 一覧を開く → 閉じる → 時間を過ぎる。未読が増えず、ベルも揺れない
async function caseR3Center() {
    await clearAll();
    await clearRing();
    const text = '一覧を開いて閉じる計測';
    await notify('r3c', 'info', text, ['ボタン']);
    await waitToast(text);
    await sleep(1200);
    const id = await idOfText(text);
    const remainingBeforeOpen = await page.evaluate(i => window.__tib.nm.life.remaining(i), id);
    const s1 = await shot('l1r3-2-toast-before-open.png', await cornerClip());
    const t0 = await pageNow();
    await bellClick();
    await sleep(500);
    const opened = await state();
    const openedModel = { phase: await page.evaluate(i => window.__tib.nm.life.phase(i), id), ...(await unreadModel()) };
    const s2 = await shot('l1r3-2-center-open.png', await cornerClip());
    await sleep(800);
    await bellClick();
    await sleep(9000);
    const after = await state();
    const s3 = await shot('l1r3-2-after-9s.png', await cornerClip());
    results.r3Center = {
        remainingBeforeOpenMs: round(remainingBeforeOpen), centerOpened: opened.centerOpen, toastsWhileOpen: opened.toastsModel.length,
        inCenterWhileOpen: opened.center.some(r => r.text.includes(text)), whileOpen: openedModel,
        after9s: { centerOpen: after.centerOpen, toastRows: after.toasts.length, toastsModel: after.toastsModel.length, listed: after.notificationsModel.includes(id), badge: after.badge, ...(await unreadModel()), phase: await page.evaluate(i => window.__tib.nm.life.phase(i), id) },
        ringEventsSinceOpen: await ringEventsSince(t0), result: await resultOf('r3c'), screenshots: [s1, s2, s3]
    };
    await clearAll();
}

// L1-3a: 5 件連続。右下に出ている末尾 3 件だけ時間が減り、古い 2 件は右下に出てから数え始める
async function caseR3Five() {
    await clearAll();
    await clearRing();
    const texts = [1, 2, 3, 4, 5].map(i => `5 件連続の ${i} 件目`);
    await page.evaluate(texts => { const t = window.__tib; texts.forEach((x, i) => { t.results['r3f' + i] = { state: 'pending' }; t.ms.info(x, 'ボタン').then(v => { t.results['r3f' + i] = { state: 'resolved', value: v === undefined ? null : v }; }); }); }, texts);
    const t0 = await pageNow();
    // 250ms ごとに残り時間と右下の並びを取る
    await page.evaluate(texts => {
        const t = window.__tib; const ids = texts.map(x => { for (const [id, n] of t.nm.notifications) { if (String(n.message).includes(x)) { return id; } } return null; });
        t.fiveSampler = { rows: [], ids };
        t.fiveTimer = setInterval(() => {
            const shown = Array.from(window.__tibToastRows()).map(el => ids.indexOf(el.dataset.messageId) + 1);
            t.fiveSampler.rows.push({ t: performance.now(), remaining: ids.map(id => { const r = t.nm.life.remaining(id); return r === undefined ? null : Math.round(r); }), phase: ids.map(id => t.nm.life.phase(id) ?? null), shown });
        }, 250);
    }, texts);
    await sleep(1500);
    const s1 = await shot('l1r3-3-five-first.png', await cornerClip(460, 420));
    await sleep(15000);
    await page.evaluate(() => clearInterval(window.__tib.fiveTimer));
    const sampler = await page.evaluate(() => window.__tib.fiveSampler);
    const ev = await events();
    const per = sampler.ids.map((id, i) => {
        const adds = ev.filter(e => e.type === 'row-add' && e.id === id && e.t >= t0 - 50);
        const lastAdd = adds[adds.length - 1];
        const exit = lastAdd ? ev.find(e => e.type === 'row-exit' && e.id === id && e.t >= lastAdd.t && e.exit !== 'none') : undefined;
        const firstShownSample = sampler.rows.find(r => r.shown.includes(i + 1));
        return { n: i + 1, addCount: adds.length, shownAtMs: lastAdd ? round(lastAdd.t - t0) : null, absorbStartAfterShownMs: exit && lastAdd ? round(exit.t - lastAdd.t) : null, exit: exit ? exit.exit : null, firstSampleShown: firstShownSample ? round(firstShownSample.t - t0) : null };
    });
    const at = ms => { const r = sampler.rows.find(x => x.t - t0 >= ms); return r ? { atMs: round(r.t - t0), remaining: r.remaining, phase: r.phase, shown: r.shown } : null; };
    results.r3Five = { per, samples: { at1000: at(1000), at4000: at(4000), at5500: at(5500), at7000: at(7000), at10000: at(10000) }, allSamples: sampler.rows.map(r => ({ atMs: round(r.t - t0), remaining: r.remaining, shown: r.shown })), finalUnread: await unreadModel(), screenshot: s1 };
    await clearAll();
}

// L1-3b: silent を有効にして 1 件出す → 右下に出ず一覧に入る。未読は増えるがベルは揺れない
async function caseR3Silent() {
    await clearAll();
    const on = await setPreference('workbench.silentNotifications', true);
    await clearRing();
    const t0 = await pageNow();
    const text = 'silent のときの計測（error）';
    await notify('r3s', 'error', text);
    await sleep(1500);
    const st = await state();
    const id = await idOfText(text);
    const model = { phase: await page.evaluate(i => window.__tib.nm.life.phase(i), id), ...(await unreadModel()) };
    const s1 = await shot('l1r3-3-silent-bell.png', await cornerClip());
    await openCenter();
    const opened = await state();
    const s2 = await shot('l1r3-3-silent-center.png', await cornerClip());
    await closeCenter();
    const off = await setPreference('workbench.silentNotifications', false);
    results.r3Silent = {
        preferenceOn: on, preferenceOff: off, toastRows: st.toasts.length, toastsModel: st.toastsModel.length, visibility: st.visibility,
        listed: st.notificationsModel.includes(id), badge: st.badge, bellError: st.bellError, model, ringEvents: await ringEventsSince(t0),
        inCenter: opened.center.some(r => r.text.includes('silent のとき')), result: await resultOf('r3s'), screenshots: [s1, s2]
    };
    await clearAll();
}

// 差し戻し 4: × のフェード中に同じ内容が再表示されても、新しい通知は消えない
async function caseR3Refade() {
    await clearAll();
    const text = '再表示の計測';
    await notify('r3r1', 'info', text, ['ボタン']);
    await waitToast(text);
    await sleep(600);
    await page.evaluate(text => {
        const t = window.__tib;
        const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes(text));
        el.querySelector('.akari-notification-close').click();
        setTimeout(() => { const at = performance.now(); t.results.r3r2 = { state: 'pending' }; t.ms.info(text, 'ボタン').then(v => { t.results.r3r2 = { state: 'resolved', value: v === undefined ? null : v, afterMs: Math.round(performance.now() - at) }; }); }, 60);
    }, text);
    await sleep(900);
    const st = await state();
    const id = await idOfText(text);
    results.r3Refade = { firstResult: await resultOf('r3r1'), secondResult: await resultOf('r3r2'), listed: !!id && st.notificationsModel.includes(id), toastShown: st.toasts.some(r => r.text.includes(text) && r.exit === 'none'), screenshot: await shot('l1r3-4-refade.png', await cornerClip()) };
    await clearAll();
}

// 差し戻し 6: 一覧に更新トーストの履歴の行があるときは「新しい通知はありません」を出さない
async function caseR3HistoryEmpty() {
    await clearAll();
    await openCenter();
    const emptyOnly = await page.evaluate(() => { const e = document.querySelector('.theia-notification-center .akari-notification-empty'); return e ? { text: e.textContent, display: getComputedStyle(e).display } : null; });
    await closeCenter();
    await page.evaluate(() => window.__tib.commands.executeCommand('akari.update.testFound'));
    await sleep(900);
    await page.evaluate(() => { const t = document.querySelector('.akari-update-toast'); Array.from(t.querySelectorAll('.akari-update-button')).find(b => b.textContent === '後で').click(); });
    await sleep(400);
    await openCenter();
    await sleep(300);
    const withHistory = await page.evaluate(() => { const e = document.querySelector('.theia-notification-center .akari-notification-empty'); const h = document.querySelector('.theia-notification-center .theia-notification-list .akari-update-history'); return { history: h ? h.textContent : null, emptyPresent: !!e, emptyDisplay: e ? getComputedStyle(e).display : null, emptyHeight: e ? e.getBoundingClientRect().height : null }; });
    const s1 = await shot('l1r3-6-history-no-empty.png', await cornerClip(460, 300, 2));
    await page.evaluate(() => document.querySelector('.theia-notification-center .akari-update-history')?.click());
    await sleep(500);
    await page.evaluate(() => document.querySelector('.akari-update-toast .akari-update-close')?.click());
    await sleep(300);
    await page.evaluate(() => window.__tib.updateToast && window.__tib.updateToast.setState(undefined));
    await sleep(200);
    results.r3HistoryEmpty = { emptyOnly, withHistory, screenshot: s1 };
    await clearAll();
}

// 差し戻し 8: 右下のオレンジの点の正体（見比べの 3 枚重ねと同じ場面で、右端・ステータスバーの上にある小さな色付きの要素を列挙）
async function caseR3Dot() {
    await clearAll();
    await notify('r3d1', 'info', 'Claude Code 拡張の新しい版があります', ['今すぐ更新', '後で'], { timeout: 0 });
    await notify('r3d2', 'info', '字幕をコピーしました', [], { timeout: 0 });
    await notify('r3d3', 'info', 'AKARI Video を v1.2.0-beta.5 に更新しました', ['変更点を見る'], { timeout: 0 });
    await waitToast('に更新しました');
    await sleep(800);
    const found = await page.evaluate(() => {
        const W = innerWidth; const H = innerHeight; const out = [];
        const chain = el => { const parts = []; for (let e = el; e && parts.length < 6; e = e.parentElement) { parts.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + Array.from(e.classList).slice(0, 3).join('.') : '')); } return parts.join(' < '); };
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.width > 14 || r.height > 14) { continue; }
            if (r.right < W - 40 || r.top < H - 90 || r.bottom > H) { continue; }
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) { continue; }
            const bg = cs.backgroundColor;
            if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') { continue; }
            out.push({ chain: chain(el), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, background: bg, radius: cs.borderRadius, title: el.getAttribute('title') || el.parentElement?.getAttribute('title') || null, aria: el.getAttribute('aria-label') || null });
        }
        const bell = document.getElementById('status-bar-theia-notification-center').getBoundingClientRect();
        const statusBar = document.getElementById('theia-statusBar')?.getBoundingClientRect();
        return { viewport: { w: W, h: H }, candidates: out, bell: { x: Math.round(bell.x), y: Math.round(bell.y), w: Math.round(bell.width), h: Math.round(bell.height) }, statusBarTop: statusBar ? Math.round(statusBar.top) : null };
    });
    const s1 = await shot('l1r3-8-dot-scene.png', await cornerClip(460, 330, 2));
    const first = found.candidates[0];
    const s2 = first ? await shot('l1r3-8-dot-zoom.png', { x: Math.max(0, first.rect.x - 60), y: Math.max(0, first.rect.y - 50), width: Math.min(100, found.viewport.w - Math.max(0, first.rect.x - 60)), height: 80, scale: 4 }) : null;
    results.r3Dot = { ...found, screenshots: [s1, s2] };
    await clearAll();
}

// L1-1（プロジェクトの同意）: AKARI プロジェクトではない空のフォルダを開いた起動で測る（--consent-dir にそのフォルダ）
async function caseR3Consent() {
    const dir = arg('consent-dir');
    const text = 'AKARI Video プロジェクトとして使いますか';
    const before = dir ? fs.readdirSync(dir) : null;
    const row = await waitToast(text, 120000);
    const shownAt = await pageNow();
    const id = row.id;
    const s0 = await shot('l1r3-1-consent-shown.png', await cornerClip());
    while ((await pageNow()) < shownAt + 20000) { await sleep(250); }
    const st = await state();
    const t = st.toasts.find(r => r.text.includes(text));
    const s1 = await shot('l1r3-1-consent-20s.png', await cornerClip());
    const model = await page.evaluate(i => ({ phase: window.__tib.nm.life.phase(i), remaining: window.__tib.nm.life.remaining(i), fraction: window.__tib.nm.life.fraction(i) }), id);
    const ringEl = await page.evaluate(i => !!document.querySelector(`.theia-notification-toasts .akari-notification-row[data-message-id="${i}"] .akari-notification-ring`), id);
    await page.evaluate(text => { const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes(text)); Array.from(el.querySelectorAll('.akari-notification-button')).find(b => b.textContent === '使う').click(); }, text);
    await sleep(4000);
    const after = dir ? fs.readdirSync(dir) : null;
    const st2 = await state();
    results.r3Consent = { shownAfter20s: !!t, exit: t ? t.exit : null, ringValue: t ? t.ring : null, ringElement: ringEl, buttons: t ? t.buttons : null, model, entriesBefore: before, entriesAfterUse: after, toastGoneAfterClick: !st2.toasts.some(r => r.text.includes(text)), screenshots: [s0, s1, await shot('l1r3-1-consent-after-use.png', await cornerClip())] };
}

// L1-1（edit.json の変換）: version 1 の edit.json を置いたプロジェクトを開いた起動で測る（--legacy-dir にそのフォルダ）
async function caseR3Migrate() {
    const dir = arg('legacy-dir');
    const text = 'edit.json version';
    const row = await waitToast(text, 120000);
    const shownAt = await pageNow();
    const id = row.id;
    const s0 = await shot('l1r3-1-migrate-shown.png', await cornerClip(460, 420));
    while ((await pageNow()) < shownAt + 20000) { await sleep(250); }
    const st = await state();
    const t = st.toasts.find(r => r.text.includes(text));
    const s1 = await shot('l1r3-1-migrate-20s.png', await cornerClip(460, 420));
    const model = await page.evaluate(i => ({ phase: window.__tib.nm.life.phase(i), remaining: window.__tib.nm.life.remaining(i), fraction: window.__tib.nm.life.fraction(i) }), id);
    const ringEl = await page.evaluate(i => !!document.querySelector(`.theia-notification-toasts .akari-notification-row[data-message-id="${i}"] .akari-notification-ring`), id);
    const versionBefore = dir ? JSON.parse(fs.readFileSync(path.join(dir, 'edit.json'), 'utf8')).version : null;
    await page.evaluate(text => { const el = Array.from(window.__tibToastRows()).find(e => (e.textContent || '').includes(text)); Array.from(el.querySelectorAll('.akari-notification-button')).find(b => b.textContent === '変換する').click(); }, text);
    await sleep(4000);
    const versionAfter = dir ? JSON.parse(fs.readFileSync(path.join(dir, 'edit.json'), 'utf8')).version : null;
    const st2 = await state();
    results.r3Migrate = { shownAfter20s: !!t, exit: t ? t.exit : null, ringValue: t ? t.ring : null, ringElement: ringEl, buttons: t ? t.buttons : null, model, versionBefore, versionAfter, followUp: st2.toasts.map(r => r.text).filter(x => x.includes('version 2')), screenshots: [s0, s1, await shot('l1r3-1-migrate-after.png', await cornerClip(460, 420))] };
}

// ---- 実行 -------------------------------------------------------------------------------------
const order = [['r3-consent', caseR3Consent], ['r3-migrate', caseR3Migrate], ['1', case1], ['2', case2], ['3', case3], ['4', case4], ['5', case5], ['6', case6], ['7', case7], ['8a', case8a], ['8c', case8c], ['8d', case8d], ['8e', case8e], ['8e-after', case8eAfterRestore], ['8b', case8b], ['9', case9],
    ['r3-center', caseR3Center], ['r3-five', caseR3Five], ['r3-silent', caseR3Silent], ['r3-refade', caseR3Refade], ['r3-history-empty', caseR3HistoryEmpty], ['r3-dot', caseR3Dot]];
await attach();
try {
    const found = await waitReady();
    results.meta = { startedAt: new Date().toISOString(), found, viewport: await viewport(), userAgent: await page.evaluate('navigator.userAgent'), cases: [...CASES] };
    if (fs.existsSync(path.join(OUT, 'l1-results.json')) && argv.includes('--merge')) { Object.assign(results, JSON.parse(fs.readFileSync(path.join(OUT, 'l1-results.json'), 'utf8')), { meta: results.meta }); }
    for (const [name, fn] of order) {
        if (!CASES.has(name)) { continue; }
        log('case', name, 'start');
        try { await fn(); } catch (error) { results['case' + name + 'Error'] = String(error && error.stack || error); log('case', name, 'ERROR', String(error)); }
        save();
        log('case', name, 'done');
    }
} finally {
    save();
    await browser.close();
}
