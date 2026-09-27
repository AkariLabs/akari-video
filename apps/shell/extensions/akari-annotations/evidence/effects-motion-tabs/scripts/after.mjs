#!/usr/bin/env node
// 手順 5（AFTER）。ラッパー作成の検証スクリプト。変更後のビルドで実行する。
// 効果のカード（21 種・市松の画像・既存 5 種の判定・調整欄の出し分け・ホバー / Esc / 確定 / undo）、
// 動きタブの各段（常に動く見本・見えているカードだけ動く・組 / 登場・強調・退場 / テキストアニメ / 語ごとの表示 / 強調・
// カラオケの設定・プレビューでの 1 回再生・タイプライターのキャレット）、アニメーターのひな形、袋なし、
// 開いてからカードが出揃うまでの時間（BEFORE と同じ測り方）を記録する。判定は results-after.json の checks。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9636）
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, REPO, S, clickSel, dismissToasts, hoverSel, key, openProject, paths, selectCaption, shooter, start, waitEval } from './common.mjs';
import { measure } from './timing.mjs';
import { view } from './view.mjs';
import { EFFECT_STYLES } from './gen-fixture.mjs';

const WORK = process.argv[2];
const rec = { phase: 'after', head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), obs: {}, timing: {}, checks: {} };
const check = (name, ok, detail) => { rec.checks[name] = { ok: !!ok, ...(detail === undefined ? {} : { detail }) }; console.log(ok ? 'PASS' : 'FAIL', name); };
async function observe(name, fn) {
    try { rec.obs[name] = await fn(); console.log('OK', name); }
    catch (error) { rec.obs[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
async function time(name, spec, trigger, opts) {
    try { rec.timing[name] = await measure(cdp, spec, trigger, opts); console.log('TIME', name, S({ first: rec.timing[name].firstCardVisibleMs, all: rec.timing[name].allSettledMs, final: rec.timing[name].final })); }
    catch (error) { rec.timing[name] = { error: sanitize(error, REPO) }; console.log('ERR', name, error.message); }
}
const INSPECTOR_ROOT = '[data-akari-ui="panel:inspector"]';
const MOTION = '[data-akari-ui="section:inspector-motion:caption"]';
const EFFECT = '[data-akari-ui="section:inspector-style:effect"]';
const ANIMATOR = '[data-akari-ui="section:inspector-animator"]';
// 最初のカードが見える / 見本が出揃う（効果 = 画像が読めた・動き = 見本のアニメーションが付いた）
const EFFECT_CARDS = { rootSel: INSPECTOR_ROOT, cardSel: '.akari-effect-card', readyBody: `const i=c.querySelector('img');return !!i&&i.complete&&i.naturalWidth>0` };
const MOTION_CARDS = { rootSel: INSPECTOR_ROOT, cardSel: '.akari-caption-motion-card', readyBody: `const s=c.querySelector('.akari-caption-motion-sample');return !!s&&s.getAnimations().length>0` };
const LIB = kind => ({ cardSel: `[data-akari-catalog-preset-item^="${kind}/"]`, readyBody: `const t=c.querySelector('[data-akari-preset-sample-text]')||c.querySelector('img,canvas');if(!t)return false;if(t.tagName==='IMG')return t.complete&&t.naturalWidth>0;const r=t.getBoundingClientRect();if(!(r.width>0))return false;const fam=getComputedStyle(t).fontFamily.split(',')[0].replace(/["']/g,'').trim();return [...document.fonts].filter(f=>f.family.replace(/["']/g,'')===fam).every(f=>f.status!=='loading')` });
const tab = id => `(()=>{document.querySelector('[data-akari-ui="tab:inspector-${id}"]')?.click();return true})()`;
const scrollTo = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return false;e.scrollIntoView({block:'start'});return true})()`;
const card = (kind, id) => `${MOTION} .akari-caption-motion-card[data-motion-kind="${kind}"][data-motion-id="${id}"]`;
const openCatalog = category => command('akari.catalog.open', { category });
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
// 出力プレビューの字幕（出力フレーム内の位置・文字・影・再生中のアニメーション・キャレット）
const PLATE = captionText => `(()=>{const host=[...document.querySelectorAll('.caption-row-plate')].find(e=>(e.innerText||'').replace(/[|\\s]/g,'').length&&${S(captionText)}.startsWith((e.innerText||'').replace(/[|\\s]/g,'').slice(0,2)));const stage=document.getElementById('preview-stage');if(!host)return null;const p=host.querySelector('.akari-caption__plate')||host;const r=p.getBoundingClientRect();const s=stage?.getBoundingClientRect();const cs=getComputedStyle(p);const line=host.querySelector('.akari-caption__line')||p;const last=[...host.querySelectorAll('*')].reverse().find(e=>/^[|｜]$/.test(e.textContent||'')||/caret/i.test(e.className||''));return{text:(host.innerText||'').replace(/\\s+/g,''),topRatio:s?+((r.top-s.top)/s.height).toFixed(3):null,styled:!!host.querySelector('.akari-caption__plate'),textShadow:cs.textShadow.slice(0,60),anims:host.getAnimations({subtree:true}).filter(a=>a.playState==='running').map(a=>a.animationName||a.id||'waapi'),caret:last?getComputedStyle(last).opacity:null}})()`;

let session, cdp, v;
const shotBag = shooter(paths(WORK, 'bag'), 'after');
// 出力プレビューの中で毎フレーム記録する（CDP の往復は負荷が高いと 1 回数百 ms かかり、1 文字ずつの変化を取りこぼすため）。
async function pollPreview(expr, ms = 3500) {
    const id = `r${Date.now()}`;
    await v.eval(`(()=>{const out=[];window.__rec=window.__rec||{};window.__rec[${S(id)}]=out;const t0=performance.now();let last='';const f=()=>{let x;try{x=${expr}}catch(e){x={error:String(e)}}const k=JSON.stringify(x);if(k!==last){out.push([Math.round(performance.now()-t0),x]);last=k}if(performance.now()-t0<${ms})requestAnimationFrame(f)};requestAnimationFrame(f);return true})()`);
    return async () => { await sleep(ms + 300); return v.eval(`window.__rec[${S(id)}]`); };
}
// edit.json を書く操作（袋の motion）は出力プレビューの文書ごと作り直されてページ内の記録が消えるので、CDP で外から取る。
async function pollPreviewCdp(expr, ms = 5000) {
    const t0 = Date.now(); const out = []; let last = '';
    while (Date.now() - t0 < ms) {
        let x; try { x = await v.eval(expr); } catch (error) { x = { error: String(error.message).slice(0, 80) }; }
        const k = S(x); if (k !== last) { out.push([Date.now() - t0, x]); last = k; }
        await sleep(30);
    }
    return out;
}
const capOf = async (p, id = 'c-0001') => (await readJson(path.join(p.PJ, 'captions.json'))).captions.find(c => c.id === id);
const bagOf = async p => (await readJson(path.join(p.PJ, 'edit.json'))).tracks.flatMap(t => t.items).find(i => i.source?.kind === 'captions');

try {
    // ================= 袋あり
    const p = paths(WORK, 'bag');
    session = await start(p); cdp = session.cdp;
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    v = await view(Number(process.env.CDP_PORT || 9636));
    const fixtureCaptions = await readJson(path.join(p.PJ, 'captions.json'));
    await selectCaption(cdp, 'c-0001');
    await dismissToasts(cdp);

    // ---- 効果のカード
    await observe('effect-cards', async () => {
        await evalOn(cdp, tab('text')); await sleep(1000);
        await evalOn(cdp, scrollTo(EFFECT)); await sleep(600);
        const state = await evalOn(cdp, `(()=>{const cards=[...document.querySelectorAll(${S(EFFECT + ' .akari-effect-card')})];const groups=[...document.querySelectorAll(${S(EFFECT + ' .akari-effect-group-title')})].map(e=>e.textContent);return{n:cards.length,groups,ids:cards.map(c=>c.dataset.value),labels:cards.map(c=>c.innerText.trim()),distinctImages:new Set(cards.map(c=>c.querySelector('img')?.src)).size,imagesReady:cards.filter(c=>{const i=c.querySelector('img');return i&&i.complete&&i.naturalWidth>0}).length,imgTags:cards.filter(c=>c.querySelector('img')).length,domPerCard:Math.max(...cards.map(c=>c.getElementsByTagName('*').length)),selects:document.querySelectorAll(${S(EFFECT + ' select')}).length}})()`);
        check('effect: 21 枚・5 グループ・画像が全部違う・select なし', state.n === 21 && state.groups.join() === '影,光,縁,帯,組み合わせ' && state.distinctImages === 21 && state.imagesReady === 21 && state.selects === 0, state);
        check('effect: カードは画像 1 枚 + 名前（重い DOM・書体読み込みなし）', state.imgTags === 21 && state.domPerCard <= 3, { domPerCard: state.domPerCard });
        return { state, shot: await shotBag(cdp, '01-effect-cards') };
    });
    // ---- 既存 5 種の判定と調整欄の出し分け（c-0001〜c-0005）
    await observe('effect-legacy', async () => {
        const out = {};
        const expected = { 'c-0001': 'sh-soft', 'c-0002': 'sh-raised', 'c-0003': 'neon-blue', 'c-0004': 'ol-thick', 'c-0005': null };
        for (const id of Object.keys(expected)) {
            await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${id}"]`); await sleep(1400);
            out[id] = await evalOn(cdp, `(()=>{const s=document.querySelector(${S(EFFECT)});return{pressed:[...s.querySelectorAll('.akari-effect-card[aria-pressed="true"]')].map(c=>c.dataset.value),fields:[...s.querySelectorAll('[data-akari-field]')].map(e=>e.dataset.akariField).filter(f=>f!=='caption-style-effect')}})()`);
        }
        check('effect: 既存 5 種は対応する新カードとして判定', Object.entries(expected).every(([id, e]) => S(out[id].pressed) === S(e ? [e] : [])), out);
        const f = id => out[id].fields.join();
        check('effect: 選んだ効果に関係する調整項目だけ', /shadow/.test(f('c-0001')) && !/glow|stroke|background/.test(f('c-0001'))
            && /glow/.test(f('c-0003')) && !/shadow|background/.test(f('c-0003'))
            && /stroke/.test(f('c-0004')) && !/shadow|glow/.test(f('c-0004')) && out['c-0005'].fields.length === 0, out);
        const after = await readJson(path.join(p.PJ, 'captions.json'));
        check('effect: 既存の captions.json は書き換わらない（見るだけ）', isDeepStrictEqual(after, fixtureCaptions));
        return out;
    });
    // ---- ホバーで試す / Esc で戻る / 確定 / undo 1 回
    await observe('effect-hover-confirm-undo', async () => {
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'); await sleep(1400);
        const text = fixtureCaptions.captions[0].text;
        const base = await v.eval(PLATE(text));
        await hoverSel(cdp, `${EFFECT} .akari-effect-card[data-value="neon-pink"]`); await sleep(1200);
        const hover = await v.eval(PLATE(text));
        const hoverShot = await shotBag(cdp, '02-effect-hover-neon-pink');
        await key(cdp, 'Escape', 'Escape', 27); await sleep(1200);
        const esc = await v.eval(PLATE(text));
        check('effect: ホバーでプレビューの字幕に仮に当たり、Esc で戻る', /255, 61, 174/.test(hover?.textShadow ?? '') && esc?.textShadow === base?.textShadow, { base: base?.textShadow, hover: hover?.textShadow, esc: esc?.textShadow });
        const before = (await capOf(p)).text_style;
        await clickSel(cdp, `${EFFECT} .akari-effect-card[data-value="bg-round"]`); await sleep(2500);
        const written = (await capOf(p)).text_style;
        const fields = await evalOn(cdp, `[...document.querySelectorAll(${S(EFFECT + ' [data-akari-field]')})].map(e=>e.dataset.akariField).filter(f=>f!=='caption-style-effect')`);
        const confirmShot = await shotBag(cdp, '03-effect-confirm-bg-round');
        await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
        const undone = (await capOf(p)).text_style;
        check('effect: クリックで確定し、調整欄が帯の項目に替わる', written?.background?.radius_px === 14 && written?.background?.opacity > 0 && !written?.shadow && fields.every(f => /background/.test(f)) && fields.length > 0, { written, fields });
        check('effect: undo 1 回で元に戻る', isDeepStrictEqual(undone, before), { before, undone });
        return { shots: [hoverShot, confirmShot] };
    });
    // ---- 開いてからカードが見える / 出揃うまで（BEFORE と同じ測り方）
    // 効果の段が表示範囲に入る位置でテキストタブを離れる（タブごとのスクロール位置が戻るので、最初のカードが見える時刻を測れる）
    const effectInView = async () => { await evalOn(cdp, tab('text')); await sleep(1000); await evalOn(cdp, `(()=>{document.querySelector(${S(EFFECT)})?.scrollIntoView({block:'start'});return true})()`); await sleep(800); await evalOn(cdp, tab('motion')); await sleep(1500); };
    await effectInView();
    await time('inspector-text-tab-click', EFFECT_CARDS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-text"]'), { profile: true });
    await time('inspector-motion-tab-click', MOTION_CARDS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'), { profile: true });
    await effectInView(); await evalOn(cdp, tab('text')); await sleep(1500);
    await time('inspector-select-caption-text-tab', EFFECT_CARDS, async () => clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0003"]'));
    await evalOn(cdp, tab('motion')); await sleep(1500);
    await time('inspector-select-caption-motion-tab', MOTION_CARDS, async () => clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'));
    for (let i = 2; i <= 3; i++) {
        await effectInView();
        await time(`inspector-text-tab-click-${i}`, EFFECT_CARDS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-text"]'));
        await time(`inspector-motion-tab-click-${i}`, MOTION_CARDS, async () => clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'));
    }
    for (const n of ['inspector-text-tab-click', 'inspector-motion-tab-click']) {
        const runs = [n, `${n}-2`, `${n}-3`].map(k => rec.timing[k]);
        check(`timing: ${n} 最初のカード 300ms 以内・出揃い 1 秒以内（3 回とも）`, runs.every(r => r.firstCardVisibleMs !== null && r.firstCardVisibleMs <= 300 && r.allSettledMs !== null && r.allSettledMs <= 1000),
            runs.map(r => ({ first: r.firstCardVisibleMs, all: r.allSettledMs })));
    }

    // ---- 動きタブ
    await observe('motion-tab', async () => {
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'); await sleep(1200);
        await evalOn(cdp, tab('motion')); await sleep(1500);
        await evalOn(cdp, `(()=>{document.querySelector(${S(INSPECTOR_ROOT)}).querySelector('[data-akari-ui^="section:inspector-"]')?.scrollIntoView({block:'start'});return true})()`); await sleep(1500);
        const state = await evalOn(cdp, `(()=>{const inView=e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0};const cards=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-card')})];const kinds={};for(const c of cards)kinds[c.dataset.motionKind]=(kinds[c.dataset.motionKind]||0)+1;const titles=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-title')})].map(e=>e.textContent.trim());const st=c=>{const a=c.querySelector('.akari-caption-motion-sample')?.getAnimations()??[];return a.length&&a.every(x=>x.playState==='running')?'running':a.length?'paused':'none'};const vis=cards.filter(inView),off=cards.filter(c=>!inView(c));const cs=getComputedStyle(cards[0]);return{titles,kinds,comboLabels:cards.filter(c=>c.dataset.motionKind==='combo').map(c=>c.innerText.replace(/あいう/,'').trim()),visibleRunning:vis.filter(c=>st(c)==='running').length,visible:vis.length,offscreenPaused:off.filter(c=>st(c)!=='running').length,offscreen:off.length,cardBorder:cs.borderTopWidth+' '+cs.borderTopStyle,cardBg:cs.backgroundColor,karaokeSettings:!!document.querySelector(${S(MOTION)}).innerText.includes('カラオケの設定'),animatorCollapsed:document.querySelector(${S(ANIMATOR + ' .akari-inspector-section-toggle')})?.getAttribute('aria-expanded')}})()`);
        check('motion: 組 6 種（英語の内部名なし・パーティー無し）', S(state.comboLabels) === S(['シンプル', 'スマート', 'ファン', 'コーポレート', 'リラックス', 'タイプライター']), state.comboLabels);
        check('motion: 登場/強調/退場・テキストアニメ・語ごとの表示・強調の段がある', state.kinds.slot > 0 && state.kinds.textanim >= 12 && state.kinds['word-style'] === 4 && state.kinds.emphasis === 9, state.kinds);
        check('motion: 見えているカードは常に動き、見えていないカードは止まっている', state.visible > 0 && state.visibleRunning === state.visible && state.offscreenPaused === state.offscreen, { visible: state.visible, running: state.visibleRunning, offscreen: state.offscreen, paused: state.offscreenPaused });
        check('motion: カードに枠と背景がある', !/^0px/.test(state.cardBorder) && state.cardBg !== 'rgba(0, 0, 0, 0)', { border: state.cardBorder, bg: state.cardBg });
        check('motion: カラオケを選ぶ前はカラオケの設定が無い・アニメーターは畳まれている', !state.karaokeSettings && state.animatorCollapsed === 'false', state);
        const a = await shotBag(cdp, '04-motion-tab-top');
        await evalOn(cdp, scrollTo(`${MOTION} .akari-caption-motion-card[data-motion-kind="textanim"]`)); await sleep(800);
        const b = await shotBag(cdp, '05-motion-tab-textanim');
        return { state, shots: [a, b] };
    });
    const text1 = fixtureCaptions.captions[0].text;
    // タイプライター（組）: 押す → 書き込み → プレビューで 1 文字ずつ + 点滅キャレット（位置・見た目を保つ）
    await observe('motion-typewriter', async () => {
        const base = await v.eval(PLATE(text1));
        const shots = [];
        const polling = await pollPreview(PLATE(text1), 7000);
        await clickSel(cdp, card('combo', 'typewriter'));
        for (let i = 0; i < 60; i++) { const s = await v.eval(PLATE(text1)).catch(() => null); if (s && s.text && s.text.includes('|') && s.text.replace(/[|｜]/g, '').length >= 4) { shots.push(await shotBag(cdp, '06-typewriter-preview-mid')); break; } await sleep(50); }
        const samples = await polling();
        const lens = samples.map(([, s]) => s?.text?.replace(/[|｜]/g, '').length ?? -1).filter(n => n >= 0);
        const partial = samples.filter(([, s]) => s && s.text && s.text.replace(/[|｜]/g, '').length > 0 && s.text.replace(/[|｜]/g, '').length < text1.length);
        const caretOn = samples.some(([, s]) => s?.caret === '1'), caretOff = samples.some(([, s]) => s?.caret === '0');
        const tops = partial.map(([, s]) => s.topRatio);
        const cap = await capOf(p);
        check('typewriter: プレビューで 1 文字ずつ増える（途中の長さが 5 段以上）', new Set(partial.map(([, s]) => s.text.replace(/[|｜]/g, '').length)).size >= 5, { distinctPartialLengths: [...new Set(partial.map(([, s]) => s.text.replace(/[|｜]/g, '').length))] });
        check('typewriter: 後ろに点滅するキャレット', caretOn && caretOff);
        check('typewriter: 再生中も字幕の位置と見た目を保つ', partial.length > 0 && tops.every(t => Math.abs(t - base.topRatio) < 0.05) && partial.every(([, s]) => s.styled), { baseTop: base.topRatio, tops: [...new Set(tops)] });
        check('typewriter: text_style.animation.in = typewriter を書く', cap.text_style?.animation?.in?.id === 'typewriter', cap.text_style?.animation);
        return { base, samples: samples.slice(0, 60), lens: [...new Set(lens)], shots };
    });
    // 強調（ループ）の動き: 袋の motion.loop に書き、プレビューで 1 回再生
    await observe('motion-slot-loop', async () => {
        await clickSel(cdp, `${MOTION} .akari-caption-motion-switch button:nth-child(2)`); await sleep(1200);
        await clickSel(cdp, card('slot', 'pulse'));
        const samples = await pollPreviewCdp(PLATE(text1), 5000);
        const bag = await bagOf(p);
        check('slot: 袋ありは袋の motion.loop へ書く', bag?.motion?.loop?.preset === 'pulse', bag?.motion);
        const played = samples.some(([, s]) => s?.anims?.some(n => /oneshot|waapi|pulse|heartbeat/.test(n)));
        check('slot: 押すとプレビューの字幕で 1 回再生', played, samples.slice(0, 30));
        return { motion: bag?.motion, samples: samples.slice(0, 30) };
    });
    // テキストアニメ: text_style.animation へ
    await observe('motion-textanim', async () => {
        await clickSel(cdp, card('textanim', 'bounce'));
        // The style write can rebuild the webview; keep the recorder outside that document.
        const samples = await pollPreviewCdp(PLATE(text1), 5000);
        const cap = await capOf(p);
        check('textanim: text_style.animation へ書く', cap.text_style?.animation?.in?.id === 'bounce', cap.text_style?.animation);
        check('textanim: 押すとプレビューの字幕で 1 回再生', samples.some(([, s]) => s?.anims?.some(n => /oneshot|waapi|bounce/.test(n))), samples.slice(0, 30));
        return { animation: cap.text_style?.animation };
    });
    // 語ごとの表示: カラオケを選んだときだけカラオケの設定
    await observe('motion-word-style', async () => {
        const polling = await pollPreview(PLATE(text1), 5000);
        await clickSel(cdp, card('word-style', 'karaoke'));
        const samples = await polling();
        const cap = await capOf(p);
        const settings = await evalOn(cdp, `(()=>{const t=document.querySelector(${S(MOTION)}).innerText;const i=t.indexOf('カラオケの設定');return i<0?null:t.slice(i,i+120).replace(/\\s+/g,' ')})()`);
        await evalOn(cdp, scrollTo(`${MOTION} .akari-caption-motion-card[data-motion-kind="word-style"]`)); await sleep(600);
        const shot = await shotBag(cdp, '07-karaoke-settings');
        check('word-style: captions[].style = karaoke を書き、カラオケの設定が出る', cap.style === 'karaoke' && !!settings, { style: cap.style, settings });
        check('word-style: 押すとプレビューで語ごとに再生', samples.some(([, s]) => s?.anims?.length > 0), samples.slice(0, 20));
        await clickSel(cdp, card('word-style', 'reveal')); await sleep(2500);
        const cap2 = await capOf(p);
        const settings2 = await evalOn(cdp, `document.querySelector(${S(MOTION)}).innerText.includes('カラオケの設定')`);
        check('word-style: カラオケ以外ではカラオケの設定が消える', cap2.style === 'reveal' && !settings2, { style: cap2.style });
        return { settings, shot };
    });
    // 強調（対象語）: 語チップ 2 番目 → 1 文字ドン
    await observe('motion-emphasis', async () => {
        const chips = await evalOn(cdp, `[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-words button')})].map(e=>e.textContent.trim())`);
        if (chips.length > 1) { await clickSel(cdp, `${MOTION} .akari-caption-motion-words button:nth-child(2)`); await sleep(600); }
        const polling = await pollPreview(PLATE(text1), 5000);
        await clickSel(cdp, card('emphasis', 'one-char-bang'));
        const samples = await polling();
        const root = await readJson(path.join(p.PJ, 'captions.json'));
        const words = fixtureCaptions.captions[0].words;
        const rec1 = (root.emphasis_words ?? []).find(e => e.style_hint === 'one-char-bang');
        check('emphasis: 選んだ語の source 秒で emphasis_words に書く', !!rec1 && rec1.word === words[1].text && rec1.t_start === words[1].start && rec1.t_end === words[1].end, { chips, record: rec1 });
        check('emphasis: 押すとプレビューで対象語に再生', samples.some(([, s]) => s?.anims?.length > 0), samples.slice(0, 20));
        return { chips, emphasis: root.emphasis_words, shot: await shotBag(cdp, '08-emphasis') };
    });
    // アニメーター: 詳細設定に畳まれ、ひな形 → 必要な欄だけ → すべての項目
    await observe('animator', async () => {
        const rows = () => evalOn(cdp, `[...document.querySelectorAll(${S(ANIMATOR + ' [data-akari-field]')})].filter(e=>e.getClientRects().length).map(e=>e.dataset.akariField)`);
        await clickSel(cdp, `${ANIMATOR} .akari-inspector-section-toggle`); await sleep(1200);
        const open = await evalOn(cdp, `document.querySelector(${S(ANIMATOR)}).innerText.replace(/\\s+/g,' ').slice(0,200)`);
        const before = (await bagOf(p)).animator ?? [];
        await evalOn(cdp, `(()=>{const s=document.querySelector(${S(ANIMATOR + ' [data-akari-ui="field:inspector-animator-template"]')});s.value='波打つ';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`); await sleep(3000);
        const after = (await bagOf(p)).animator ?? [];
        if (await evalOn(cdp, `document.querySelector(${S(ANIMATOR + ' .akari-inspector-section-toggle')})?.getAttribute('aria-expanded')`) !== 'true') { await clickSel(cdp, `${ANIMATOR} .akari-inspector-section-toggle`); await sleep(1000); }
        const added = after.at(-1);
        const name = `animator-${added?.id}`;
        const templRows = (await rows()).filter(r => r.startsWith(`${name}-`));
        await evalOn(cdp, scrollTo(ANIMATOR)); await sleep(500);
        const shot = await shotBag(cdp, '09-animator-template');
        await clickSel(cdp, `${ANIMATOR} [data-akari-ui="action:inspector-${name}-all"]`); await sleep(1000);
        const allRows = (await rows()).filter(r => r.startsWith(`${name}-`));
        check('animator: 平易な説明とひな形 3 種', /文字を 1 文字 \/ 1 語ずつずらして動かす仕組みです/.test(open) && /順に出る/.test(open) && /波打つ/.test(open) && /ランダムに揺れる/.test(open), open);
        check('animator: ひな形の後は必要な欄だけ・「すべての項目」で全欄', after.length === before.length + 1 && templRows.length <= 6 && allRows.length >= 14, { templRows, allRowsCount: allRows.length, added });
        return { templRows, allRowsCount: allRows.length, shot };
    });
    // 置いた文字でも動きタブが同じ
    await observe('placed-text', async () => {
        await evalOn(cdp, command('akari.caption.placeText', { start: 4, end: 7, text: '置いた文字' })); await sleep(2500);
        const ids = await evalOn(cdp, `[...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].map(e=>e.dataset.akariItemId)`);
        const placed = ids.find(id => !/^c-000[1-5]$/.test(id) && id !== 'captions');
        await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${placed}"]`); await sleep(1500);
        await evalOn(cdp, tab('text')); await sleep(800);
        const effects = await evalOn(cdp, `document.querySelectorAll(${S(EFFECT + ' .akari-effect-card')}).length`);
        await evalOn(cdp, tab('motion')); await sleep(1000);
        const motion = await evalOn(cdp, `document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-card')}).length`);
        check('placed-text: 置いた文字でも効果カードと動きのカード', effects === 21 && motion > 30, { placed, effects, motion });
        return { placed, effects, motion, shot: await shotBag(cdp, '10-placed-text-motion') };
    });
    // ライブラリのテキスト系のページ（本票の境界外・参考値）
    await time('library-textstyle-cold', LIB('textstyle'), async now => { await now(); await evalOn(cdp, openCatalog('textstyle')); });
    await time('library-textanim-cold', LIB('textanim'), async now => { await now(); await evalOn(cdp, openCatalog('textanim')); });
    rec.obs.finalCaptions = await readJson(path.join(p.PJ, 'captions.json'));
    rec.obs.finalBag = await bagOf(p);
    v.close(); v = null;
    await stop(session); session = null;
    // 自分の専用 userData の Electron の子プロセスだけを止め、CDP ポートが空くまで待つ（次の起動の Page.enable 待ちを防ぐ）
    try { execFileSync('/usr/bin/pkill', ['-f', paths(WORK, 'bag').ISO]); } catch {}
    for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${process.env.CDP_PORT || 9636}/json/list`, { signal: AbortSignal.timeout(500) }); await sleep(500); } catch { break; } }
    await sleep(2000);

    // ================= 袋なし
    const q = paths(WORK, 'nobag');
    session = await start(q); cdp = session.cdp;
    await openProject(session, q.PJ, 1);
    await observe('motion-nobag', async () => {
        await selectCaption(cdp, 'c-0001'); await dismissToasts(cdp);
        await evalOn(cdp, tab('motion')); await sleep(1200);
        const editBefore = await readJson(path.join(q.PJ, 'edit.json'));
        const shot = await shooter(q, 'after')(cdp, '11-motion-tab-nobag');
        await clickSel(cdp, card('combo', 'smart')); await sleep(2500);
        const cap = await capOf(q);
        const editAfter = await readJson(path.join(q.PJ, 'edit.json'));
        check('nobag: 袋なしでもカードで選べ、text_style.animation へ書く（袋は作らない）', cap.text_style?.animation?.in?.id === 'slide-up' && isDeepStrictEqual(editBefore.tracks, editAfter.tracks), cap.text_style?.animation);
        await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
        const undone = await capOf(q);
        check('nobag: undo 1 回で元に戻る', !undone.text_style?.animation, undone.text_style);
        return { animation: cap.text_style?.animation, shot };
    });
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    v?.close();
    await stop(session);
    const failed = Object.entries(rec.checks).filter(([, c]) => !c.ok).map(([k]) => k);
    rec.summary = { checks: Object.keys(rec.checks).length, failed };
    await writeFile(path.join(OUT, 'results-after.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, summary: rec.summary }));
