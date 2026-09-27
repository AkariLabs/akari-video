#!/usr/bin/env node
// 差し戻し r1 の追加検証（ラッパー作成の検証スクリプト。変更後のビルドで実行する）。
// 1. ライブラリのテキストスタイル / テキストアニメのページ: 左の欄を畳んでから開き直して最初のカードまで（各 3 回）・
//    畳んだ欄から戻るときの activateWidget の所要時間・開いた後のフォーカス・検索欄の日本語入力 / 矢印キー
//    （ウィジェットを閉じると左の欄の隣のタブ「設定」が選ばれて設定のダイアログが開き、画面全体が inert になるので、閉じずに畳む）
// 2. 見た目の粗 4 点: アニメーターの説明文の折り返し / 見本の領域のクリップ / 強調の対象語チップ / 見本の周期の頭と終わりの静止
// 3. 語ごとの表示・強調の書き込みが undo 1 回で戻るか（実測するだけ）
// 判定は results-r1.json の checks。使い方: node gen-fixture.mjs <作業用>/fixture && node r1.mjs <作業用ディレクトリ（実体パス）>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, openProject, paths, selectCaption, start, waitEval } from './common.mjs';
import { measure } from './timing.mjs';

const WORK = process.argv[2];
const rec = { phase: 'r1', obs: {}, checks: {} };
const check = (name, ok, detail) => { rec.checks[name] = { ok: !!ok, ...(detail === undefined ? {} : { detail }) }; console.log(ok ? 'PASS' : 'FAIL', name); };
async function observe(name, fn) {
    try { rec.obs[name] = await fn(); console.log('OK', name); }
    catch (error) { rec.obs[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
const LIB_ID = 'akari-role-buckets-widget';
const MOTION = '[data-akari-ui="section:inspector-motion:caption"]';
const ANIMATOR = '[data-akari-ui="section:inspector-animator"]';
const LIB = kind => ({ cardSel: `[data-akari-catalog-preset-item^="${kind}/"]`, readyBody: `const t=c.querySelector('[data-akari-preset-sample-text]')||c.querySelector('img,canvas');if(!t)return false;if(t.tagName==='IMG')return t.complete&&t.naturalWidth>0;const r=t.getBoundingClientRect();return r.width>0` });
const SHELL = `(()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.activateWidget==='function'&&typeof k.prototype?.closeWidget==='function'&&typeof k.prototype?.getWidgetById==='function');return window.theia.container.get(K)})()`;
const FOCUS = `(()=>{const a=document.activeElement;const w=document.getElementById(${S(LIB_ID)});return{tag:a?.tagName||null,type:a?.getAttribute?.('type')||null,inLibrary:!!(w&&a&&w.contains(a)),value:a?.value??null}})()`;
const tab = id => `(()=>{document.querySelector('[data-akari-ui="tab:inspector-${id}"]')?.click();return true})()`;
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
async function shotClip(cdp, sel, name, pad = 6) {
    const r = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return{x:b.left,y:b.top,w:b.width,h:b.height}})()`);
    if (!r) return null;
    await sleep(300);
    const r2 = await evalOn(cdp, `(()=>{const b=document.querySelector(${S(sel)}).getBoundingClientRect();return{x:b.left,y:b.top,w:b.width,h:b.height}})()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r2.x - pad), y: Math.max(0, r2.y - pad), width: r2.w + pad * 2, height: r2.h + pad * 2, scale: 2 } });
    await writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
    return name;
}

let session, cdp;
try {
    const p = paths(WORK, 'bag');
    session = await start(p); cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    await dismissToasts(cdp);

    // ---- 1. ライブラリのテキスト系のページ
    const runs = { textstyle: [], textanim: [] };
    for (let i = 0; i < 3; i++) {
        for (const kind of ['textstyle', 'textanim']) {
            await evalOn(cdp, `(async()=>{const s=${SHELL};await s.collapsePanel('left');return true})()`);
            await sleep(1500);
            const t = await measure(cdp, LIB(kind), async now => { await now(); await evalOn(cdp, command('akari.catalog.open', { category: kind })); });
            const focus = await evalOn(cdp, FOCUS);
            runs[kind].push({ firstCardVisibleMs: t.firstCardVisibleMs, allSettledMs: t.allSettledMs, cards: t.final?.n ?? null, focus });
            console.log('TIME', kind, i + 1, t.firstCardVisibleMs, t.allSettledMs);
        }
    }
    rec.obs.libraryCold = runs;
    for (const kind of ['textstyle', 'textanim']) {
        check(`library ${kind}: 畳んだ欄から開き直して最初のカードまで 300ms 以内（3 回とも）`, runs[kind].every(r => r.firstCardVisibleMs !== null && r.firstCardVisibleMs <= 300), runs[kind].map(r => r.firstCardVisibleMs));
        check(`library ${kind}: 開いた後のフォーカスはライブラリの検索欄`, runs[kind].every(r => r.focus.inLibrary && r.focus.tag === 'INPUT'), runs[kind].map(r => r.focus));
    }
    // 畳んだ欄から戻る（activateWidget の所要時間。基点は activationTimeout 2000ms まで待つ）
    await observe('library-reactivate', async () => {
        const out = [];
        for (let i = 0; i < 3; i++) {
            await evalOn(cdp, `(async()=>{const s=${SHELL};await s.collapsePanel('left');return true})()`); await sleep(1200);
            out.push(await evalOn(cdp, `(async()=>{const s=${SHELL};const t0=performance.now();await s.activateWidget(${S(LIB_ID)});return Math.round((performance.now()-t0)*10)/10})()`));
        }
        check('library: 畳んだ欄から戻る activateWidget が 300ms 以内（3 回とも・activationTimeout 待ちなし）', out.every(ms => ms < 300), out);
        return out;
    });
    // 検索欄: 日本語入力（変換中に再度 activate されても変換が切れない）・矢印キー
    await observe('library-search-keys', async () => {
        await evalOn(cdp, `(async()=>{const s=${SHELL};await s.activateWidget(${S(LIB_ID)});return true})()`); await sleep(500);
        const before = await evalOn(cdp, FOCUS);
        const errors = [];
        await cdp.send('Runtime.enable');
        const onErr = e => errors.push(e.exceptionDetails?.exception?.description?.slice(0, 160) ?? 'exception');
        cdp.on?.('Runtime.exceptionThrown', onErr);
        await cdp.send('Input.imeSetComposition', { text: 'てすと', selectionStart: 3, selectionEnd: 3 });
        await sleep(200);
        const composing = await evalOn(cdp, FOCUS);
        await evalOn(cdp, `(async()=>{const s=${SHELL};await s.activateWidget(${S(LIB_ID)});return true})()`); await sleep(300);
        const afterActivate = await evalOn(cdp, FOCUS);
        await cdp.send('Input.insertText', { text: 'テスト' }); await sleep(600);
        const committed = await evalOn(cdp, FOCUS);
        // 1 行の入力欄なので ArrowUp = 先頭（0）→ ArrowDown = 末尾（3）→ ArrowLeft = 2 がブラウザ標準の動き
        for (const [key, code, keyCode] of [['ArrowUp', 'ArrowUp', 38], ['ArrowDown', 'ArrowDown', 40], ['ArrowLeft', 'ArrowLeft', 37]]) {
            await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode });
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
            await sleep(150);
        }
        const afterArrows = await evalOn(cdp, `(()=>{const a=document.activeElement;return{tag:a?.tagName,value:a?.value??null,caret:a?.selectionStart??null}})()`);
        check('library 検索欄: 変換中に activate されても日本語入力が 1 回だけ確定する', before.inLibrary && committed.inLibrary && committed.value === 'テスト', { before, composing, afterActivate, committed });
        const view = await evalOn(cdp, `document.querySelector('#${LIB_ID} [data-akari-catalog-controls]')?'catalog':'other'`);
        check('library 検索欄: 矢印キーで検索欄の値とフォーカスが保たれ、カーソルだけが動く（表示は切り替わらない）', afterArrows.tag === 'INPUT' && afterArrows.value === 'テスト' && afterArrows.caret === 2 && view === 'catalog', { afterArrows, view });
        // 後片付け（検索語を消す）
        await evalOn(cdp, `(()=>{const a=document.activeElement;if(a?.tagName!=='INPUT')return false;a.select();return true})()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        // 素材 / カタログの切り替え（role=tablist）: 押したボタンのフォーカスが onActivateRequest で検索欄へ奪われない
        const SEG = v => `#${LIB_ID} [data-akari-panel-segment="${v}"]`;
        await clickSel(cdp, SEG('catalog')); await sleep(500);
        const segBefore = await evalOn(cdp, `(()=>{const a=document.activeElement;return{seg:a?.dataset?.akariPanelSegment||null,catalog:!!document.querySelector('#${LIB_ID} [data-akari-catalog-controls]')}})()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
        await sleep(600);
        const segAfter = await evalOn(cdp, `(()=>{const a=document.activeElement;return{seg:a?.dataset?.akariPanelSegment||null,catalog:!!document.querySelector('#${LIB_ID} [data-akari-catalog-controls]')}})()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
        await sleep(600);
        const segBack = await evalOn(cdp, `(()=>{const a=document.activeElement;return{seg:a?.dataset?.akariPanelSegment||null,catalog:!!document.querySelector('#${LIB_ID} [data-akari-catalog-controls]')}})()`);
        check('library 切り替えのボタン: 押した後のフォーカスが検索欄へ奪われず、左右キーの後もボタンに残る', segBefore.seg === 'catalog' && segAfter.seg && segBack.seg, { segBefore, segAfter, segBack });
        // 参考（判定しない）: タイムラインが見えている間は ArrowLeft / ArrowRight が「1 コマ戻る / 進む」のキーバインド
        // （akari-shortcuts.ts・document の capture で先に取る）になるため、切り替えの tablist までキーが届かない。基点から同じ・本票の差分と無関係
        rec.obs.segmentArrowSwitches = { left: segAfter.seg === 'materials', right: segBack.seg === 'catalog' };
        return { composing, afterActivate, committed, afterArrows, segBefore, segAfter, segBack, errors };
    });

    // ---- 2. 見た目の粗 4 点（編集パネルの動きタブ）
    rec.obs.inertBeforeVisual = await evalOn(cdp, `document.getElementById('theia-app-shell').inert`);
    await evalOn(cdp, `(async()=>{const s=${SHELL};await s.collapsePanel('left');return true})()`); await sleep(800);
    await selectCaption(cdp, 'c-0001'); await dismissToasts(cdp);
    await evalOn(cdp, tab('motion')); await sleep(1500);
    await observe('sample-hold', async () => {
        // 周期の頭と終わりの静止: 見本のキーフレームの 0% と 100% が見える状態（opacity 1）か
        const frames = await evalOn(cdp, `[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-card')})].map(c=>{const s=c.querySelector('.akari-caption-motion-sample');const a=s?.getAnimations()[0];const k=a?.effect?.getKeyframes?.()||[];const op=o=>{const f=k.filter(x=>x.offset===o&&x.opacity!==undefined);return f.length?f.map(x=>Number(x.opacity)):null};const fades=k.some(x=>x.opacity!==undefined&&Number(x.opacity)<.2);return{kind:c.dataset.motionKind,id:c.dataset.motionId,name:a?.animationName||null,fades,start:op(0),end:op(1)}})`);
        const fading = frames.filter(f => f.fades);
        check('見本: フェードで始まる見本も周期の頭と終わりは見える状態で止まる', fading.length > 0 && fading.every(f => (f.start ?? [1]).every(v => v >= .99) && (f.end ?? [1]).every(v => v >= .99)), { fading: fading.length, bad: fading.filter(f => !((f.start ?? [1]).every(v => v >= .99) && (f.end ?? [1]).every(v => v >= .99))) });
        // 5 回の瞬間に、表示範囲の見本のうち見えている（opacity > .5）割合
        const moments = [];
        for (let i = 0; i < 5; i++) {
            moments.push(await evalOn(cdp, `(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<innerHeight};const s=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-sample')})].filter(vis);const shown=s.filter(e=>Number(getComputedStyle(e).opacity)>.5).length;return{shown,total:s.length}})()`));
            await sleep(270);
        }
        // 参考値（判定しない）: 周期の 5 割で動くので、動いている途中の見本は薄い瞬間がある。周期をずらしてあるので一斉には空にならない
        rec.obs.sampleVisibleMoments = moments;
        const shot = await shotClip(cdp, MOTION, 'r1-motion-samples.png', 0);
        return { frames: frames.slice(0, 60), moments, shot };
    });
    await observe('sample-clip', async () => {
        const state = await evalOn(cdp, `[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-card')})].filter(c=>/回転|スピン|くるっと/.test(c.textContent)).map(c=>{const s=c.querySelector('.akari-caption-motion-sample');const f=s?.parentElement;const fr=f.getBoundingClientRect(),cr=c.getBoundingClientRect();return{id:c.dataset.motionId,label:c.textContent.trim(),frameClass:f.className,overflow:getComputedStyle(f).overflow,frameInsideCard:fr.left>=cr.left-.5&&fr.right<=cr.right+.5&&fr.top>=cr.top-.5&&fr.bottom<=cr.bottom+.5}})`);
        const all = await evalOn(cdp, `[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-sample')})].every(s=>s.parentElement?.classList.contains('akari-caption-motion-sample-frame')&&getComputedStyle(s.parentElement).overflow==='hidden')`);
        check('見本: 回転などの見本はカードの見本の領域でクリップされる（全カードの見本の枠が overflow: hidden）', state.length > 0 && all && state.every(s => s.overflow === 'hidden' && s.frameInsideCard), state);
        const sel = state[0] ? `${MOTION} .akari-caption-motion-card[data-motion-id="${state[0].id}"]` : null;
        return { state, all, shot: sel ? await shotClip(cdp, sel, 'r1-clip-rotate.png', 24) : null };
    });
    await observe('emphasis-chips', async () => {
        const WORDS = `${MOTION} .akari-caption-motion-words`;
        await evalOn(cdp, `(()=>{document.querySelector(${S(WORDS)})?.scrollIntoView({block:'center'});return true})()`); await sleep(400);
        const n = await evalOn(cdp, `document.querySelectorAll(${S(WORDS + ' button')}).length`);
        if (n > 1) await clickSel(cdp, `${WORDS} button:nth-child(2)`);
        await sleep(600);
        const chips = await evalOn(cdp, `[...document.querySelectorAll(${S(WORDS + ' button')})].map(b=>{const cs=getComputedStyle(b);return{text:b.textContent.trim(),pressed:b.getAttribute('aria-pressed'),border:cs.borderTopWidth+' '+cs.borderTopStyle+' '+cs.borderTopColor,radius:cs.borderTopLeftRadius,bg:cs.backgroundColor,color:cs.color,padding:cs.padding}})`);
        const on = chips.filter(c => c.pressed === 'true'), off = chips.filter(c => c.pressed !== 'true');
        const visible = c => parseFloat(c.border) > 0 && !/none/.test(c.border) && !/rgba\(0, 0, 0, 0\)|transparent/.test(c.bg);
        check('強調の対象語チップ: 枠と背景があり、選択中は背景と文字色が変わる', chips.length > 1 && chips.every(visible) && on.length === 1 && off.every(c => c.bg !== on[0].bg && c.color !== on[0].color), chips);
        return { chips, shot: await shotClip(cdp, WORDS, 'r1-emphasis-chips.png', 8) };
    });
    await observe('animator-explain', async () => {
        const open = await evalOn(cdp, `document.querySelector(${S(ANIMATOR + ' .akari-inspector-section-toggle')})?.getAttribute('aria-expanded')`);
        if (open !== 'true') await clickSel(cdp, `${ANIMATOR} .akari-inspector-section-toggle`);
        await sleep(1000);
        const EXPLAIN = `${ANIMATOR} .akari-inspector-animator-explain`;
        const state = await evalOn(cdp, `(()=>{const row=document.querySelector(${S(EXPLAIN)});if(!row)return null;const l=row.querySelector('.akari-inspector-row-label')||row;const sec=document.querySelector(${S(ANIMATOR)}).getBoundingClientRect();const r=l.getBoundingClientRect();const cs=getComputedStyle(l);return{text:l.innerText.trim(),scrollW:l.scrollWidth,clientW:l.clientWidth,width:Math.round(r.width),sectionWidth:Math.round(sec.width),whiteSpace:cs.whiteSpace,textOverflow:cs.textOverflow}})()`);
        check('アニメーター: 平易な説明が全幅の説明文で最後まで読める（切れない）', !!state && state.text === '文字を 1 文字 / 1 語ずつずらして動かす仕組みです' && state.scrollW <= state.clientW + 1 && state.whiteSpace !== 'nowrap' && state.width >= state.sectionWidth * .6, state);
        return { state, shot: await shotClip(cdp, ANIMATOR, 'r1-animator-explain.png', 4) };
    });

    // ---- 3. 語ごとの表示・強調の undo（実測するだけ）
    await selectCaption(cdp, 'c-0001'); await evalOn(cdp, tab('motion')); await sleep(1200);
    await observe('word-style-emphasis-undo', async () => {
        const read = async () => readJson(path.join(p.PJ, 'captions.json'));
        const card = (k, id) => `${MOTION} .akari-caption-motion-card[data-motion-kind="${k}"][data-motion-id="${id}"]`;
        const r0 = await read();
        await clickSel(cdp, card('word-style', 'karaoke')); await sleep(2500);
        const r1 = await read();
        await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
        const r2 = await read();
        await clickSel(cdp, card('emphasis', 'size-pulse')); await sleep(2500);
        const r3 = await read();
        await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
        const r4 = await read();
        const out = {
            wordStyle: { before: r0.captions[0].style ?? null, written: r1.captions[0].style ?? null, afterUndo: r2.captions[0].style ?? null },
            emphasis: { before: (r0.emphasis_words ?? []).length, written: (r3.emphasis_words ?? []).length, afterUndo: (r4.emphasis_words ?? []).length }
        };
        rec.undoReverts = { wordStyle: out.wordStyle.afterUndo === out.wordStyle.before, emphasis: out.emphasis.afterUndo === out.emphasis.before };
        return out;
    });
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    const failed = Object.entries(rec.checks).filter(([, c]) => !c.ok).map(([k]) => k);
    rec.summary = { checks: Object.keys(rec.checks).length, failed };
    await writeFile(path.join(OUT, 'results-r1.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, summary: rec.summary, undo: rec.undoReverts }));
