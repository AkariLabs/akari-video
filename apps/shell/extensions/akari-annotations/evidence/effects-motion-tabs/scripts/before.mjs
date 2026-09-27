#!/usr/bin/env node
// 手順 0（BEFORE・判定なし）。ラッパー作成の検証スクリプト。基点のビルドで実行する。
// 編集パネルのテキストタブ（効果）・動きタブ（袋あり / なし）・置いた文字のスクリーンショットと、
// テキストタブ / 動きタブ / ライブラリのテキスト系のページ（テキストスタイル・テキストアニメ）を開いてからの表示時間（+ CPU プロファイル）。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node before.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9636）
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, openProject, paths, selectCaption, shooter, start } from './common.mjs';
import { measure } from './timing.mjs';

const WORK = process.argv[2];
const rec = { phase: 'before', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), obs: {}, timing: {} };
async function observe(name, fn) {
    try { rec.obs[name] = await fn(); console.log('OK', name); }
    catch (error) { rec.obs[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
async function time(name, spec, trigger, opts) {
    try { rec.timing[name] = await measure(cdp, spec, trigger, opts); console.log('TIME', name, S({ first: rec.timing[name].firstCardVisibleMs, all: rec.timing[name].allSettledMs, final: rec.timing[name].final })); }
    catch (error) { rec.timing[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
const INSPECTOR_ROOT = '[data-akari-ui="panel:inspector"]';
const SECTIONS = { rootSel: INSPECTOR_ROOT, cardSel: '[data-akari-ui^="section:inspector-"]', readyBody: `return !!c.querySelector('.akari-inspector-section-body, [data-inspector-field], select, input')` };
const LIB = kind => ({ cardSel: `[data-akari-catalog-preset-item^="${kind}/"]`, readyBody: `const t=c.querySelector('[data-akari-preset-sample-text]')||c.querySelector('img,canvas');if(!t)return false;if(t.tagName==='IMG')return t.complete&&t.naturalWidth>0;const r=t.getBoundingClientRect();if(!(r.width>0))return false;const fam=getComputedStyle(t).fontFamily.split(',')[0].replace(/["']/g,'').trim();return [...document.fonts].filter(f=>f.family.replace(/["']/g,'')===fam).every(f=>f.status!=='loading')` });
const INSPECTOR_STATE = `(()=>{const root=document.querySelector(${S(INSPECTOR_ROOT)});if(!root)return null;return{tab:root.querySelector('.akari-inspector-tab.is-active')?.getAttribute('data-akari-ui')??null,dom:root.getElementsByTagName('*').length,sections:[...root.querySelectorAll('[data-akari-ui^="section:inspector-"]')].filter(s=>s.getClientRects().length).map(s=>({id:s.getAttribute('data-akari-ui').slice(18),text:s.innerText.replace(/\\s+/g,' ').slice(0,400)})),selects:[...root.querySelectorAll('select')].filter(s=>s.getClientRects().length).map(s=>({name:s.closest('[data-inspector-field]')?.getAttribute('data-inspector-field')??s.name,options:[...s.options].map(o=>o.textContent.trim())}))}})()`;
const scrollTo = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return false;e.scrollIntoView({block:'start'});return true})()`;
const openCatalog = category => command('akari.catalog.open', { category });

let session, cdp;
const shot = shooter(paths(WORK, 'bag'), 'before');
try {
    // ---- 袋あり
    const p = paths(WORK, 'bag');
    session = await start(p); cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await selectCaption(cdp, 'c-0001');
    await dismissToasts(cdp);
    await observe('text-tab-caption', async () => {
        await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-text"]')?.click();return true})()`); await sleep(800);
        const top = await shot(cdp, '01-text-tab-top');
        await evalOn(cdp, scrollTo('[data-akari-ui="section:inspector-style:effect"]')); await sleep(600);
        return { state: await evalOn(cdp, INSPECTOR_STATE), shots: [top, await shot(cdp, '02-text-tab-effect')] };
    });
    // 効果ごとに欄がどう出るか（c-0001〜c-0005 = 影 / 浮き出し / ネオン / 袋文字 / なし）
    await observe('effect-per-caption', async () => {
        const out = {};
        for (const id of ['c-0001', 'c-0002', 'c-0003', 'c-0004', 'c-0005']) {
            await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${id}"]`); await sleep(1200);
            out[id] = await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-style:effect"]');return s?s.innerText.replace(/\\s+/g,' '):null})()`);
        }
        await evalOn(cdp, scrollTo('[data-akari-ui="section:inspector-style:effect"]')); await sleep(400);
        out.shot = await shot(cdp, '03-effect-neon-none');
        return out;
    });
    await observe('motion-tab-bag', async () => {
        await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1000);
        const a = await shot(cdp, '04-motion-tab-bag');
        const state = await evalOn(cdp, INSPECTOR_STATE);
        // アニメーターを 1 つ足したときの欄（select の最初の選択肢）
        const added = await evalOn(cdp, `(()=>{const root=document.querySelector(${S(INSPECTOR_ROOT)});const s=[...root.querySelectorAll('select')].find(s=>s.getClientRects().length);if(!s)return null;return [...s.options].map(o=>o.value)})()`);
        return { state, animatorOptions: added, shots: [a] };
    });
    // 袋を選んだとき（登場 / 強調 / 退場）
    await observe('bag-selected', async () => {
        const bag = await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-item-id="captions"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+6,y:r.top+r.height/2,cls:e.className}})()`);
        return { bagChip: bag };
    });

    // ---- 時間の実測（袋あり・c-0001 選択中）
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'); await sleep(1500);
    await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-motion"]')?.click();return true})()`); await sleep(1500);
    await time('inspector-text-tab-click', SECTIONS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-text"]'), { profile: true });
    await time('inspector-motion-tab-click', SECTIONS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'));
    await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-text"]')?.click();return true})()`); await sleep(1500);
    await time('inspector-select-caption-text-tab', SECTIONS, async () => clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0003"]'));
    await time('library-textstyle-cold', LIB('textstyle'), async now => { await now(); await evalOn(cdp, openCatalog('textstyle')); }, { profile: true });
    await observe('library-textstyle', async () => ({ cards: await evalOn(cdp, `document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]').length`), fonts: await evalOn(cdp, `[...document.fonts].map(f=>f.family+':'+f.status).length`), shot: await shot(cdp, '05-library-textstyle') }));
    await time('library-textanim-cold', LIB('textanim'), async now => { await now(); await evalOn(cdp, openCatalog('textanim')); }, { profile: true });
    await observe('library-textanim', async () => ({ cards: await evalOn(cdp, `document.querySelectorAll('[data-akari-catalog-preset-item^="textanim/"]').length`), shot: await shot(cdp, '06-library-textanim') }));
    await time('library-textstyle-warm', LIB('textstyle'), async now => { await now(); await evalOn(cdp, openCatalog('textstyle')); });
    await time('library-textanim-warm', LIB('textanim'), async now => { await now(); await evalOn(cdp, openCatalog('textanim')); });

    // 置いた文字
    await observe('placed-text', async () => {
        await evalOn(cdp, command('akari.caption.placeText', { start: 4, end: 7, text: '置いた文字' })); await sleep(2500);
        const ids = await evalOn(cdp, `[...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].map(e=>e.dataset.akariItemId)`);
        const placed = ids.find(id => !/^c-000[1-5]$/.test(id) && id !== 'captions');
        if (placed) { await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${placed}"]`); await sleep(1500); }
        await evalOn(cdp, `(()=>{document.querySelector('[data-akari-ui="tab:inspector-text"]')?.click();return true})()`); await sleep(800);
        await evalOn(cdp, scrollTo('[data-akari-ui="section:inspector-style:effect"]')); await sleep(500);
        const a = await shot(cdp, '07-placed-text-effect');
        await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1000);
        return { ids, placed, motion: await evalOn(cdp, INSPECTOR_STATE), shots: [a, await shot(cdp, '08-placed-text-motion')] };
    });
    await stop(session); session = null;

    // ---- 袋なし
    const q = paths(WORK, 'nobag');
    session = await start(q); cdp = session.cdp;
    await openProject(session, q.PJ, 1);
    await observe('motion-tab-nobag', async () => {
        await selectCaption(cdp, 'c-0001'); await dismissToasts(cdp);
        await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1000);
        return { state: await evalOn(cdp, INSPECTOR_STATE), shot: await shot(cdp, '09-motion-tab-nobag') };
    });
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, 'results-before.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error }));
