/*
 * L1 実機観測 — ライブラリの 2 枚重ねカード。
 *
 * 使い方（apps/shell を `npm run build` 済みにしてから）:
 *   1. 隔離ワークスペース（templates/project-default のコピー）を用意して Electron を直接起動する。
 *      ELECTRON_RUN_AS_NODE が環境に残っていると electron が Node として起動して
 *      `requestSingleInstanceLock` で落ちるので、`env -u ELECTRON_RUN_AS_NODE` で外すこと。
 *
 *      env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR=<隔離config> \
 *        node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *        <apps/shell の絶対パス> <隔離ワークスペースの絶対パス> \
 *        --remote-debugging-port=9471 --user-data-dir=<隔離userdata> --no-sandbox
 *
 *   2. node evidence/library-tile-cards/run-l1.mjs
 *      （CDP_PORT / OUT_DIR / TILE_INDEX を環境変数で差し替えられる）
 *
 * playwright は入れない。Node 22+ の global WebSocket で CDP を直接叩く。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.CDP_PORT || 9471);
const OUT = process.env.OUT_DIR || dirname(fileURLToPath(import.meta.url));
const TILE = Number(process.env.TILE_INDEX || 3); // 画像
mkdirSync(OUT, { recursive: true });

// ── 最小 CDP クライアント ───────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
if (!page) throw new Error('CDP に page ターゲットがありません。Electron が起動しているか確認してください。');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id != null && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 30000);
});
const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result.value;
};

await send('Runtime.enable'); await send('Page.enable'); await send('Animation.enable');

const record = { capturedAt: new Date().toISOString(), shots: {} };
async function shot(name, clip, scale = 1) {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale } });
    const buf = Buffer.from(r.data, 'base64');
    writeFileSync(join(OUT, name), buf);
    record.shots[name] = { bytes: buf.length, kb: Math.round(buf.length / 1024), clip, scale };
    if (buf.length > 500 * 1024) console.warn(`[warn] ${name} が 500KB を超えています (${Math.round(buf.length / 1024)}KB)`);
    return buf.length;
}
const moveMouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
const panelRect = () => evaluate(`document.getElementById('akari-role-buckets-widget').getBoundingClientRect().toJSON()`);
const panelClip = async () => { const r = await panelRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; };

async function setPanelWidth(want) {
    for (let i = 0; i < 8; i++) {
        const info = await evaluate(`(() => {
            const split = document.getElementById('theia-left-right-split-panel');
            const h = Array.from(split.children).find(e => e.classList.contains('lm-SplitPanel-handle'));
            const hr = h.getBoundingClientRect();
            return { hx: hr.x + hr.width / 2, hy: hr.y + hr.height / 2,
                     width: document.getElementById('akari-role-buckets-widget').getBoundingClientRect().width };
        })()`);
        const d = want - info.width;
        if (Math.abs(d) < 1) return info.width;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.hx, y: info.hy, button: 'left', buttons: 1, clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.hx + d / 2, y: info.hy, button: 'left', buttons: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.hx + d, y: info.hy, button: 'left', buttons: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.hx + d, y: info.hy, button: 'left', buttons: 0, clickCount: 1 });
        await sleep(340);
    }
    return (await panelRect()).width;
}

const DECOMPOSE = `(m => { const p = m.replace(/matrix\\(|\\)/g, '').split(',').map(Number);
    if (p.length !== 6) return { raw: m };
    return { raw: m, deg: +(Math.atan2(p[1], p[0]) * 180 / Math.PI).toFixed(3),
             scale: +Math.hypot(p[0], p[1]).toFixed(4), tx: +p[4].toFixed(3), ty: +p[5].toFixed(3) }; })`;

const readTile = idx => evaluate(`(() => {
    const d = ${DECOMPOSE};
    const tile = document.querySelectorAll('.akari-library-tile')[${idx}];
    const info = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        return { transform: d(cs.transform), transitionProperty: cs.transitionProperty,
                 transitionDuration: cs.transitionDuration, transitionTimingFunction: cs.transitionTimingFunction,
                 box: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
                        cx: +(r.x + r.width / 2).toFixed(2), cy: +(r.y + r.height / 2).toFixed(2) } }; };
    const art = tile.querySelector('.akari-library-tile-art').getBoundingClientRect();
    return { label: tile.querySelector('.akari-library-tile-label').textContent,
             art: { w: +art.width.toFixed(2), h: +art.height.toFixed(2) },
             back: info(tile.querySelector('.akari-tile-back')),
             front: info(tile.querySelector('.akari-tile-front')) };
})()`);

const quickTransform = idx => evaluate(`(() => { const d = ${DECOMPOSE};
    const t = document.querySelectorAll('.akari-library-tile')[${idx}];
    return { back: d(getComputedStyle(t.querySelector('.akari-tile-back')).transform),
             front: d(getComputedStyle(t.querySelector('.akari-tile-front')).transform) }; })()`);

const tileCenter = idx => evaluate(`(() => { const r = document.querySelectorAll('.akari-library-tile')[${idx}].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const tileClip = async (idx, pad = 8) => evaluate(`(() => {
    const t = document.querySelectorAll('.akari-library-tile')[${idx}];
    t.scrollIntoView({ block: 'center' });
    const r = t.getBoundingClientRect();
    return { x: Math.floor(r.x - ${pad}), y: Math.floor(r.y - ${pad}), width: Math.ceil(r.width + ${pad} * 2), height: Math.ceil(r.height + ${pad} * 2) };
})()`);

// ── 0. ライブラリ面を開く ───────────────────────────────
await evaluate(`(() => { const b = document.querySelector('[data-akari-panel-segment=catalog]');
    if (b && b.getAttribute('aria-selected') !== 'true') b.click(); })()`);
await sleep(900);
await moveMouse(2, 2); await sleep(400);
record.defaultPanelWidth = (await panelRect()).width;

// ── 1. 構造（タイル数・並び・区切り・見出し・台座・SVG id） ──
record.structure = await evaluate(`(() => {
    const section = document.querySelector('[data-akari-library-primary-tiles]');
    const tiles = Array.from(document.querySelectorAll('.akari-library-tile'));
    const labels = tiles.map(t => t.querySelector('.akari-library-tile-label').textContent);
    const rules = Array.from(document.querySelectorAll('[data-akari-library-tile-rule]'));
    const home = document.querySelector('[data-akari-library-home]');
    return {
        tileCount: tiles.length,
        labels,
        categories: tiles.map(t => t.getAttribute('data-akari-library-category') || t.getAttribute('data-akari-library-tile-kind')),
        platesPerTile: tiles.map(t => t.querySelectorAll('.akari-library-tile-plate').length),
        backPerTile: tiles.map(t => t.querySelectorAll('.akari-tile-back').length),
        frontPerTile: tiles.map(t => t.querySelectorAll('.akari-tile-front').length),
        plateCountTotal: document.querySelectorAll('.akari-library-tile-plate').length,
        ruleCount: rules.length,
        ruleTextChars: rules.reduce((n, r) => n + r.textContent.replace(/\\s+/g, '').length, 0),
        headingChars: section.textContent.replace(/\\s+/g, '').length - labels.join('').replace(/\\s+/g, '').length,
        svgIdDuplicates: tiles.map((t, i) => { const ids = Array.from(t.querySelectorAll('svg [id], svg[id]')).map(e => e.id);
            return { label: labels[i], idCount: ids.length, duplicates: [...new Set(ids.filter((v, k) => ids.indexOf(v) !== k))] }; }),
        soon: tiles.filter(t => t.hasAttribute('data-akari-library-soon')).map(t => t.getAttribute('data-akari-library-category')),
        disabledCount: tiles.filter(t => t.disabled).length,
        horizontalScroll: { scrollWidth: home.scrollWidth, clientWidth: home.clientWidth, overflowX: home.scrollWidth > home.clientWidth + 1 }
    };
})()`);

// ── 2. 見た目の宣言値（モックとの突き合わせ用） ──────────
record.computed = await evaluate(`(() => {
    const p = (el, keys) => Object.fromEntries(keys.map(k => [k, getComputedStyle(el)[k]]));
    const home = document.querySelector('[data-akari-library-home]');
    const tile = document.querySelectorAll('.akari-library-tile')[${TILE}];
    const back = tile.querySelector('.akari-tile-back');
    return {
        home: p(home, ['padding']),
        grid: p(tile.parentElement, ['display', 'gridTemplateColumns', 'gap']),
        tile: p(tile, ['padding', 'gap', 'borderRadius']),
        art: p(tile.querySelector('.akari-library-tile-art'), ['width', 'aspectRatio']),
        plate: p(back, ['borderRadius', 'backgroundImage', 'boxShadow', 'filter', 'transformOrigin', 'overflow']),
        label: p(tile.querySelector('.akari-library-tile-label'), ['fontSize', 'fontWeight', 'lineHeight', 'whiteSpace', 'textOverflow', 'overflow']),
        rule: p(document.querySelector('[data-akari-library-tile-rule]'), ['height', 'margin']),
        soonArt: p(Array.from(document.querySelectorAll('.akari-library-tile'))
            .find(t => t.hasAttribute('data-akari-library-soon')).querySelector('.akari-library-tile-art'), ['opacity', 'filter'])
    };
})()`);

// ── 3. 既定幅の全景 ─────────────────────────────────────
const vp = await evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
await shot('00-window-default.png', { x: 0, y: 0, width: vp.w, height: vp.h }, 0.7); // 1 枚 500KB 以下に収める
await shot('01-library-home-default.png', await panelClip());

// ── 4. 幅 164px ─────────────────────────────────────────
record.width164 = { requested: 164, actual: await setPanelWidth(164) };
await sleep(400);
record.width164.labels = await evaluate(`(() => {
    const home = document.querySelector('[data-akari-library-home]');
    return { scrollWidth: home.scrollWidth, clientWidth: home.clientWidth, overflowX: home.scrollWidth > home.clientWidth + 1,
        labels: Array.from(document.querySelectorAll('.akari-library-tile')).map(t => {
            const l = t.querySelector('.akari-library-tile-label'), cs = getComputedStyle(l);
            const r = l.getBoundingClientRect(), tr = t.getBoundingClientRect();
            return { label: l.textContent, lines: Math.round(r.height / parseFloat(cs.lineHeight)),
                ellipsized: l.scrollWidth > l.clientWidth + 1,
                withinTile: r.left >= tr.left - 0.5 && r.right <= tr.right + 0.5 }; }) };
})()`);
await shot('06-width-164.png', await panelClip());

// ── 5. 幅 400px（モックが示す幅。ここで絵とカードを検分する） ──
record.width400 = { requested: 400, actual: await setPanelWidth(400) };
await sleep(400);
record.width400.layout = await evaluate(`(() => {
    const home = document.querySelector('[data-akari-library-home]');
    const labels = Array.from(document.querySelectorAll('.akari-library-tile-label'));
    return { scrollWidth: home.scrollWidth, clientWidth: home.clientWidth, overflowX: home.scrollWidth > home.clientWidth + 1,
        artWidth: +document.querySelector('.akari-library-tile-art').getBoundingClientRect().width.toFixed(2),
        ellipsized: labels.filter(l => l.scrollWidth > l.clientWidth + 1).map(l => l.textContent),
        wrapped: labels.filter(l => Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)) > 1).map(l => l.textContent) };
})()`);
await shot('07-width-400.png', await panelClip());
await shot('10-tiles-400.png', await evaluate(`(() => { const r = document.querySelector('[data-akari-library-primary-tiles]').getBoundingClientRect();
    return { x: Math.floor(r.x - 2), y: Math.floor(r.y - 2), width: Math.ceil(r.width + 4), height: Math.ceil(Math.min(r.height + 4, window.innerHeight - r.y)) }; })()`));

// ── 6. タイル 1 枚: 平常 → 開く途中 → 開いた状態 ──────────
await moveMouse(2, 2); await sleep(600);
const clip = await tileClip(TILE);
record.normal = await readTile(TILE);
await shot('02-tile-normal.png', clip, 4);

// 開く途中は CSS トランジションを 1/10 の速さで流して決定論に掴む
await send('Animation.setPlaybackRate', { playbackRate: 0.1 });
const center = await tileCenter(TILE);
await moveMouse(center.x, center.y);
await sleep(1000); // 実時間 1000ms = アニメ時間 100ms（= 進行 31%）
record.opening = { before: await quickTransform(TILE) };
await shot('03-tile-opening.png', clip, 4);
record.opening.after = await quickTransform(TILE);
await sleep(700);
record.openingLate = { before: await quickTransform(TILE) };
await shot('03b-tile-opening-late.png', clip, 4);
record.openingLate.after = await quickTransform(TILE);
await send('Animation.setPlaybackRate', { playbackRate: 1 });
await sleep(700);

record.hover = await readTile(TILE);
await shot('04-tile-hover.png', clip, 4);
record.backSink = {
    normalCy: record.normal.back.box.cy, hoverCy: record.hover.back.box.cy,
    deltaY: +(record.hover.back.box.cy - record.normal.back.box.cy).toFixed(2),
    artHeight: record.normal.art.h
};
await shot('05-library-home-hover.png', await panelClip());

// ── 7. 近日タイルはホバーに反応しない ──────────────────
await moveMouse(2, 2); await sleep(500);
const soonIdx = await evaluate(`Array.from(document.querySelectorAll('.akari-library-tile')).findIndex(t => t.hasAttribute('data-akari-library-soon'))`);
const soonClip = await tileClip(soonIdx);
const soonCenter = await tileCenter(soonIdx);
await moveMouse(soonCenter.x, soonCenter.y); await sleep(700);
record.soonHover = await readTile(soonIdx);
await shot('11-soon-hover.png', soonClip, 4);
await moveMouse(2, 2); await sleep(400);

// ── 8. 絵の検分（音符・エフェクト等を拡大して撮る） ─────
for (const [idx, name] of [[0, 'text'], [5, 'bgm'], [6, 'sfx'], [11, 'fx'], [12, 'motion']]) {
    await shot(`09-art-${name}.png`, await tileClip(idx, 4), 4);
}

// ── 9. prefers-reduced-motion: reduce ───────────────────
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(400);
record.reducedMotion = await readTile(TILE);
await tileClip(TILE); // 画面内へ戻してから座標を取り直す
const c2 = await tileCenter(TILE);
await moveMouse(c2.x + 1, c2.y + 1);
await moveMouse(c2.x, c2.y);
await sleep(450); // transition は 0.01ms なので、この時点で開き切っているはず
record.reducedMotionHover = await readTile(TILE);
await shot('08-reduced-motion.png', await panelClip());
await send('Emulation.setEmulatedMedia', { features: [] });
await moveMouse(2, 2); await sleep(300);

await setPanelWidth(record.defaultPanelWidth);
writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(record, null, 2) + '\n');
console.log('OK', Object.keys(record.shots).length, 'shots');
ws.close();
