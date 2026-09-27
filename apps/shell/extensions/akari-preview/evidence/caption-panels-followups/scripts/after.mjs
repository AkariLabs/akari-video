#!/usr/bin/env node
// AFTER（L1・受け入れ条件の判定つき）。ラッパー作成の検証スクリプト。
// 手順 0 の撮り直し（1〜4）+ (a) 書体のホバー → Esc → クリック確定 → undo (b) スタイルのホバー (c) 太さのホバー、と一時スタイルの解除。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9633）
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { view } from './view.mjs';
import { OUT, REPO, S, clickSel, hoverSel, key, openProject, paths, shooter, start } from './common.mjs';
import { BAR, FONT_ROWS, HOOK_FLASH, INSPECTOR, MORE, MORE_ITEMS, PANEL, PLATE, POP } from './probes.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [] };
const shot = shooter(p, 'after');
const FIXTURE = await readFile(path.join(p.WORK, 'fixture', 'spoken', 'captions.json'), 'utf8');
const captionsText = () => readFile(path.join(p.PJ, 'captions.json'), 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function check(name, fn) {
    const started = Date.now();
    try { const detail = await fn(); rec.checks.push({ name, pass: true, ms: Date.now() - started, detail }); console.log('PASS', name); }
    catch (error) { rec.checks.push({ name, pass: false, ms: Date.now() - started, error: sanitize(error, REPO) }); console.log('FAIL', name, error.message); }
}
async function waitCaptions(pred, label, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const t = await captionsText(); if (pred(t)) return t; await sleep(150); }
    throw new Error(`${label} not reached`);
}
async function undo(cdp) {
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    await waitCaptions(t => t === FIXTURE, 'undo → captions.json byte-equal fixture');
    await sleep(800);
    return { captionsEqualFixture: (await captionsText()) === FIXTURE };
}
const away = cdp => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
async function pressBar(cdp, k) {
    const hidden = await evalOn(cdp, `(()=>{const n=document.querySelector(${S(`${BAR} [data-akari-bar-item="${k}"]`)});return !n||n.hidden||n.getClientRects().length===0})()`);
    if (hidden) { await clickSel(cdp, `${BAR} [data-akari-bar-item="overflow"]`); await sleep(500); await clickSel(cdp, `${MORE} [data-akari-bar-item="${k}"]`); }
    else await clickSel(cdp, `${BAR} [data-akari-bar-item="${k}"]`);
    return hidden ? 'overflow' : 'bar';
}
async function openPanel(cdp, panel) {
    if ((await evalOn(cdp, PANEL)) === panel) return;
    await clickSel(cdp, `${BAR} [data-akari-bar-item="${panel === 'font' ? 'captionFont' : 'captionStyle'}"]`);
    await waitEval(cdp, `${PANEL}===${S(panel)}`, { label: `${panel} panel`, timeoutMs: 10_000 });
    await sleep(1000);
}
async function scrollInspectorTop(cdp) {
    await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');[root,...root.querySelectorAll('*')].forEach(e=>{if(e.scrollTop)e.scrollTop=0});return true})()`);
    await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-text"]')?.click();return true})()`);
    await sleep(500);
}

await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
let v;
const plate = () => v.eval(PLATE('c-0001'));
async function waitV(expr, { label, timeoutMs = 8000 }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const r = await v.eval(expr).catch(() => null); if (r) return r; await sleep(100); }
    throw new Error(`${label} not reached`);
}
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    v = await view(Number(process.env.CDP_PORT || 9633));
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await sleep(1500);
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(1500);
    rec.plateInitial = await plate();

    await check('2 フォント一覧: 日本語の表示名（その書体・18〜20px）+ 英字名（小さく）/ 日本語でも英字でも検索できる', async () => {
        await openPanel(cdp, 'font');
        await evalOn(cdp, `document.fonts.ready.then(()=>true)`);
        const rows = await evalOn(cdp, `(async()=>{await document.fonts.ready;const loaded=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,''));return ${FONT_ROWS}.map(r=>{const row=document.querySelector('[data-akari-font-row="'+r.id+'"]');const en=row.querySelector('.akari-caption-font-english');return{...r,faceLoaded:loaded.includes(r.nameFont),english:en?.textContent.trim()??null,englishSize:en?getComputedStyle(en).fontSize:null}})})()`);
        const search = {};
        for (const q of ['明朝', 'しっぽり', 'Shippori', 'ゴシック', 'ドット', 'DotGothic', '丸']) {
            await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-font-search]');s.focus();s.value=${S(q)};s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
            await sleep(400);
            search[q] = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-font-row]')].map(r=>r.dataset.akariFontRow)`);
            if (q === '明朝') await shot(cdp, '2-font-search-mincho');
        }
        await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-font-search]');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));s.blur();return true})()`);
        await sleep(500);
        const file = await shot(cdp, '2-font-names');
        const sz = x => parseFloat(x);
        assert(rows.length === 9, `rows ${rows.length}`);
        assert(rows.every(r => r.faceLoaded && sz(r.nameSize) >= 18 && sz(r.nameSize) <= 20 && r.english && sz(r.englishSize) < 14), `rows ${S(rows)}`);
        for (const [id, name] of [['shippori-mincho', 'しっぽり明朝'], ['biz-udgothic', 'BIZ UDゴシック'], ['zen-maru-gothic', 'Zen丸ゴシック'], ['dotgothic16', 'ドットゴシック16'], ['klee-one', 'クレー One']])
            assert(rows.find(r => r.id === id)?.name === name, `${id} name ${rows.find(r => r.id === id)?.name}`);
        assert(search['明朝'].includes('shippori-mincho') && search['しっぽり'].includes('shippori-mincho') && search.Shippori.includes('shippori-mincho'), `search ${S(search)}`);
        assert(search['ゴシック'].length >= 3 && search['ドット'].includes('dotgothic16') && search.DotGothic.includes('dotgothic16') && search['丸'].includes('zen-maru-gothic'), `search ${S(search)}`);
        return { rows, search, shot: file };
    });

    // 観測用: webview で c-0001 の字幕の書体を毎フレーム記録する（確定の瞬間のちらつき検出）
    const FRAME_REC_START = `(()=>{window.__cpfFrames=[];window.__cpfRec=true;const tick=()=>{if(!window.__cpfRec)return;const r=${PLATE('c-0001')};window.__cpfFrames.push(r?r.font.split(',')[0].replace(/"/g,'')+'|'+r.weight:'none');requestAnimationFrame(tick)};requestAnimationFrame(tick);return true})()`;
    const FRAME_REC_STOP = `(()=>{window.__cpfRec=false;const f=window.__cpfFrames;const runs=[];for(const x of f){if(!runs.length||runs.at(-1)[0]!==x)runs.push([x,1]);else runs.at(-1)[1]++}return{frames:f.length,runs}})()`;

    await check('(a-1) 書体のホバー → 出力プレビューの字幕がその書体に（captions.json は不変）', async () => {
        await away(cdp); await sleep(300);
        await hoverSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]');
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&/Dela Gothic One/.test(r.font)?r:null})()`, { label: 'plate font during hover', timeoutMs: 8000 }).catch(() => null) ?? await plate();
        const file = await shot(cdp, 'a1-font-hover');
        const others = await v.eval(`[...document.querySelectorAll('.caption-row-plate')].filter(p=>!p.id.startsWith('caption-plate-c-0001')).map(p=>{const l=p.querySelector('.akari-caption__line');return l?getComputedStyle(l).fontFamily.slice(0,40):null})`);
        assert(/Dela Gothic One/.test(pl?.font ?? ''), `plate ${S(pl)}`);
        assert((await captionsText()) === FIXTURE, 'captions.json changed');
        assert(S(pl.color) === S(rec.plateInitial.color) && pl.bg === rec.plateInitial.bg, 'other style props changed');
        return { plateInitial: rec.plateInitial, plateDuringHover: pl, otherVisiblePlates: others, shot: file };
    });
    await check('(a-2) Esc → 元の書体に戻る（書き込みなし）', async () => {
        await key(cdp, 'Escape', 'Escape', 27);
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&!/Dela Gothic One/.test(r.font)?r:null})()`, { label: 'plate reverted', timeoutMs: 8000 });
        const file = await shot(cdp, 'a2-font-escape');
        assert(S(pl) === S(rec.plateInitial), `plate ${S(pl)} vs ${S(rec.plateInitial)}`);
        assert((await captionsText()) === FIXTURE, 'captions.json changed');
        return { plate: pl, panel: await evalOn(cdp, PANEL), shot: file };
    });
    await check('(a-3) 離れる → 戻る', async () => {
        await hoverSel(cdp, '[data-akari-font-row="shippori-mincho"] [data-akari-panel-sample]');
        const during = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&/Shippori Mincho/.test(r.font)?r:null})()`, { label: 'plate shippori', timeoutMs: 8000 });
        await away(cdp);
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&!/Shippori Mincho/.test(r.font)?r:null})()`, { label: 'plate reverted on leave', timeoutMs: 8000 });
        assert(S(pl) === S(rec.plateInitial), `plate ${S(pl)}`);
        return { during: during.font, after: pl.font };
    });
    await check('(a-4) クリックで確定: 書き込み 1 回（font_family だけ）・確定の瞬間にちらつかない（元の書体のフレーム 0）', async () => {
        await hoverSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]');
        await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&/Dela Gothic One/.test(r.font)})()`, { label: 'hover applied', timeoutMs: 8000 });
        await sleep(300);
        await v.eval(FRAME_REC_START);
        await clickSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]');
        const after = await waitCaptions(t => t !== FIXTURE, 'captions write');
        await sleep(2500);
        await away(cdp); await sleep(1200);
        const frames = await v.eval(FRAME_REC_STOP);
        const before = JSON.parse(FIXTURE).captions.find(c => c.id === 'c-0001');
        const now = JSON.parse(after).captions.find(c => c.id === 'c-0001');
        const changedKeys = Object.keys({ ...before.text_style, ...now.text_style }).filter(k => S(before.text_style?.[k]) !== S(now.text_style?.[k]));
        const othersSame = S(JSON.parse(after).captions.filter(c => c.id !== 'c-0001')) === S(JSON.parse(FIXTURE).captions.filter(c => c.id !== 'c-0001'));
        const pl = await plate();
        const file = await shot(cdp, 'a4-font-click-commit');
        const nonDela = frames.runs.filter(([x]) => !/Dela Gothic One/.test(x));
        assert(S(changedKeys) === S(['font_family']) && now.text_style.font_family === 'Dela Gothic One', `changed ${S(changedKeys)}`);
        assert(othersSame, 'other captions changed');
        assert(/Dela Gothic One/.test(pl?.font ?? ''), `plate ${S(pl)}`);
        assert(frames.frames > 10 && nonDela.length === 0, `frames ${S(frames)}`);
        return { changedKeys, plate: pl, frames, shot: file };
    });
    await check('(a-5) undo 1 回（Cmd+Z）で captions.json が元と byte 一致・プレビューも元の書体', async () => {
        const r = await undo(cdp);
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&!/Dela Gothic One/.test(r.font)?r:null})()`, { label: 'plate after undo', timeoutMs: 8000 });
        const file = await shot(cdp, 'a5-font-undo');
        assert(r.captionsEqualFixture && S(pl) === S(rec.plateInitial), `${S(r)} ${S(pl)}`);
        return { ...r, plate: pl, shot: file };
    });

    await check('(c) 太さのホバー（BIZ UDゴシック 400）→ プレビューの字幕がその書体・太さに（書き込みなし）→ 離れると戻る', async () => {
        await openPanel(cdp, 'font');
        const expanded = await evalOn(cdp, `document.querySelectorAll('[data-akari-font-row="biz-udgothic"] [data-akari-font-weight]').length`);
        if (!expanded) { await clickSel(cdp, '[data-akari-font-row="biz-udgothic"] button'); await sleep(700); }
        await hoverSel(cdp, '[data-akari-font-row="biz-udgothic"] [data-akari-font-weight="400"]');
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&/BIZ UDGothic/.test(r.font)&&r.weight==='400'?r:null})()`, { label: 'weight hover', timeoutMs: 8000 }).catch(() => null) ?? await plate();
        const file = await shot(cdp, 'c-weight-hover');
        assert(/BIZ UDGothic/.test(pl?.font ?? '') && pl.weight === '400', `plate ${S(pl)}`);
        assert((await captionsText()) === FIXTURE, 'captions.json changed');
        await away(cdp);
        const back = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&!/BIZ UDGothic/.test(r.font)?r:null})()`, { label: 'weight revert', timeoutMs: 8000 });
        assert(S(back) === S(rec.plateInitial), `back ${S(back)}`);
        return { plateDuringHover: pl, plateAfterLeave: back, shot: file };
    });

    await check('(b) スタイルのホバー → 色・座布団がプレビューに出る（書き込みなし）→ 離れると戻る', async () => {
        await openPanel(cdp, 'style');
        await hoverSel(cdp, '[data-akari-style-card="subtitle-news"]');
        const pl = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&r.bg!==${S(rec.plateInitial.bg)}?r:null})()`, { label: 'style hover', timeoutMs: 8000 }).catch(() => null) ?? await plate();
        const file = await shot(cdp, 'b-style-hover');
        assert(pl && pl.color !== rec.plateInitial.color && pl.bg !== rec.plateInitial.bg && pl.bg !== 'rgba(0, 0, 0, 0)', `plate ${S(pl)}`);
        assert((await captionsText()) === FIXTURE, 'captions.json changed');
        await away(cdp);
        const back = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&r.bg===${S(rec.plateInitial.bg)}?r:null})()`, { label: 'style revert', timeoutMs: 8000 });
        assert(S(back) === S(rec.plateInitial), `back ${S(back)}`);
        return { plateDuringHover: pl, plateAfterLeave: back, shot: file };
    });
    await check('解除: ホバー中にパネルを閉じる / 選択を変える → 一時スタイルが外れる', async () => {
        await hoverSel(cdp, '[data-akari-style-card="subtitle-news"]');
        await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&r.bg!==${S(rec.plateInitial.bg)}})()`, { label: 'style hover 2', timeoutMs: 8000 });
        await evalOn(cdp, command('akari.captionPanel.close'));
        const closed = await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&r.bg===${S(rec.plateInitial.bg)}?r:null})()`, { label: 'revert on close', timeoutMs: 8000 });
        await away(cdp);
        await openPanel(cdp, 'font');
        await hoverSel(cdp, '[data-akari-font-row="klee-one"] [data-akari-panel-sample]');
        await waitV(`(()=>{const r=${PLATE('c-0001')};return r&&/Klee One/.test(r.font)})()`, { label: 'klee hover', timeoutMs: 8000 });
        // マウスを動かさずに選択だけ変える（タイムラインの選択 API = 利用者のクリックと同じ通知経路）
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0002"]');
        await sleep(1500);
        const sel = await plate();
        const s2 = await v.eval(PLATE('c-0002'));
        assert(S(closed) === S(rec.plateInitial), `closed ${S(closed)}`);
        assert(!/Klee One/.test(sel?.font ?? '') && !/Klee One/.test(s2?.font ?? ''), `after select change c1=${S(sel)} c2=${S(s2)}`);
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'); await sleep(1500);
        const back = await plate();
        assert(S(back) === S(rec.plateInitial), `c-0001 after reselect ${S(back)}`);
        return { afterClose: closed, afterSelectionChange: { c0001: sel, c0002: s2 }, c0001AfterReselect: back };
    });
    await evalOn(cdp, command('akari.captionPanel.close')); await sleep(600); await away(cdp);

    await check('3 「…」の中: アイコン + 名前・オンの項目に印・名前が切れない', async () => {
        const first = await (async () => { await clickSel(cdp, `${BAR} [data-akari-bar-item="overflow"]`); await sleep(700); return evalOn(cdp, MORE_ITEMS); })();
        const file = await shot(cdp, '3-overflow-open');
        await key(cdp, 'Escape', 'Escape', 27); await sleep(400);
        // 箇条書き（「…」の中）をオンにしてから開き直す
        await pressBar(cdp, 'captionBullet');
        await waitCaptions(t => t !== FIXTURE, 'bullet write');
        await sleep(1000);
        await clickSel(cdp, `${BAR} [data-akari-bar-item="overflow"]`); await sleep(700);
        const on = await evalOn(cdp, MORE_ITEMS);
        const onMark = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(`${MORE} [data-akari-bar-item="captionBullet"]`)});const c=b.querySelector('.akari-ctx-caption-overflow-check');return{check:c?.textContent??null,cls:b.className,color:getComputedStyle(b).color,bg:getComputedStyle(b).backgroundColor}})()`);
        const offMark = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(`${MORE} [data-akari-bar-item="captionVertical"]`)});const c=b.querySelector('.akari-ctx-caption-overflow-check');return{check:c?.textContent??null,cls:b.className,color:getComputedStyle(b).color,bg:getComputedStyle(b).backgroundColor}})()`);
        const file2 = await shot(cdp, '3-overflow-pressed');
        await key(cdp, 'Escape', 'Escape', 27); await sleep(400);
        const u = await undo(cdp);
        const names = Object.fromEntries(first.items.map(i => [i.key, i.visibleText]));
        const want = { captionBullet: '箇条書き', captionSpacing: '間隔', captionVertical: '縦書き', captionOpacity: '透明度', captionEffect: 'エフェクト', captionAnimation: 'アニメーション' };
        for (const [k, n] of Object.entries(want)) if (k in names) assert(names[k].includes(n), `${k}: ${names[k]}`);
        assert(first.items.length >= 6, `items ${first.items.length}`);
        assert(first.items.every(i => i.label && !i.label.clipped && i.icon && !i.icon.overflows && !i.icon.overlapsLabel && i.icon.text !== i.label.text), `items ${S(first.items)}`);
        assert(onMark.check === '✓' && !offMark.check, `marks on=${S(onMark)} off=${S(offMark)}`);
        assert(u.captionsEqualFixture, 'undo');
        return { items: first.items, pressedItems: on.items.map(i => ({ key: i.key, pressed: i.pressed })), onMark, offMark, shots: [file, file2] };
    });

    const expectDest = { effect: { tab: 'tab:inspector-text', section: 'style:effect' }, animation: { tab: 'tab:inspector-motion', section: ['animator', 'motion-empty'] }, 'more-settings': { tab: 'tab:inspector-text', section: 'style' } };
    async function dest(label, withPanel, press) {
        if (withPanel) await openPanel(cdp, 'font'); else { await evalOn(cdp, command('akari.captionPanel.close')); await sleep(300); await scrollInspectorTop(cdp); }
        await evalOn(cdp, HOOK_FLASH);
        const via = await press();
        await sleep(1500);
        const st = await evalOn(cdp, INSPECTOR);
        const file = await shot(cdp, `4-${label}${withPanel ? '-from-font-panel' : ''}`);
        const want = expectDest[label];
        const ids = [want.section].flat();
        const sec = st.sections.find(s => ids.includes(s.id));
        const flashed = st.log.some(x => ids.some(id => x.ui === `section:inspector-${id}`) || (ids.includes('style') && x.ui === 'caption-style'));
        assert(st.panel === null, `panel ${st.panel}`);
        assert(st.tab === want.tab, `tab ${st.tab}`);
        assert(sec && sec.open !== false && sec.visiblePx >= Math.min(sec.h, 60), `section ${S(sec)}`);
        assert(flashed, `flash ${S(st.log)}`);
        return { via, tab: st.tab, section: sec, flash: st.log, visible: st.sections.filter(s => s.visiblePx > 0).map(s => s.id), shot: file };
    }
    for (const withPanel of [false, true]) {
        await check(`4 エフェクト → 「効果」欄${withPanel ? '（フォントパネルが開いているとき → 閉じて移る）' : ''}`, () => dest('effect', withPanel, () => pressBar(cdp, 'captionEffect')));
        await check(`4 アニメーション → 動きの欄${withPanel ? '（フォントパネルが開いているとき）' : ''}`, () => dest('animation', withPanel, () => pressBar(cdp, 'captionAnimation')));
        await check(`4 設定をもっと見る → 「文字」欄${withPanel ? '（フォントパネルが開いているとき）' : ''}`, () => dest('more-settings', withPanel, async () => {
            await pressBar(cdp, 'captionSpacing'); await sleep(600);
            await clickSel(cdp, `${POP} [data-caption-inspector]`);
            return 'spacing-window';
        }));
    }
    rec.captionsFinalEqualFixture = (await captionsText()) === FIXTURE;
    rec.status = rec.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    v?.close();
    await stop(session);
    await writeFile(path.join(OUT, 'results-after.json'), `${S(rec, null, 2).replaceAll(p.WORK, '<work>')}\n`);
}
console.log(S({ status: rec.status, pass: rec.checks.filter(c => c.pass).length, total: rec.checks.length, error: rec.error }));
