/*
 * L1 回帰観測 — ライブラリの 2 枚重ねカードが既存の導線を壊していないこと。
 *
 * 前提: run-l1.mjs と同じ隔離環境で Electron を起動し、隔離ワークスペースに
 *       動画 1 本ぶんの edit.json がある（タイムラインが開いている）こと。
 * 使い方: node evidence/library-tile-cards/run-regression.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.CDP_PORT || 9471);
const OUT = process.env.OUT_DIR || dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
    if (m.id != null && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000); });
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');

const rec = { checkedAt: new Date().toISOString() };
async function shot(name, clip) {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    const buf = Buffer.from(r.data, 'base64'); writeFileSync(join(OUT, name), buf);
    if (buf.length > 500 * 1024) console.warn(`[warn] ${name} ${Math.round(buf.length / 1024)}KB`);
}
const panelClip = async () => evaluate(`(() => { const r = document.getElementById('akari-role-buckets-widget').getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
const openLibrary = async () => {
    await evaluate(`(() => { const b = document.querySelector('[data-akari-panel-segment=catalog]');
        if (b.getAttribute('aria-selected') !== 'true') b.click(); })()`);
    await sleep(1200);
    // カテゴリの中にいたらホームへ戻す（タイルはホームにしか無い）
    for (let i = 0; i < 4; i++) {
        if (await evaluate(`!!document.querySelector('[data-akari-library-home]')`)) break;
        await evaluate(`(() => { const b = document.querySelector('[data-akari-library-back]'); if (b) b.click(); })()`);
        await sleep(1200);
    }
};
const backToLibraryHome = async () => { await evaluate(`(() => { const b = document.querySelector('[data-akari-library-back]'); if (b) b.click(); })()`); await sleep(1400); };
const captionCount = () => evaluate(`document.querySelectorAll('[data-akari-item-kind=caption]').length`);
const timelineItems = () => evaluate(`(() => { const out = {};
    document.querySelectorAll('[data-akari-item-kind]').forEach(e => { const k = e.getAttribute('data-akari-item-kind'); out[k] = (out[k] || 0) + 1; });
    return out; })()`);
const clickTile = i => evaluate(`(() => { const t = document.querySelectorAll('.akari-library-tile')[${i}];
    t.scrollIntoView({ block: 'center' }); const disabled = !!t.disabled; t.click();
    return { label: t.querySelector('.akari-library-tile-label').textContent, disabled }; })()`);
const libraryState = () => evaluate(`(() => { const w = document.getElementById('akari-role-buckets-widget');
    return { home: !!document.querySelector('[data-akari-library-home]'),
        catalogCards: w.querySelectorAll('[data-akari-catalog-item]').length,
        crumb: (w.querySelector('[data-akari-library-back]') ? w.querySelector('[data-akari-library-back]').parentElement.innerText : '').replace(/[\\n\\s]+/g, ' ').slice(0, 60) }; })()`);
const focusTimeline = async () => { const r = await evaluate(`document.getElementById('akari-annotations-widget').getBoundingClientRect().toJSON()`);
    const x = Math.round(r.x + r.width * 0.85), y = Math.round(r.y + r.height * 0.88);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(600); };
const cmdZ = async () => { for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, modifiers: 4, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, ...(type === 'keyDown' ? { text: 'z' } : {}) }); };

// ── R1: テキストのタイル → プレイヘッドに文字 → Cmd+Z 1 手で戻る ──
await openLibrary();
await focusTimeline();
const capBefore = await captionCount();
const r1click = await clickTile(0);
await sleep(3000);
const capAfter = await captionCount();
await focusTimeline();
await cmdZ();
await sleep(2500);
const capUndo = await captionCount();
rec.r1_placeTextAndUndo = { clicked: r1click, before: capBefore, afterClick: capAfter, afterUndo: capUndo,
    placed: capAfter === capBefore + 1, undoneInOneStep: capUndo === capBefore };
await shot('20-timeline-after-undo.png', await evaluate(`(() => { const r = document.getElementById('akari-annotations-widget').getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`));

// ── R2: 画像 / BGM は一覧が開く・近日は押せない ──
rec.r2_openLists = {};
for (const [idx, name] of [[3, 'image'], [5, 'bgm']]) {
    await openLibrary();
    const click = await clickTile(idx);
    await sleep(2800);
    const st = await libraryState();
    rec.r2_openLists[name] = { clicked: click, ...st, opened: !st.home && st.catalogCards > 0 };
    if (name === 'bgm') await shot('21-bgm-list.png', await panelClip());
    await backToLibraryHome();
    rec.r2_openLists[name].backHome = (await libraryState()).home;
}
rec.r2_soonTiles = await evaluate(`(() => Array.from(document.querySelectorAll('.akari-library-tile'))
    .filter(t => t.hasAttribute('data-akari-library-soon'))
    .map(t => ({ label: t.querySelector('.akari-library-tile-label').textContent, disabled: !!t.disabled,
                 ariaDisabled: t.getAttribute('aria-disabled') })))()`);
const soonIdx = await evaluate(`Array.from(document.querySelectorAll('.akari-library-tile')).findIndex(t => t.hasAttribute('data-akari-library-soon'))`);
const soonClick = await clickTile(soonIdx);
await sleep(1500);
rec.r2_soonClickKeepsHome = { clicked: soonClick, stillHome: (await libraryState()).home };

// ── R3: BGM カードをタイムラインへ D&D ──
await openLibrary();
await clickTile(5);
await sleep(3000);
const beforeDrop = await timelineItems();
rec.r3_bgmDrop = await evaluate(`(() => {
    const card = document.querySelector('[data-akari-catalog-item][draggable=true]');
    const tl = document.getElementById('akari-annotations-widget');
    if (!card || !tl) return { error: 'card or timeline missing' };
    const r = tl.getBoundingClientRect();
    const x = Math.round(r.x + r.width * 0.35), y = Math.round(r.y + r.height * 0.75);
    const dt = new DataTransfer();
    const mk = type => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y });
    card.dispatchEvent(mk('dragstart'));           // React 側の onDragStart が dt へ setData する
    const payload = dt.getData('application/x-akari-library-item');
    const target = document.elementFromPoint(x, y) || tl;
    target.dispatchEvent(mk('dragenter'));
    target.dispatchEvent(mk('dragover'));
    target.dispatchEvent(mk('drop'));
    card.dispatchEvent(mk('dragend'));
    return { item: card.getAttribute('data-akari-catalog-item'), payload: payload.slice(0, 200), at: { x, y } };
})()`);
await sleep(4000);
const afterDrop = await timelineItems();
rec.r3_bgmDrop.before = beforeDrop;
rec.r3_bgmDrop.after = afterDrop;
rec.r3_bgmDrop.added = JSON.stringify(beforeDrop) !== JSON.stringify(afterDrop);
await shot('22-timeline-after-bgm-drop.png', await evaluate(`(() => { const r = document.getElementById('akari-annotations-widget').getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`));
await backToLibraryHome();

// ── R4: 詳細は「文字の見た目」「マイ」だけ・主要タイルと重複しない ──
await evaluate(`(() => { const b = document.querySelector('[data-akari-library-details-toggle]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
await sleep(1500);
rec.r4_details = await evaluate(`(() => {
    const d = document.querySelector('[data-akari-library-details]');
    if (!d) return { error: 'details not open' };
    const groups = Array.from(d.querySelectorAll('section > div:first-child')).map(e => e.textContent.trim());
    const tileLabels = Array.from(document.querySelectorAll('.akari-library-tile-label')).map(e => e.textContent);
    const rows = Array.from(d.querySelectorAll('[data-akari-library-category], button')).map(e => (e.innerText || '').replace(/[\\n\\s]+/g, ' ').trim()).filter(Boolean);
    return { groups, rows: rows.slice(0, 20), duplicatedWithTiles: rows.filter(r => tileLabels.some(l => l && r === l)) };
})()`);
await evaluate(`(() => { const d = document.querySelector('[data-akari-library-details]'); if (d) d.scrollIntoView({ block: 'end' }); })()`);
await sleep(700);
await shot('23-library-details.png', await panelClip());
await evaluate(`(() => { const b = document.querySelector('[data-akari-library-details-toggle]'); if (b.getAttribute('aria-expanded') === 'true') b.click(); })()`);
await sleep(900);

// ── R5: プロジェクト面（素材カード・「…」メニュー・Lint） ──
await evaluate(`(() => { const b = document.querySelector('[data-akari-panel-segment=materials]'); if (b.getAttribute('aria-selected') !== 'true') b.click(); })()`);
await sleep(1600);
rec.r5_projectFace = await evaluate(`(() => { const w = document.getElementById('akari-role-buckets-widget');
    return { materialCards: w.querySelectorAll('[data-akari-material-path]').length,
        menuButton: !!w.querySelector('[data-akari-materials-menu]'),
        lintText: (Array.from(w.querySelectorAll('button, div')).map(e => (e.innerText || '').trim()).find(t => /^Lint/.test(t)) || '').replace(/[\\n\\s]+/g, ' ') }; })()`);
await evaluate(`(() => { const b = document.querySelector('[data-akari-materials-menu]'); if (b) b.click(); })()`);
await sleep(1200);
rec.r5_projectFace.menuItems = await evaluate(`Array.from(document.querySelectorAll('.lm-Menu-itemLabel, .p-Menu-itemLabel, [class*=menu] [class*=label]')).map(e => e.textContent).filter(Boolean).slice(0, 20)`);
await shot('24-project-face-menu.png', await evaluate(`({ x: 0, y: 0, width: Math.min(window.innerWidth, 640), height: Math.min(window.innerHeight, 700) })`));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(600);
await shot('25-project-face.png', await panelClip());

writeFileSync(join(OUT, 'regression.json'), JSON.stringify(rec, null, 2) + '\n');
console.log(JSON.stringify(rec, null, 1));
ws.close();
