#!/usr/bin/env node
// 手順 0（BEFORE・判定なし）。ラッパー作成の検証スクリプト。基点のビルドで実行する。
// 1 ホバーで出力プレビューの字幕が変わるか 2 フォント名 3 「…」の中身 4 エフェクト / アニメーション / 設定をもっと見る の行き先
// 使い方: node gen-fixture.mjs <作業用>/fixture && node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9633）
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { view } from './view.mjs';
import { OUT, REPO, S, clickSel, hoverSel, key, openProject, paths, shooter, start } from './common.mjs';
import { BAR, FONT_ROWS, HOOK_FLASH, INSPECTOR, MORE, MORE_ITEMS, PANEL, PLATE, POP } from './probes.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), obs: {} };
const shot = shooter(p, 'before');
const captionsText = () => readFile(path.join(p.PJ, 'captions.json'), 'utf8');
async function observe(name, fn) {
    try { rec.obs[name] = await fn(); console.log('OK', name); }
    catch (error) { rec.obs[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
async function scrollInspectorTop(cdp) {
    await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-ui="panel:inspector"]');[...root.querySelectorAll('*')].forEach(e=>{if(e.scrollTop)e.scrollTop=0});root.scrollTop=0;return true})()`);
    await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-text"]')?.click();return true})()`);
    await sleep(500);
}
async function pressBar(cdp, key) {
    const hidden = await evalOn(cdp, `(()=>{const n=document.querySelector(${S(`${BAR} [data-akari-bar-item="${key}"]`)});return !n||n.hidden||n.getClientRects().length===0})()`);
    if (hidden) { await clickSel(cdp, `${BAR} [data-akari-bar-item="overflow"]`); await sleep(500); await clickSel(cdp, `${MORE} [data-akari-bar-item="${key}"]`); }
    else await clickSel(cdp, `${BAR} [data-akari-bar-item="${key}"]`);
    return hidden ? 'overflow' : 'bar';
}
async function destination(cdp, name, press) {
    await evalOn(cdp, HOOK_FLASH);
    const before = await evalOn(cdp, INSPECTOR);
    const via = await press();
    await sleep(250);
    const soon = await evalOn(cdp, INSPECTOR);
    await sleep(1200);
    const after = await evalOn(cdp, INSPECTOR);
    const file = await shot(cdp, name);
    return { via, before: { panel: before.panel, tab: before.tab, visible: before.sections.filter(s => s.visiblePx > 0).map(s => s.id) }, soon: { flash: soon.flash }, after, shot: file };
}

await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
let v;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await evalOn(cdp, `(()=>{window.__ev=[];window.addEventListener('akari-caption-panel-preview',e=>window.__ev.push(e.detail));return true})()`);
    v = await view(Number(process.env.CDP_PORT || 9633));
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await sleep(1500);
    await evalOn(cdp, command('akari.inspector.open'));
    await sleep(1500);
    rec.plateInitial = await v.eval(PLATE('c-0001'));

    // 2 フォント名（バーの「フォント」→ パネル）
    await observe('2-font-names', async () => {
        await clickSel(cdp, `${BAR} [data-akari-bar-item="captionFont"]`);
        await waitEval(cdp, `${PANEL}==='font'`, { label: 'font panel', timeoutMs: 10_000 });
        await sleep(1500);
        const rows = await evalOn(cdp, FONT_ROWS);
        const search = {};
        for (const q of ['明朝', 'しっぽり', 'Shippori', 'ゴシック']) {
            await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-font-search]');s.focus();s.value=${S(q)};s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
            await sleep(400);
            search[q] = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-font-row]')].map(r=>r.dataset.akariFontRow)`);
        }
        await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-font-search]');s.value='';s.dispatchEvent(new Event('input',{bubbles:true}));s.blur();return true})()`);
        await sleep(400);
        return { rows, search, shot: await shot(cdp, '2-font-names') };
    });
    // 1 ホバー（書体）→ プレビューの字幕
    await observe('1-hover-font', async () => {
        await evalOn(cdp, `(()=>{window.__ev=[];return true})()`);
        await hoverSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]');
        await sleep(1500);
        const plate = await v.eval(PLATE('c-0001'));
        const ev = await evalOn(cdp, 'window.__ev');
        const r = { events: ev, plateInitial: rec.plateInitial, plateDuringHover: plate, plateChanged: S(plate) !== S(rec.plateInitial), captionsUnchanged: (await captionsText()) === (await readFile(path.join(p.WORK, 'fixture', 'spoken', 'captions.json'), 'utf8')), shot: await shot(cdp, '1-hover-font') };
        await key(cdp, 'Escape', 'Escape', 27); await sleep(500);
        return r;
    });
    // 1 ホバー（スタイル）
    await observe('1-hover-style', async () => {
        await clickSel(cdp, `${BAR} [data-akari-bar-item="captionStyle"]`);
        await waitEval(cdp, `${PANEL}==='style'`, { label: 'style panel', timeoutMs: 10_000 });
        await sleep(1200);
        await evalOn(cdp, `(()=>{window.__ev=[];return true})()`);
        await hoverSel(cdp, '[data-akari-style-card="subtitle-news"]');
        await sleep(1500);
        const r = { events: await evalOn(cdp, 'window.__ev'), plateDuringHover: await v.eval(PLATE('c-0001')), shot: await shot(cdp, '1-hover-style') };
        r.plateChanged = S(r.plateDuringHover) !== S(rec.plateInitial);
        await key(cdp, 'Escape', 'Escape', 27); await sleep(500);
        await evalOn(cdp, command('akari.captionPanel.close')); await sleep(800);
        return r;
    });
    // 3 「…」の中身
    await observe('3-overflow', async () => {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
        const barKeys = await evalOn(cdp, `[...document.querySelectorAll(${S(`${BAR} [data-akari-bar-item]`)})].filter(n=>!n.hidden&&n.getClientRects().length).map(n=>n.getAttribute('data-akari-bar-item'))`);
        await clickSel(cdp, `${BAR} [data-akari-bar-item="overflow"]`);
        await sleep(700);
        const more = await evalOn(cdp, MORE_ITEMS);
        const r = { barKeys, more, shot: await shot(cdp, '3-overflow-open') };
        await key(cdp, 'Escape', 'Escape', 27); await sleep(500);
        return r;
    });
    // 4 行き先
    for (const [k, label] of [['captionEffect', 'effect'], ['captionAnimation', 'animation']]) {
        await observe(`4-${label}`, async () => {
            await scrollInspectorTop(cdp);
            return destination(cdp, `4-${label}`, () => pressBar(cdp, k));
        });
        await observe(`4-${label}-with-font-panel`, async () => {
            await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="panel:inspector"]')&&0;return true})()`);
            await clickSel(cdp, `${BAR} [data-akari-bar-item="captionFont"]`);
            await waitEval(cdp, `${PANEL}==='font'`, { label: 'font panel', timeoutMs: 10_000 });
            await sleep(800);
            const r = await destination(cdp, `4-${label}-with-font-panel`, () => pressBar(cdp, k));
            await evalOn(cdp, command('akari.captionPanel.close')); await sleep(600);
            return r;
        });
    }
    await observe('4-more-settings', async () => {
        await scrollInspectorTop(cdp);
        return destination(cdp, '4-more-settings', async () => {
            await pressBar(cdp, 'captionSpacing');
            await sleep(600);
            await clickSel(cdp, `${POP} [data-caption-inspector]`);
            return 'spacing-window';
        });
    });
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    v?.close();
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2).replaceAll(p.WORK, '<work>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
