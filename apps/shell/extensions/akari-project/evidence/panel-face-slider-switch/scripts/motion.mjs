// つまみのモーションを実測する。
// 1) 静止時の computed transition（property / duration / timing-function）
// 2) 実クリックでプロジェクト → ライブラリ、rAF ごとに computed transform を記録し、途中フレームのスクショを 1 枚以上残す
// 3) 左右キー（ArrowLeft / ArrowRight）で面が切り替わりフォーカスが移ること
// 4) prefers-reduced-motion: reduce をエミュレートすると transition が none になり、切り替えが即時（途中値なし）になること
// 5) Page.reload（パネルの再生成）直後・別プロジェクトを開き直した直後に、つまみが滑らずに正しい位置に出ること（ライブラリ面を開いた状態で左パネルの開閉も）
// 6) 回帰: 検索欄・カテゴリ一覧・素材カード（プロジェクト面）
// usage: CDP_PORT=9434 node motion.mjs ; writes ../motion.json と ../motion-*.png
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
const PORT = Number(process.env.CDP_PORT || 9434);
let cdp = await connectMain(PORT);
const out = {};
const shot = async (name, full = false) => {
    const clip = full ? undefined : await evalMain(cdp, `(() => { const r = document.querySelector('[role="tablist"][aria-label="素材パネルの表示"]').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16, scale: 2 }; })()`);
    const { data } = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' }, 20000);
    writeFileSync(new URL(`../${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
};
const THUMB = `document.querySelector('[data-akari-panel-segment-thumb]')`;
const state = () => evalMain(cdp, `(() => { const t = ${THUMB}; const cs = getComputedStyle(t); const m = new DOMMatrix(cs.transform); return { topView: document.querySelector('[data-akari-top-view]').getAttribute('data-akari-top-view'), tx: +m.m41.toFixed(3), width: +t.getBoundingClientRect().width.toFixed(3), inline: t.style.transform, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, transitionTimingFunction: cs.transitionTimingFunction, labelTransition: getComputedStyle(document.querySelector('[data-akari-panel-segment]')).transition, focused: document.activeElement?.getAttribute('data-akari-panel-segment') ?? null }; })()`);
const center = view => evalMain(cdp, `(() => { const r = document.querySelector('[data-akari-panel-segment="${view}"]').getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, hit: document.elementFromPoint(x, y)?.getAttribute('data-akari-panel-segment') ?? document.elementFromPoint(x, y)?.tagName }; })()`);
const hits = [];
// 実マウスでタブを押す（毎回その場で中心を測り、当たり判定の要素も記録する）
const clickView = async view => { const c = await center(view); hits.push({ view, ...c }); await realClick(cdp, c.x, c.y); };
// rAF ごとに transform を記録するサンプラ（ms, tx）を window に仕込む
const startSampler = ms => evalMain(cdp, `(() => { const s = window.__pfss = { t0: performance.now(), samples: [] }; const tick = () => { const t = ${THUMB}; if (t) { const m = new DOMMatrix(getComputedStyle(t).transform); s.samples.push([+(performance.now() - s.t0).toFixed(1), +m.m41.toFixed(2)]); } if (performance.now() - s.t0 < ${ms}) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
const samples = () => evalMain(cdp, `window.__pfss?.samples ?? []`);
const summarize = (arr, from, to) => {
    const mids = arr.filter(([, x]) => Math.abs(x - from) > 0.5 && Math.abs(x - to) > 0.5);
    const firstAtEnd = arr.find(([, x]) => Math.abs(x - to) <= 0.5);
    const firstMove = arr.find(([, x]) => Math.abs(x - from) > 0.5);
    return { frames: arr.length, intermediateFrames: mids.length, firstMoveMs: firstMove?.[0] ?? null, settledMs: firstAtEnd?.[0] ?? null, observedSpanMs: firstMove && firstAtEnd ? +(firstAtEnd[0] - firstMove[0]).toFixed(1) : null };
};

// 準備: プロジェクト面から
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="materials"]').click()`);
await sleep(600);
out.restMaterials = await state();
await shot('motion-0-rest-materials');

// 2) 実クリック + 途中フレーム
await startSampler(700);
await clickView('catalog');
await sleep(90);
const midState = await state();
await shot('motion-1-mid-slide');
await sleep(700);
out.clickToLibrary = { mid: midState, end: await state(), samples: await samples() };
out.clickToLibrary.summary = summarize(out.clickToLibrary.samples, 0, out.clickToLibrary.end.tx);
await shot('motion-2-rest-library');

// 戻り（途中フレームをもう 1 枚）
await startSampler(700);
await clickView('materials');
await sleep(60);
await shot('motion-3-mid-slide-back');
await sleep(700);
out.clickToProject = { end: await state(), samples: await samples() };
out.clickToProject.summary = summarize(out.clickToProject.samples, out.clickToLibrary.end.tx, 0);

// 3) キーボード
const key = async k => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'ArrowRight' ? 39 : 37 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'ArrowRight' ? 39 : 37 });
    await sleep(600);
    return state();
};
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="materials"]').focus()`);
out.keyboard = { start: await state(), afterRight: await key('ArrowRight'), afterLeft: await key('ArrowLeft') };
out.keyboard.focusRing = await evalMain(cdp, `(() => { const b = document.activeElement; return { view: b?.getAttribute('data-akari-panel-segment'), outline: getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineWidth + ' ' + getComputedStyle(b).outlineColor, focusVisible: b?.matches(':focus-visible') }; })()`);
await key('ArrowRight');
await shot('motion-4-keyboard-focus');
await key('ArrowLeft');

// 4) reduced-motion
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(300);
const reducedRest = await state();
await startSampler(500);
await clickView('catalog');
await sleep(600);
out.reducedMotion = { rest: reducedRest, end: await state(), samples: await samples() };
out.reducedMotion.summary = summarize(out.reducedMotion.samples, 0, out.reducedMotion.end.tx);
await clickView('materials');
await sleep(400);
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await sleep(300);
out.reducedMotion.restoredAfterClear = await state();

// 5) 初回フレーム: ライブラリ面で左パネルを畳んで開き直す（ウィジェットは同一インスタンス）
await clickView('catalog');
await sleep(600);
const filesIcon = await evalMain(cdp, `(() => { const el = [...document.querySelectorAll('.codicon-files')].find(e => e.getBoundingClientRect().width > 0); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await realClick(cdp, filesIcon.x, filesIcon.y); // 畳む
await sleep(600);
await startSampler(1200);
await realClick(cdp, filesIcon.x, filesIcon.y); // 開く
await sleep(1300);
const reopenEnd = await state();
out.panelReopenOnLibrary = { end: reopenEnd, samples: await samples() };
out.panelReopenOnLibrary.summary = { ...summarize(out.panelReopenOnLibrary.samples, 0, reopenEnd.tx), distinctTx: [...new Set(out.panelReopenOnLibrary.samples.map(s => s[1]))] };

// 5b) Page.reload（ウィジェット再生成）/ 別プロジェクトを開き直す: 新しい文書の先頭からサンプラを仕込む
const INJECT = `(() => { const s = window.__pfss = { t0: performance.now(), samples: [] }; const tick = () => { const t = document.querySelector('[data-akari-panel-segment-thumb]'); if (t && t.getBoundingClientRect().width > 0) { const m = new DOMMatrix(getComputedStyle(t).transform); s.samples.push([+(performance.now() - s.t0).toFixed(1), +m.m41.toFixed(2), getComputedStyle(t).transitionDuration]); } if (performance.now() - s.t0 < 30000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`;
const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
const reloadCase = async (name, action) => {
    // 開き直す前にライブラリ面にしておく（面が保持される場合でも滑らないことを見る）
    await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="catalog"]').click()`);
    await sleep(600);
    out[name + 'Before'] = await state();
    const origin = await evalMain(cdp, `(() => { if (window.__pfss) window.__pfss.samples = []; window.__pfssStale = true; return performance.timeOrigin; })()`);
    await action();
    await sleep(3000);
    for (let i = 0; i < 60; i++) {
        const ok = await evalMain(cdp, `(() => { const b = document.querySelector('[data-akari-panel-segment]'); return !!b && b.getBoundingClientRect().width > 0; })()`).catch(() => false);
        if (ok) break;
        await sleep(1000);
    }
    await sleep(1500);
    const end = await state();
    const arr = await samples();
    const newDoc = await evalMain(cdp, `({ timeOrigin: performance.timeOrigin, stale: !!window.__pfssStale })`);
    out[name] = { newDocument: newDoc.timeOrigin !== origin && !newDoc.stale, end, firstSample: arr[0] ?? null, frames: arr.length, distinctTx: [...new Set(arr.map(s => s[1]))], firstFrameTransition: arr[0]?.[2] ?? null };
    await shot(`motion-5-${name}`);
};
await reloadCase('afterReload', () => cdp.send('Page.reload', {}).catch(() => {}));
// 別プロジェクトを開き直す: クエリを変えた URL へ遷移（ハッシュだけの変更は同一文書のまま）。一時ディレクトリの ws2 → 戻りで ws
const reopenTo = ws => reloadCase(`afterReopenProject_${ws}`, async () => {
    const href = await evalMain(cdp, 'location.href');
    const u = new URL(href); u.searchParams.set('pfss', String(Date.now())); u.hash = join(process.env.PFSS_WORKSPACE_ROOT || join(tmpdir(), 'pfss-l1'), ws);
    await cdp.send('Page.navigate', { url: u.toString() }).catch(() => {});
});
await reopenTo('ws2');
out.afterReopenProject_ws2.url = await evalMain(cdp, 'location.href');
await reopenTo('ws');
out.afterReopenProject_ws.url = await evalMain(cdp, 'location.href');
await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});

// 6) 回帰
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="catalog"]').click()`);
await sleep(800);
out.regression = {};
out.regression.catalogHome = await evalMain(cdp, `(() => ({ search: document.querySelector('[data-akari-panel-search]')?.getAttribute('data-akari-panel-search'), placeholder: document.querySelector('[data-akari-panel-search]')?.placeholder, categories: document.querySelectorAll('button[data-akari-library-category]').length, catalogControls: document.querySelector('[data-akari-catalog-controls]')?.getAttribute('data-akari-catalog-controls') }))()`);
const searchBox = await evalMain(cdp, `(() => { const r = document.querySelector('[data-akari-panel-search]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await realClick(cdp, searchBox.x, searchBox.y);
await cdp.send('Input.insertText', { text: 'bgm' });
await sleep(1200);
out.regression.catalogSearch = await evalMain(cdp, `(() => ({ value: document.querySelector('[data-akari-panel-search]').value, resultRows: document.querySelectorAll('[data-akari-library-home] button, [data-akari-catalog-item], [data-akari-library-search-result]').length, bodyHasResults: /件/.test(document.getElementById('akari-role-buckets-widget').innerText) }))()`);
await shot('motion-6-regression-catalog-search', true);
await evalMain(cdp, `(() => { const i = document.querySelector('[data-akari-panel-search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(500);
await evalMain(cdp, `document.querySelector('[data-akari-panel-segment="materials"]').click()`);
await sleep(800);
out.regression.materials = await evalMain(cdp, `(() => ({ search: document.querySelector('[data-akari-panel-search]')?.getAttribute('data-akari-panel-search'), placeholder: document.querySelector('[data-akari-panel-search]')?.placeholder, materialCards: document.querySelectorAll('[data-akari-material-path]').length, text: document.getElementById('akari-role-buckets-widget').innerText.slice(0, 200) }))()`);
await shot('motion-6-regression-materials', true);

out.clickHits = hits;
writeFileSync(new URL('../motion.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
const brief = { ...out };
for (const k of ['clickToLibrary', 'clickToProject', 'reducedMotion', 'panelReopenOnLibrary']) brief[k] = { ...out[k], samples: undefined };
console.log(JSON.stringify(brief, null, 1));
cdp.close();
process.exit(0);
