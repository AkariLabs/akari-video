#!/usr/bin/env node
// AFTER（L1・受け入れ条件の判定つき）。ラッパー作成の検証スクリプト。
// (c) コマンドでフォントパネル → もう一度で戻る (d) フィルター (e) 太さの展開 (f) ホバー → Esc → クリックで確定 → undo
// (g) スタイルパネルのカード (h) ライブラリのテキストスタイルのカード、に加えて通知・選択の変化・キーボード操作を記録する。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node after.mjs <作業用ディレクトリ（実体パス）>   （CDP_PORT 既定 9631）
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evalOn, realClick } from './cdp-lib.mjs';
import { sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { view } from './view.mjs';
import { LIB_CARDS, OUT, REPO, S, center, clickSel, hoverSel, key, openProject, openTextstyleShelf, paths, shooter, start } from './common.mjs';

const p = paths(process.argv[2]);
const rec = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [] };
const shot = shooter(p, 'after');
const head = f => execFileSync('/usr/bin/git', ['show', `HEAD:${f}`], { cwd: p.PJ, encoding: 'utf8' });
const captionsText = () => readFile(path.join(p.PJ, 'captions.json'), 'utf8');
const cue = async id => JSON.parse(await captionsText()).captions.find(c => c.id === id);
const cmd = (id, arg) => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');const r=await window.theia.container.get(C).executeCommand(${S(id)}${arg === undefined ? '' : `,${S(arg)}`});return r!==null&&typeof r==='object'?'[object]':r??null})()`;
async function check(name, fn) {
    const started = Date.now();
    try { const detail = await fn(); rec.checks.push({ name, pass: true, ms: Date.now() - started, detail }); console.log('PASS', name); }
    catch (error) { rec.checks.push({ name, pass: false, ms: Date.now() - started, error: sanitize(error, REPO) }); console.log('FAIL', name, error.message); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const PANEL = `(()=>{const e=document.querySelector('[data-akari-caption-panel]');return e?e.getAttribute('data-akari-caption-panel'):null})()`;
const SECTIONS = `[...document.querySelectorAll('[data-akari-ui="panel:inspector"] .akari-inspector-section-header')].map(h=>h.textContent.trim().slice(0,12))`;
const EVENTS = `JSON.parse(JSON.stringify({changed:window.__ctpChanged,preview:window.__ctpPreview}))`;
const RESET_EVENTS = `(()=>{window.__ctpChanged=[];window.__ctpPreview=[];return true})()`;
// 出力プレビューの c-0001 の字幕（webview の中）の見た目
const PLATE = `(()=>{const p=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith('caption-plate-c-0001'));if(!p)return null;const l=p.querySelector('.akari-caption__line');if(!l)return null;const cs=getComputedStyle(l);return{font:cs.fontFamily.slice(0,80),weight:cs.fontWeight,color:cs.color}})()`;
async function waitCaptions(pred, label, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const t = await captionsText(); if (pred(t)) return t; await sleep(200); }
    throw new Error(`${label} not reached`);
}
async function undo(cdp) {
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    const t = await waitCaptions(t => t === head('captions.json'), 'undo → captions.json byte-equal HEAD');
    await sleep(800);
    return { captionsEqualHead: (await captionsText()) === head('captions.json') && t === head('captions.json'),
        gitStatus: execFileSync('/usr/bin/git', ['status', '--porcelain', '--', 'captions.json', 'edit.json'], { cwd: p.PJ, encoding: 'utf8' }) };
}

await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
const cdp = session.cdp;
let v;
try {
    await openProject(session, p.PJ, 1);
    rec.window = session.window;
    await evalOn(cdp, `(()=>{window.__ctpChanged=[];window.__ctpPreview=[];window.addEventListener('akari-caption-panel-changed',e=>window.__ctpChanged.push(e.detail));window.addEventListener('akari-caption-panel-preview',e=>window.__ctpPreview.push({captionId:e.detail?.captionId??null,textStyle:e.detail?.textStyle??null}));return true})()`);
    v = await view(Number(process.env.CDP_PORT || 9631));

    await check('字幕が選ばれていないとき toggle は何もしない（false・通知なし）', async () => {
        const r = await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' }));
        await sleep(600);
        const ev = await evalOn(cdp, EVENTS);
        assert(r === false && (await evalOn(cdp, PANEL)) === null && ev.changed.length === 0, `r=${r} ev=${S(ev)}`);
        return { result: r, events: ev };
    });
    await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]');
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand('akari.inspector.open');return true})()`);
    await sleep(2000);
    rec.sectionsBefore = await evalOn(cdp, SECTIONS);
    rec.plateInitial = await v.eval(PLATE);

    // (c) コマンドで開く → もう一度で戻る
    await check('(c) toggle font → フォントパネル・通知 {panel:"font"}・書体は読み込み後にその書体で描かれる', async () => {
        await evalOn(cdp, RESET_EVENTS);
        const r = await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' }));
        await waitEval(cdp, `${PANEL}==='font'`, { label: 'font panel', timeoutMs: 10_000 });
        await evalOn(cdp, `document.fonts.ready.then(()=>true)`);
        await sleep(1500);
        const rows = await evalOn(cdp, `(async()=>{await document.fonts.ready;const loaded=[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/"/g,''));return [...document.querySelectorAll('[data-akari-font-row]')].map(r=>{const n=r.querySelector('.akari-caption-font-name');const fam=getComputedStyle(n).fontFamily.split(',')[0].replace(/"/g,'').trim();return{id:r.dataset.akariFontRow,text:n.textContent.trim(),family:fam,faceLoaded:loaded.includes(fam),detail:(r.querySelector('.akari-caption-font-detail')?.textContent||'').trim(),chevron:!!r.querySelector('button:first-child:not(:disabled)')}})})()`);
        const ev = await evalOn(cdp, EVENTS);
        await shot(cdp, 'c1-font-panel');
        assert(r === true, `toggle returned ${r}`);
        assert(S(ev.changed) === S([{ panel: 'font' }]), `events ${S(ev.changed)}`);
        assert(rows.length > 0 && rows.every(x => x.faceLoaded), `not all rows loaded: ${S(rows.filter(x => !x.faceLoaded))}`);
        return { rows, events: ev.changed };
    });
    await check('(c) 同じ toggle をもう一度 → 元の中身（文字・縁取り…の欄）に戻る・通知 {panel:null}', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' }));
        await waitEval(cdp, `${PANEL}===null`, { label: 'panel closed', timeoutMs: 10_000 });
        await sleep(800);
        const sections = await evalOn(cdp, SECTIONS);
        const ev = await evalOn(cdp, EVENTS);
        await shot(cdp, 'c2-back-to-inspector');
        assert(S(ev.changed) === S([{ panel: null }]), `events ${S(ev.changed)}`);
        assert(S(sections) === S(rec.sectionsBefore), `sections ${S(sections)} vs ${S(rec.sectionsBefore)}`);
        return { sections, events: ev.changed };
    });
    await check('違う panel で切り替え（font → style → font）・close コマンド・毎回通知', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' })); await sleep(500);
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'style' })); await sleep(500);
        const mid = await evalOn(cdp, PANEL);
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' })); await sleep(500);
        await evalOn(cdp, cmd('akari.captionPanel.close')); await sleep(500);
        const ev = await evalOn(cdp, EVENTS);
        const panel = await evalOn(cdp, PANEL);
        assert(mid === 'style' && panel === null, `mid=${mid} end=${panel}`);
        assert(S(ev.changed) === S([{ panel: 'font' }, { panel: 'style' }, { panel: 'font' }, { panel: null }]), `events ${S(ev.changed)}`);
        return { events: ev.changed };
    });

    // (d) フィルター
    await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' }));
    await waitEval(cdp, `${PANEL}==='font'`, { label: 'font panel', timeoutMs: 10_000 });
    await sleep(800);
    await check('(d) 検索欄の右のボタン → 横スライドの四角いチップ 1 列・「すべて」無し・複数選択は AND・選んだ数がボタンに出る', async () => {
        const all = await evalOn(cdp, `document.querySelectorAll('[data-akari-font-row]').length`);
        const btn = await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-font-search]');const b=document.querySelector('[data-akari-font-filter]');const rs=s.getBoundingClientRect(),rb=b.getBoundingClientRect();return{rightOfSearch:rb.left>=rs.right-1&&Math.abs((rb.top+rb.height/2)-(rs.top+rs.height/2))<6}})()`);
        await clickSel(cdp, '[data-akari-font-filter]'); await sleep(500);
        const chips = await evalOn(cdp, `(()=>{const cs=[...document.querySelectorAll('[data-akari-font-filter-chip]')];const row=cs[0]?.parentElement;const st=row?getComputedStyle(row):null;return{tags:cs.map(c=>c.dataset.akariFontFilterChip+'|'+c.textContent.trim()),hasAll:cs.some(c=>/すべて/.test(c.textContent)),oneRow:new Set(cs.map(c=>Math.round(c.getBoundingClientRect().top))).size===1,overflowX:st?.overflowX,radius:cs[0]?getComputedStyle(cs[0]).borderRadius:null}})()`);
        await shot(cdp, 'd1-filter-open');
        const counts = { none: all };
        const tags = chips.tags.map(t => t.split('|')[0]);
        const pick = tags.includes('gothic') ? 'gothic' : tags[0];
        await clickSel(cdp, `[data-akari-font-filter-chip="${pick}"]`); await sleep(400);
        counts[pick] = await evalOn(cdp, `document.querySelectorAll('[data-akari-font-row]').length`);
        const second = tags.includes('rounded') && pick !== 'rounded' ? 'rounded' : tags.find(t => t !== pick && t !== 'japanese') ?? tags.find(t => t !== pick);
        await clickSel(cdp, `[data-akari-font-filter-chip="${second}"]`); await sleep(400);
        counts[`${pick}+${second}`] = await evalOn(cdp, `document.querySelectorAll('[data-akari-font-row]').length`);
        const label = await evalOn(cdp, `document.querySelector('[data-akari-font-filter]').textContent.trim()`);
        const rowsAnd = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-font-row]')].map(r=>r.dataset.akariFontRow)`);
        await shot(cdp, 'd2-filter-chips-selected');
        // 戻す
        await clickSel(cdp, `[data-akari-font-filter-chip="${second}"]`); await sleep(200);
        await clickSel(cdp, `[data-akari-font-filter-chip="${pick}"]`); await sleep(200);
        const back = await evalOn(cdp, `document.querySelectorAll('[data-akari-font-row]').length`);
        await clickSel(cdp, '[data-akari-font-filter]'); await sleep(300);
        assert(btn.rightOfSearch, 'filter button not right of search');
        assert(!chips.hasAll && chips.oneRow && /auto|scroll/.test(chips.overflowX), `chips ${S(chips)}`);
        assert(counts[`${pick}+${second}`] <= counts[pick] && back === all, `counts ${S(counts)} back=${back}`);
        assert(/2/.test(label), `button label ${label}`);
        return { button: btn, chips, counts, labelWithTwo: label, rowsAnd, backToAll: back };
    });

    // (e) 太さの展開
    await check('(e) シェブロンで実際にある太さだけ展開・各太さをその太さで描く・太さ 1 つの書体はシェブロン無し', async () => {
        const multi = await evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-font-row="mplus-rounded-1c"]')||[...document.querySelectorAll('[data-akari-font-row]')].find(r=>!r.querySelector('button').disabled);return r?.dataset.akariFontRow})()`);
        const single = await evalOn(cdp, `(()=>{const r=document.querySelector('[data-akari-font-row="dela-gothic-one"]');const b=r?.querySelector('button');return b?{disabled:b.disabled,text:b.textContent.trim(),visible:b.getBoundingClientRect().width>0}:null})()`);
        await clickSel(cdp, `[data-akari-font-row="${multi}"] button`); await sleep(700);
        const weights = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-font-row=${S(multi)}] [data-akari-font-weight]')].map(b=>({w:b.dataset.akariFontWeight,css:getComputedStyle(b).fontWeight,font:getComputedStyle(b).fontFamily.split(',')[0]}))`);
        await evalOn(cdp, `document.querySelector('[data-akari-font-row=${S(multi)}]').scrollIntoView({block:'center'})`);
        await shot(cdp, 'e-font-weights');
        assert(weights.length > 1 && weights.every(x => String(x.css) === String(x.w)), `weights ${S(weights)}`);
        assert(single && single.disabled && !single.text, `single ${S(single)}`);
        return { font: multi, weights, singleWeightChevron: single };
    });
    // 展開を閉じる
    await clickSel(cdp, `[data-akari-font-row="mplus-rounded-1c"] button`).catch(() => {}); await sleep(400);

    // (f) ホバー → Esc → クリックで確定 → undo
    await check('(f-1) ホバー: 書き込まない（captions.json 不変）・仮の見た目の通知が出る', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await hoverSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]'); await sleep(1200);
        const ev = await evalOn(cdp, EVENTS);
        const plate = await v.eval(PLATE);
        const same = (await captionsText()) === head('captions.json');
        await shot(cdp, 'f1-hover');
        assert(same, 'captions.json changed by hover');
        assert(ev.preview.length >= 1 && ev.preview.at(-1).textStyle && /Dela Gothic One/.test(S(ev.preview.at(-1).textStyle)), `preview events ${S(ev.preview)}`);
        return { previewEvents: ev.preview, previewPlate: plate, previewPlateInitial: rec.plateInitial, previewPlateChanged: S(plate) !== S(rec.plateInitial) };
    });
    await check('(f-2) Esc → 仮を解く通知（textStyle:null）・書き込みなし・パネルは開いたまま', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await key(cdp, 'Escape', 'Escape', 27); await sleep(700);
        const ev = await evalOn(cdp, EVENTS);
        const panel = await evalOn(cdp, PANEL);
        await shot(cdp, 'f2-escape');
        assert((await captionsText()) === head('captions.json'), 'captions.json changed');
        assert(ev.preview.length >= 1 && ev.preview.at(-1).textStyle === null, `events ${S(ev.preview)}`);
        assert(panel === 'font', `panel ${panel}`);
        return { previewEvents: ev.preview, panel, plate: await v.eval(PLATE) };
    });
    // Esc で選択ごと外れた場合でも後続の確認を続けられるよう、c-0001 を選び直してフォントパネルを開き直す（判定は (f-2) に残る）
    if ((await evalOn(cdp, PANEL)) !== 'font') {
        rec.recoveredAfterEscape = true;
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0001"]'); await sleep(1500);
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'font' }));
        await waitEval(cdp, `${PANEL}==='font'`, { label: 'font panel (recover)', timeoutMs: 10_000 }); await sleep(800);
    }
    await check('(f-3) クリックで確定: 書き込み 1 回（font_family だけ変わる）・プレビューの字幕がその書体に', async () => {
        await clickSel(cdp, '[data-akari-font-row="dela-gothic-one"] [data-akari-panel-sample]');
        const after = await waitCaptions(t => t !== head('captions.json'), 'captions write');
        await sleep(1500);
        const before = JSON.parse(head('captions.json')).captions.find(c => c.id === 'c-0001');
        const now = JSON.parse(after).captions.find(c => c.id === 'c-0001');
        const changedKeys = Object.keys({ ...before.text_style, ...now.text_style }).filter(k => S(before.text_style?.[k]) !== S(now.text_style?.[k]));
        const others = JSON.parse(after).captions.filter(c => c.id !== 'c-0001');
        const othersSame = S(others) === S(JSON.parse(head('captions.json')).captions.filter(c => c.id !== 'c-0001'));
        const plate = await waitEval(v.cdp, `(()=>{const r=${PLATE};return r&&/Dela Gothic One/.test(r.font)?r:null})()`, { label: 'preview plate font', timeoutMs: 20_000 }).catch(() => null) ?? await v.eval(PLATE);
        await shot(cdp, 'f3-click-commit');
        assert(S(changedKeys) === S(['font_family']) && now.text_style.font_family === 'Dela Gothic One', `changed ${S(changedKeys)} ${now.text_style.font_family}`);
        assert(othersSame, 'other captions changed');
        assert(/Dela Gothic One/.test(plate?.font ?? ''), `preview plate ${S(plate)}`);
        return { changedKeys, fontFamily: now.text_style.font_family, previewPlate: plate };
    });
    await check('(f-4) undo 1 回（Cmd+Z）で captions.json が元と byte 一致', async () => {
        const r = await undo(cdp);
        await sleep(1200);
        await shot(cdp, 'f4-undo');
        assert(r.captionsEqualHead && r.gitStatus === '', S(r));
        return { ...r, previewPlate: await v.eval(PLATE) };
    });
    await check('キーボード: 見本にフォーカス → ↓ で移動（仮の通知）→ Enter で確定（書き込み 1 回）→ undo 1 回', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await evalOn(cdp, `(()=>{document.querySelector('[data-akari-font-row="biz-udgothic"] [data-akari-panel-sample]').focus();return true})()`); await sleep(400);
        await key(cdp, 'ArrowDown', 'ArrowDown', 40); await sleep(500);
        const focused = await evalOn(cdp, `(()=>{const e=document.activeElement;const r=e?.closest('[data-akari-font-row]');return r?.dataset.akariFontRow??e?.textContent?.trim().slice(0,30)})()`);
        const ev = await evalOn(cdp, EVENTS);
        const unchanged = (await captionsText()) === head('captions.json');
        await key(cdp, 'Enter', 'Enter', 13);
        const after = await waitCaptions(t => t !== head('captions.json'), 'keyboard write');
        const fam = JSON.parse(after).captions.find(c => c.id === 'c-0001').text_style.font_family;
        const r = await undo(cdp);
        assert(unchanged && ev.preview.length >= 2, `preview events ${S(ev.preview)} unchanged=${unchanged}`);
        assert(r.captionsEqualHead, 'undo');
        return { focusedAfterArrowDown: focused, previewEvents: ev.preview.map(e => e.textStyle?.fontFamily ?? null), committedFamily: fam, undo: r };
    });

    // (g) スタイルパネル
    await check('(g) スタイルパネル: 最近使った / マイスタイル / テキストスタイルの段・カードごとに違う見た目（色・縁取り・座布団・影）', async () => {
        await evalOn(cdp, cmd('akari.captionPanel.toggle', { panel: 'style' }));
        await waitEval(cdp, `${PANEL}==='style'`, { label: 'style panel', timeoutMs: 10_000 });
        await sleep(1500);
        const info = await evalOn(cdp, `(()=>{const root=document.querySelector('[data-akari-caption-panel]');const heads=[...root.querySelectorAll('.akari-caption-panel-title')].map(h=>h.textContent.trim());const cards=[...root.querySelectorAll('[data-akari-style-card]')].map(c=>{const cap=c.querySelector('.akari-caption');const line=c.querySelector('.akari-caption__line');const cs=getComputedStyle(line);const plateEl=c.querySelector('.akari-caption__block')||line;const pcs=getComputedStyle(plateEl);return{id:c.dataset.akariStyleCard,text:line.textContent,color:cs.color,stroke:cs.webkitTextStrokeWidth+' '+cs.webkitTextStrokeColor,bg:pcs.backgroundColor,shadow:cs.textShadow.slice(0,120),font:cs.fontFamily.split(',')[0],weight:cs.fontWeight,letterSpacing:cs.letterSpacing}});const save=[...root.querySelectorAll('button')].some(b=>/今のスタイルをマイスタイルに保存/.test(b.textContent));return{heads,cards,save}})()`);
        await shot(cdp, 'g-style-panel');
        const sigs = new Set(info.cards.map(c => S([c.color, c.stroke, c.bg, c.shadow, c.font, c.weight, c.letterSpacing])));
        const withBg = info.cards.filter(c => c.bg !== 'rgba(0, 0, 0, 0)').length;
        const withStroke = info.cards.filter(c => !/^0px/.test(c.stroke)).length;
        const withShadow = info.cards.filter(c => c.shadow !== 'none').length;
        const colors = new Set(info.cards.map(c => c.color)).size;
        assert(info.cards.every(c => c.text === 'Abc あいう 漢字'), 'sample text');
        assert(sigs.size === info.cards.length, `duplicate looks ${sigs.size}/${info.cards.length}`);
        assert(withBg > 0 && withStroke > 0 && withShadow > 0 && colors > 2, `bg=${withBg} stroke=${withStroke} shadow=${withShadow} colors=${colors}`);
        assert(info.heads.some(h => /最近使った/.test(h)) && info.heads.some(h => /マイスタイル/.test(h)) && info.heads.some(h => /テキストスタイル/.test(h)) && info.save, `heads ${S(info.heads)}`);
        return { ...info, distinctLooks: sigs.size, withBg, withStroke, withShadow, distinctColors: colors };
    });
    await check('(g) スタイルのカードをクリック → 書き込み 1 回 → undo 1 回で戻る', async () => {
        await clickSel(cdp, '[data-akari-style-card="subtitle-news"]');
        const after = await waitCaptions(t => t !== head('captions.json'), 'style write');
        const now = JSON.parse(after).captions.find(c => c.id === 'c-0001');
        await sleep(1200);
        await shot(cdp, 'g2-style-applied');
        const r = await undo(cdp);
        assert(r.captionsEqualHead, 'undo');
        return { appliedTextStyle: now.text_style, stylePreset: now.style_preset ?? null, undo: r };
    });
    await check('選択の変化: 別の字幕へ → パネルを保つ（通知なし）/ 選択を外す（タイムラインで Esc）→ 閉じる（通知 {panel:null}）', async () => {
        await evalOn(cdp, RESET_EVENTS);
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0002"]'); await sleep(1500);
        const kept = await evalOn(cdp, PANEL);
        const ev1 = await evalOn(cdp, EVENTS);
        // 選択を外す: タイムラインにフォーカスがある状態で Esc（タイムライン既存の「選択を外す」）
        await clickSel(cdp, '.akari-annotations-strip-caption[data-akari-item-id="c-0002"]'); await sleep(800);
        await evalOn(cdp, RESET_EVENTS);
        await key(cdp, 'Escape', 'Escape', 27);
        await sleep(1500);
        const header = await evalOn(cdp, `(document.querySelector('[data-akari-ui="panel:inspector"]')?.innerText||'').slice(0,60)`);
        const closed = await evalOn(cdp, PANEL);
        const ev2 = await evalOn(cdp, EVENTS);
        await shot(cdp, 'selection-cleared-closed');
        assert(kept === 'style' && ev1.changed.length === 0, `kept=${kept} ${S(ev1.changed)}`);
        assert(closed === null && S(ev2.changed) === S([{ panel: null }]), `closed=${closed} ${S(ev2.changed)}`);
        return { keptOnOtherCaption: kept, closedOnDeselect: closed, inspectorText: header, events: ev2.changed };
    });

    // (h) ライブラリ
    await check('(h) ライブラリのテキストスタイル / マイスタイルのカード: 固定のお試し文字に実際のスタイル（カードごとに違う・色 / 縁 / 座布団 / 影）', async () => {
        await openTextstyleShelf(cdp);
        const cards = await evalOn(cdp, LIB_CARDS);
        await shot(cdp, 'h-library-textstyle-cards');
        const sigs = new Set(cards.map(c => S(c.sample && [c.sample.color, c.sample.stroke, c.sample.shadow, c.sample.chainBg, c.sample.font, c.sample.weight])));
        assert(cards.length > 0 && cards.every(c => c.sample?.text === 'Abc あいう 漢字'), `texts ${S(cards.map(c => c.sample?.text))}`);
        const bg = cards.filter(c => c.sample.chainBg.length && c.sample.chainBg[0] !== 'rgb(10, 10, 10)').length;
        const stroke = cards.filter(c => !/^0px/.test(c.sample.stroke)).length;
        const shadow = cards.filter(c => c.sample.shadow !== 'none').length;
        assert(sigs.size === cards.length, `duplicate looks ${sigs.size}/${cards.length}`);
        assert(bg > 0 && stroke > 0 && shadow > 0, `bg=${bg} stroke=${stroke} shadow=${shadow}`);
        return { count: cards.length, distinctLooks: sigs.size, withBg: bg, withStroke: stroke, withShadow: shadow, cards };
    });
    rec.status = rec.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    v?.close();
    await stop(session);
    await writeFile(path.join(OUT, 'results-after.json'), `${S(rec, null, 2).replaceAll(p.WORK, '<work>')}\n`);
}
console.log(S({ status: rec.status, pass: rec.checks.filter(c => c.pass).length, total: rec.checks.length, error: rec.error }));
