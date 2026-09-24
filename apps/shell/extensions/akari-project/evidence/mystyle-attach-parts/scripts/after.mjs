#!/usr/bin/env node
// マイスタイル「効果音・画面効果・装飾」部品（attach）の AFTER（L1・受け入れ条件の判定つき）。ラッパー作成の検証スクリプト。
// 使い方: node after.mjs <作業用ディレクトリ（実体パス）>   （fixture = <作業用>/fixture/spoken と fixture/library。CDP_PORT 既定 9491）
// 流れ（task の手順 3）: 字幕 A（c-0001）に効果音（登場）+ 装飾（全体）を右クリック「字幕にひも付ける…」でひも付け →
//       見た目・動きと一緒にマイスタイルへ保存 → 字幕 B・C（c-0002・c-0003）に当てる（undo 1 回 → 当て直し → 同じ字幕へもう一度 = 重複しない）→
//       出力プレビューで装飾が字幕の間だけ出る → B を動かすと効果音・装飾も動く（undo 1 回）→ C を消すと C の効果音・装飾も消える（undo 1 回）→
//       印付きの装飾を手で動かすとアンカーと印が外れる / 印の無いアンカー要素は外れない（各 undo 1 回）→ B を動かした状態で書き出し →
//       書き出した動画の音の立ち上がり・装飾の色が字幕の時刻と一致。
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick, realDragMod } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop } from './l1-lib.mjs';
import { openProject } from './l1-common.mjs';
import { view } from './view.mjs';
import { prepareLibrary } from './library-home.mjs';
import { DIALOG, NOTICE, S, clickSel, key, openShelf, setupWindow, shotTo, styleFiles, typeInto, waitFor, widenTimeline } from './common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9491);
const PJ = path.join(WORK, 'ws');
const ISO = path.join(WORK, 'iso');
const LIBRARY = path.join(WORK, 'creator', 'library');
const STYLES = path.join(LIBRARY, 'styles');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const out = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [], screenshots: [] };
const RESULTS = path.join(OUT, 'results-after.json');
const ABS = /(^|["'\s])(\/(Users|private|tmp|var|home|Volumes)\/|[A-Za-z]:\\|\\\\|file:\/\/|~\/)/;
const scrub = value => JSON.parse(S(value).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO).replaceAll(WORK, '<work>'); }
    finally { await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`); }
    console.log(`${record.pass ? 'PASS' : 'FAIL'} ${name}${record.error ? ` — ${record.error.slice(0, 400)}` : ''}`);
    return record.detail;
}
const shot = async (cdp, name) => { await shotTo(cdp, WORK, path.join(OUT, `after-${name}.png`)); out.screenshots.push(`after-${name}.png`); };
const text = file => readFile(path.join(PJ, file), 'utf8');
const both = async () => ({ captions: await text('captions.json'), edit: await text('edit.json') });
const captions = async () => Object.fromEntries(JSON.parse(await text('captions.json')).captions.map(c => [c.id, c]));
const edit = async () => JSON.parse(await text('edit.json'));
const usage = async () => { try { return JSON.parse(await text('.akari/style-usage.json')); } catch { return null; } };
const usageCount = async () => (await usage())?.entries?.length ?? 0;
const nextUsage = async count => (await waitFor('usage appended', async () => { const u = await usage(); return u?.entries?.length > count ? u : null; }, 30_000)).entries.at(-1);
const editUri = () => `file://${path.join(PJ, 'edit.json')}`;
const select = (cdp, ids) => evalOn(cdp, command('akari.timeline.selectCaptions', { editUri: editUri(), captionIds: ids }));
// edit.json の全 item（lane 付き・入れ子も）
function flatItems(doc) {
    const rows = [];
    const visit = (items, track, lane) => { for (const item of items ?? []) { rows.push({ track, lane, item }); visit(item.items, track, lane); } };
    for (const track of doc.tracks) visit(track.items, track.id, track.lane);
    return rows;
}
// スタイルが置いた印（契約どおり anchor.attached_by。item 直下の attached_by も読む）
const markOf = item => item.anchor?.attached_by ?? item.attached_by ?? null;
const markedFor = (doc, captionId) => flatItems(doc).filter(row => markOf(row.item)?.caption === captionId);
const summary = rows => rows.map(({ lane, track, item }) => ({ id: item.id, lane, track, at: item.at, duration: item.duration, kind: item.source?.kind, anchor: item.anchor ?? null }));
const frame = sec => Math.round(sec * FPS);
async function undoOnce(cdp, expected, label) {
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    let now;
    for (let i = 0; i < 60; i++) { await sleep(250); now = await both(); if (now.captions === expected.captions && now.edit === expected.edit) break; }
    await sleep(800);
    now = await both();
    const result = { label, captionsEqual: now.captions === expected.captions, editEqual: now.edit === expected.edit };
    assert(result.captionsEqual && result.editEqual, `undo 1 回で戻らない ${S(result)}`);
    return result;
}
// タイムラインの帯（strip）の要素
const stripOf = (cdp, id) => waitFor(`strip ${id}`, () => evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-item-id="'+${S(id)}+'"]')].find(e=>String(e.className).includes('akari-annotations-strip')&&e.getBoundingClientRect().width>0);if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();let p=null;for(const fy of [0.5,0.7,0.3,0.85]){for(const fx of [0.5,0.3,0.7,0.15,0.85]){const x=r.left+r.width*fx,y=r.top+r.height*fy;const h=document.elementFromPoint(x,y);if(h&&e.contains(h)){p={x,y};break}}if(p)break}if(!p)return null;return{x:p.x,y:p.y,left:r.left,width:r.width,cls:String(e.className).slice(0,120)}})()`), 30_000);
const TIMELINE_STRIPS = `(()=>{const px=v=>Math.round(v*10)/10;return [...document.querySelectorAll('[data-akari-item-id]')].filter(e=>String(e.className).includes('akari-annotations-strip')&&e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return{id:e.dataset.akariItemId,left:px(r.left),top:px(r.top),width:px(r.width),cls:String(e.className).replace(/akari-annotations-/g,'').slice(0,80)}})})()`;
async function rightClick(cdp, x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
    await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
}
const MENU_ITEM = label => `(()=>{const e=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.textContent.trim()===${S(label)}&&e.getBoundingClientRect().width>0).at(-1);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const ATTACH_DIALOG = `(()=>{const d=document.querySelector('[data-akari-caption-attach-dialog]');if(!d)return null;const s=[...d.querySelectorAll('select')];return{text:d.innerText.replace(/\\n+/g,' / '),captions:[...(s[0]?.options??[])].map(o=>({value:o.value,label:o.textContent})),positions:[...(s[1]?.options??[])].map(o=>({value:o.value,label:o.textContent})),position:s[1]?.value??null,emoji:/[\\p{Extended_Pictographic}]/u.test(d.textContent)}})()`;
async function attachViaMenu(cdp, itemId, captionId, position, shotName) {
    // 左クリックで選ぶと選択枠・トリムのつまみが帯に重なり右クリックが帯に届かないので、選ばずに帯の上で直接右クリックする
    const MENU = `(()=>{const b=document.querySelector('[data-akari-context-item="caption-attach"]');if(!b||b.getBoundingClientRect().width===0)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,label:b.textContent.trim()}})()`;
    let menu = null, labels = [];
    for (let attempt = 0; attempt < 4 && !menu; attempt++) {
        await stripOf(cdp, itemId);
        // 帯の中で実際に帯（またはその子）に当たる点を探す（見出しの札や選択枠が重なる所を避ける）
        const hit = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-item-id="'+${S(itemId)}+'"]')].find(e=>String(e.className).includes('akari-annotations-strip'));const r=e.getBoundingClientRect();const tried=[];for(const fy of [0.5,0.7,0.3,0.85])for(const fx of [0.5,0.3,0.7,0.15,0.85]){const x=r.left+r.width*fx,y=r.top+r.height*fy;const h=document.elementFromPoint(x,y);tried.push(String(h?.className||h?.tagName||'').slice(0,40));if(h&&e.contains(h))return{x,y};}return{miss:tried.slice(0,6)}})()`);
        assert(!hit.miss, `帯 ${itemId} の上に別の要素が重なっている ${S(hit.miss)}`);
        await rightClick(cdp, hit.x, hit.y);
        menu = await waitFor('menu item', () => evalOn(cdp, MENU), 10_000).catch(() => null);
        labels = await evalOn(cdp, `[...document.querySelectorAll('[data-akari-context-menu] button')].map(b=>b.textContent.trim())`);
        if (!menu) { await key(cdp, 'Escape', 'Escape', 27); await sleep(800); }
    }
    assert(menu, `右クリックに「字幕にひも付ける…」が無い（メニュー: ${S(labels)}）`);
    assert(menu.label === '字幕にひも付ける…', `label ${menu.label}`);
    await realClick(cdp, menu.x, menu.y);
    const dialog = await waitFor('attach dialog', () => evalOn(cdp, ATTACH_DIALOG), 15_000);
    // select の値は JS で合わせる（ネイティブのポップアップは CDP で操作できない。ダイアログは確定時に value を読む）
    await evalOn(cdp, `(()=>{const s=[...document.querySelectorAll('[data-akari-caption-attach-dialog] select')];s[0].value=${S(captionId)};s[0].dispatchEvent(new Event('change',{bubbles:true}));s[1].value=${S(position)};s[1].dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    if (shotName) await shot(cdp, shotName);
    const button = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('[data-akari-caption-attach-dialog] button')].find(b=>b.textContent.trim()==='ひも付ける');const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const before = await text('edit.json');
    await realClick(cdp, button.x, button.y);
    await waitFor('edit.json written', async () => (await text('edit.json')) !== before, 30_000);
    await sleep(1200);
    return dialog;
}
const POPOVER = `(()=>{const p=document.querySelector('[data-akari-my-style-apply-popover]');if(!p)return null;const r=p.getBoundingClientRect();return{rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},text:p.innerText.replace(/\\n+/g,' / '),inputs:[...p.querySelectorAll('input[type=checkbox]')].map(i=>({kind:i.value,checked:i.checked,disabled:i.disabled,label:i.closest('label')?.textContent.trim()})),emoji:/[\\p{Extended_Pictographic}]/u.test(p.textContent)}})()`;
async function applyStyle(cdp, styleId, ids, { shotName } = {}) {
    await select(cdp, ids);
    await sleep(800);
    await clickSel(cdp, `[data-akari-my-style-apply=${S(styleId)}]`);
    const pop = await waitFor('apply popover', () => evalOn(cdp, POPOVER), 10_000);
    if (shotName) await shot(cdp, shotName);
    const p = await waitFor('confirm button', () => evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('[data-akari-my-style-apply-popover] button')].find(b=>b.textContent.trim()==='当てる');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`));
    const before = await both();
    const count = await usageCount();
    await realClick(cdp, p.x, p.y);
    await waitFor('files written', async () => { const now = await both(); return now.edit !== before.edit && now.captions !== before.captions; }, 30_000);
    await sleep(1500);
    return { popover: pop, usage: await nextUsage(count) };
}
async function chipOf(cdp, captionId) {
    return waitFor(`chip ${captionId}`, () => evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-annotations-strip-caption[data-akari-item-id]')].find(e=>e.dataset.akariItemId===${S(captionId)}||e.dataset.akariItemId.endsWith('#'+${S(captionId)}));if(!e)return null;e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();for(const fy of [0.5,0.3,0.7])for(const fx of [0.5,0.35,0.65]){const x=r.left+r.width*fx,y=r.top+r.height*fy;const h=document.elementFromPoint(x,y);if(h&&e.contains(h))return{x,y,width:r.width}}return null})()`), 30_000);
}
// インスペクターやプレビューの操作でタイムラインの仕切りが戻り、帯が画面外へ出ることがあるので、字幕チップに手が届くまで広げ直す
async function ensureTimeline(cdp) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const ok = await chipOf(cdp, 'c-0002').then(() => true, () => false);
        if (ok) return attempt;
        await widenTimeline(cdp);
        await sleep(1500);
    }
    throw new Error('タイムラインの字幕チップに手が届かない');
}
// 高負荷時はドラッグが空振りすることがあるので、書き込まれるまで最大 3 回
async function dragUntilWritten(cdp, locate, dx) {
    const before = await text('edit.json') + await text('captions.json');
    for (let attempt = 1; attempt <= 3; attempt++) {
        const p = await locate();
        await realDragMod(cdp, [{ x: p.x, y: p.y }, { x: p.x + 6, y: p.y }, { x: p.x + dx, y: p.y }], { steps: 16, stepDelayMs: 45 });
        const moved = await waitFor('written', async () => (await text('edit.json') + await text('captions.json')) !== before, 20_000).catch(() => null);
        if (moved) { await sleep(1500); return attempt; }
    }
    throw new Error('ドラッグが書き込まれない');
}
// 出力プレビュー: 装飾（html item）の見え方
const OVERLAYS = `(()=>{const stage=document.getElementById('overlay-stage');if(!stage)return null;return [...stage.querySelectorAll('[data-overlay-id]')].map(e=>{const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return{id:e.getAttribute('data-overlay-id'),visible:cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&r.width>0&&r.height>0}})})()`;
async function previewVisible(cdp, times) {
    const v = await view(PORT);
    const got = {};
    try {
        for (const t of times) {
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: t }));
            await sleep(1800);
            const list = await waitFor(`overlays @${t}`, () => v.eval(OVERLAYS), 20_000);
            got[t] = list.filter(o => o.visible).map(o => o.id).sort();
        }
    } finally { v.close(); }
    return got;
}

// ===== 準備 =====
await rm(PJ, { recursive: true, force: true });
await rm(path.join(WORK, 'creator'), { recursive: true, force: true });
await mkdir(STYLES, { recursive: true });
await cp(path.join(WORK, 'fixture', 'library'), LIBRARY, { recursive: true });
await cp(path.join(WORK, 'fixture', 'spoken'), PJ, { recursive: true });
process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
let session = await launch({ shellDir: SHELL, electron: ELECTRON, project: PJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
let styleId, styleUid, finalState;
try {
    const cdp = session.cdp;
    await openProject(session, PJ, 1, PORT);
    await setupWindow(cdp);
    await widenTimeline(cdp);
    await sleep(1500);
    // タイムラインの仕切りのドラッグが高負荷で空振りすると帯が画面外に出るので、A1 の効果音の帯に手が届くまでやり直す
    for (let attempt = 0; attempt < 4; attempt++) {
        const reachable = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-item-id="sfx-a"]')].find(e=>String(e.className).includes('akari-annotations-strip'));const r=e?.getBoundingClientRect();const h=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return Boolean(h&&e.contains(h))})()`);
        out.timelineReachable = { attempt, reachable };
        if (reachable) break;
        await widenTimeline(cdp);
        await sleep(1500);
    }
    out.window = await evalOn(cdp, '({w:innerWidth,h:innerHeight})');
    out.stripsOpened = await evalOn(cdp, TIMELINE_STRIPS);
    await shot(cdp, '01-opened');

    // ===== 1. 字幕 A にひも付ける =====
    await check('右クリック「字幕にひも付ける…」: 効果音 sfx-a を c-0001 の登場へ（anchor = {caption c-0001, edge start, duration own}・at 0 のまま）', async () => {
        const dialog = await attachViaMenu(cdp, 'sfx-a', 'c-0001', 'in', '02-attach-dialog-sfx');
        assert(dialog.captions.some(c => c.value === 'c-0001'), `候補 ${S(dialog.captions)}`);
        assert(S(dialog.positions.map(p => p.label)) === S(['登場', '退場']), `効果音の位置 ${S(dialog.positions)}`);
        assert(!dialog.emoji, 'emoji');
        const item = flatItems(await edit()).find(r => r.item.id === 'sfx-a').item;
        assert(item.anchor?.caption === 'c-0001' && (item.anchor.edge ?? 'start') === 'start' && item.anchor.duration === 'own', `anchor ${S(item.anchor)}`);
        assert(!markOf(item), `手でひも付けた要素に印 ${S(item)}`);
        assert(item.at === 0 && item.duration === 12, `at/duration ${item.at}/${item.duration}`);
        return { dialog, item };
    });
    await check('右クリック「字幕にひも付ける…」: 装飾 deco-a を c-0001 の全体へ（anchor = {caption c-0001, duration caption}・0〜75 フレーム）', async () => {
        const dialog = await attachViaMenu(cdp, 'deco-a', 'c-0001', 'whole', '03-attach-dialog-decor');
        assert(S(dialog.positions.map(p => p.label)) === S(['登場', '退場', '全体']) && dialog.position === 'whole', `装飾の位置 ${S(dialog)}`);
        const item = flatItems(await edit()).find(r => r.item.id === 'deco-a').item;
        assert(item.anchor?.caption === 'c-0001' && item.anchor.duration === 'caption', `anchor ${S(item.anchor)}`);
        assert(item.at === 0 && item.duration === 75, `at/duration ${item.at}/${item.duration}`);
        return { dialog, item };
    });

    // ===== 2. 保存 =====
    const openSave = async (id, prefix) => {
        await select(cdp, [id]);
        await evalOn(cdp, command('akari.inspector.open'));
        await sleep(1200);
        await waitFor('inspector shows the caption', () => evalOn(cdp, `(()=>{const h=document.querySelector('.akari-inspector-selection-header');return Boolean(h&&h.textContent.includes(${S(prefix)})&&h.querySelector('[data-akari-my-style-inspector-menu]'))})()`), 60_000);
        for (let attempt = 0; attempt < 6; attempt++) {
            await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
            const shown = await waitFor('menu item', () => evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-my-style-inspector-save]');return Boolean(s&&!s.hidden&&s.getBoundingClientRect().width>0)})()`), 5_000).catch(() => false);
            if (shown) break;
        }
        await clickSel(cdp, '[data-akari-my-style-inspector-save]');
        return waitFor('dialog', () => evalOn(cdp, DIALOG), 60_000);
    };
    const partsOf = dialog => Object.fromEntries(dialog.parts.map(p => [p.kind, p]));
    await check('保存ダイアログ（ひも付いた要素の無い c-0005）: 効果音・画面効果・装飾は無効 + 説明', async () => {
        const dialog = await openSave('c-0005', 'ここがいち');
        const p = partsOf(dialog);
        for (const k of ['sfx', 'fx', 'decor']) assert(p[k]?.disabled && !p[k].checked && /ありません/.test(p[k].label), `${k} ${S(p[k])}`);
        await key(cdp, 'Escape', 'Escape', 27);
        await sleep(800);
        return dialog;
    });
    await check('保存ダイアログ（c-0001）: 見た目・動き・効果音・装飾が有効で既定でチェック・画面効果は無効 + 説明', async () => {
        const dialog = await openSave('c-0001', '今日は朝の');
        const p = partsOf(dialog);
        for (const k of ['look', 'motion', 'sfx', 'decor']) assert(p[k]?.checked && !p[k].disabled, `${k} ${S(p[k])}`);
        assert(p.fx?.disabled && !p.fx.checked, `fx ${S(p.fx)}`);
        return dialog;
    });
    await typeInto(cdp, '[data-akari-my-style-name]', '登場でポンと鳴る枠つき');
    await typeInto(cdp, '[data-akari-my-style-when]', '大事な一言に音と枠を添えたいとき');
    await shot(cdp, '04-save-dialog');
    await check('保存 → style.json の parts = {look, motion, sfx, decor}（順不同）・sfx = 登場 / 素材 audio:sfx-pop・decor = 全体 / 素材 overlay:deco-frame・絶対パスなし', async () => {
        const before = Object.keys(await styleFiles(STYLES));
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(STYLES); return Object.keys(f).length > before.length ? f : null; });
        await waitFor('dialog closed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`)));
        styleId = Object.keys(files).find(id => !before.includes(id));
        const raw = files[styleId];
        const style = JSON.parse(raw);
        styleUid = style.uid;
        const kinds = style.parts.map(p => p.kind);
        assert(S([...kinds].sort()) === S(['decor', 'look', 'motion', 'sfx']) && kinds.length === 4, `parts ${S(kinds)}`);
        const sfx = style.parts.find(p => p.kind === 'sfx'), decor = style.parts.find(p => p.kind === 'decor');
        assert(sfx.mode === 'attach' && sfx.attach?.at === 'in' && sfx.attach.offset_frames === 0 && S(sfx.asset) === S({ category: 'audio', id: 'sfx-pop' }) && sfx.file === 'pop.wav', `sfx ${S(sfx)}`);
        assert(decor.mode === 'attach' && decor.attach?.at === 'whole' && S(decor.asset) === S({ category: 'overlay', id: 'deco-frame' }) && decor.file === 'deco.html', `decor ${S(decor)}`);
        assert(!ABS.test(raw), 'absolute path present');
        return { relativeFile: `styles/${styleId}/style.json`, style };
    });

    // ===== 3. B・C に当てる =====
    await openShelf(cdp);
    await sleep(1000);
    // r1: 棚のカードのチップ。当てられる部品（見た目・動き・効果音・装飾）に「（当てない）」を付けない
    await check('棚のカードの部品のチップ: 見た目・動き・効果音・装飾のどれにも「（当てない）」が付かない', async () => {
        const chips = await waitFor('shelf chips', () => evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-my-style-apply='+${S(S(styleId))}+']');if(!b)return null;let card=b;while(card&&!card.querySelector('[data-akari-my-style-part]'))card=card.parentElement;if(!card)return null;card.scrollIntoView({block:'center'});return [...card.querySelectorAll('[data-akari-my-style-part]')].map(e=>({kind:e.dataset.akariMyStylePart,text:e.textContent.trim(),opacity:getComputedStyle(e).opacity}))})()`), 15_000);
        await shot(cdp, '05a-shelf-chips');
        const kinds = chips.map(c => c.kind).sort();
        assert(S(kinds) === S(['decor', 'look', 'motion', 'sfx']), `chips ${S(chips)}`);
        assert(chips.every(c => !c.text.includes('当てない') && c.opacity === '1'), `chips ${S(chips)}`);
        return { chips };
    });
    const beforeApply = await both();
    let applied;
    await check('B・C（c-0002・c-0003）に当てる: 部品のチェック（見た目・動き・効果音・装飾が既定でチェック）→ captions.json + edit.json に印付きの効果音・装飾（B = 90 / C = 180 フレーム）・台帳 parts = {look, motion, sfx, decor}', async () => {
        applied = await applyStyle(cdp, styleId, ['c-0002', 'c-0003'], { shotName: '05-apply-popover' });
        const defaults = Object.fromEntries(applied.popover.inputs.map(i => [i.kind, i.checked && !i.disabled]));
        for (const k of ['look', 'motion', 'sfx', 'decor']) assert(defaults[k], `popover ${k} ${S(applied.popover.inputs)}`);
        assert(applied.popover.inputs.every(i => !i.label.includes('当てない')), `popover labels ${S(applied.popover.inputs)}`);
        assert(!applied.popover.emoji, 'emoji');
        const rows = await captions(), doc = await edit();
        const detail = {};
        for (const [id, start] of [['c-0002', 3], ['c-0003', 6]]) {
            assert(rows[id].text_style?.color === '#FFD400' && rows[id].text_style?.animation?.in?.id === 'fade-up', `${id} look/motion ${S(rows[id].text_style)}`);
            const marked = markedFor(doc, id);
            const sfx = marked.filter(r => r.lane === 'audio'), deco = marked.filter(r => r.lane === 'visual' && r.item.source?.kind === 'html');
            assert(marked.length === 2 && sfx.length === 1 && deco.length === 1, `${id} marked ${S(summary(marked))}`);
            assert(markOf(sfx[0].item).style_uid === styleUid && markOf(deco[0].item).style_uid === styleUid, 'style_uid');
            assert(sfx[0].item.anchor.caption === id && sfx[0].item.at === frame(start) && sfx[0].item.duration === 12 && (sfx[0].item.role ?? 'sfx') === 'sfx', `${id} sfx ${S(sfx[0].item)}`);
            assert(deco[0].item.anchor.caption === id && deco[0].item.at === frame(start) && deco[0].item.duration === frame(2.5), `${id} deco ${S(deco[0].item)}`);
            const src = doc.sources.find(s => s.id === sfx[0].item.source.src);
            assert(src?.path === 'assets/audio/sfx-pop/pop.wav', `sfx source ${S(src)}`);
            assert(deco[0].item.source.path === 'assets/overlay/deco-frame/deco.html', `deco path ${S(deco[0].item.source)}`);
            detail[id] = summary(marked);
        }
        for (const id of ['c-0001', 'c-0004', 'c-0005']) assert(markedFor(doc, id).length === 0, `${id} marked`);
        const refs = JSON.parse(await text('.akari/asset-references.json')).references;
        assert(refs.some(r => r.category === 'audio' && r.id === 'sfx-pop') && refs.some(r => r.category === 'overlay' && r.id === 'deco-frame'), `references ${S(refs)}`);
        assert(S(applied.usage.caption_ids) === S(['c-0002', 'c-0003']) && S([...applied.usage.parts].sort()) === S(['decor', 'look', 'motion', 'sfx']) && applied.usage.style_uid === styleUid, `usage ${S(applied.usage)}`);
        return { popover: applied.popover, marked: detail, usage: applied.usage };
    });
    await check('当てた直後の undo 1 回 → captions.json と edit.json が当てる前と byte 一致', async () => undoOnce(cdp, beforeApply, 'apply'));
    await check('当て直し → 同じ結果（1 回の書き込み）', async () => {
        const again = await applyStyle(cdp, styleId, ['c-0002', 'c-0003']);
        const doc = await edit();
        assert(markedFor(doc, 'c-0002').length === 2 && markedFor(doc, 'c-0003').length === 2, 'marked count');
        return { usage: again.usage };
    });
    await check('同じスタイルを B にもう一度当てる → 印付きの要素は置き換え（B = 効果音 1 + 装飾 1 のまま・C は不変・item 総数不変）', async () => {
        const docBefore = await edit();
        const totalBefore = flatItems(docBefore).length;
        const cBefore = S(summary(markedFor(docBefore, 'c-0003')));
        await applyStyle(cdp, styleId, ['c-0002']).catch(async error => {
            // 同じ値の再書き込みで captions.json が変わらない場合は edit.json の変化だけを待つ
            if (!/files written/.test(error.message)) throw error;
        });
        const doc = await edit();
        assert(markedFor(doc, 'c-0002').length === 2, `B marked ${S(summary(markedFor(doc, 'c-0002')))}`);
        assert(S(summary(markedFor(doc, 'c-0003'))) === cBefore, 'C changed');
        assert(flatItems(doc).length === totalBefore, `item 総数 ${totalBefore} → ${flatItems(doc).length}`);
        return { totalItems: flatItems(doc).length, b: summary(markedFor(doc, 'c-0002')) };
    });
    await sleep(1000);
    await ensureTimeline(cdp).catch(() => null);
    await shot(cdp, '06-applied-timeline');
    out.stripsApplied = await evalOn(cdp, TIMELINE_STRIPS);
    await check('タイムラインに印付きの効果音・装飾の帯が出る（B・C の分）', async () => {
        const doc = await edit();
        const ids = ['c-0002', 'c-0003'].flatMap(id => markedFor(doc, id).map(r => r.item.id));
        const strips = await evalOn(cdp, TIMELINE_STRIPS);
        for (const id of ids) assert(strips.some(s => s.id === id), `strip ${id} missing`);
        return strips.filter(s => ids.includes(s.id));
    });

    // ===== 4. 出力プレビュー: 装飾は字幕の間だけ =====
    await check('出力プレビュー: 装飾は字幕の間だけ見える（B の中 4.25 秒・C の中 7.25 秒は見える / 字幕の外 2.75 秒・9.5 秒は見えない）', async () => {
        const doc = await edit();
        const decoB = markedFor(doc, 'c-0002').find(r => r.lane === 'visual').item.id, decoC = markedFor(doc, 'c-0003').find(r => r.lane === 'visual').item.id;
        const got = await previewVisible(cdp, [4.25, 7.25, 2.75, 9.5]);
        assert(got[4.25].includes(decoB) && !got[4.25].includes(decoC), `4.25 ${S(got[4.25])}`);
        assert(got[7.25].includes(decoC) && !got[7.25].includes(decoB), `7.25 ${S(got[7.25])}`);
        assert(!got[2.75].includes(decoB) && !got[2.75].includes(decoC) && !got[9.5].includes(decoB) && !got[9.5].includes(decoC), `outside ${S(got)}`);
        return got;
    });
    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: 4.25 }));
    await sleep(2000);
    await shot(cdp, '07-preview-b');

    // ===== 5. B を動かす =====
    await ensureTimeline(cdp);
    const beforeMove = await both();
    await check('字幕 B をタイムラインで右へドラッグ → B の効果音・装飾も同じだけ動く（書き込み 1 回）', async () => {
        const chip = await chipOf(cdp, 'c-0002');
        const pxPerSec = chip.width / 2.5;
        await realClick(cdp, chip.x, chip.y);
        await sleep(600);
        const attempts = await dragUntilWritten(cdp, () => chipOf(cdp, 'c-0002'), pxPerSec);
        const rows = await captions(), doc = await edit();
        const b = rows['c-0002'];
        assert(b.start !== 3, `B not moved ${b.start}`);
        for (const r of markedFor(doc, 'c-0002')) {
            assert(r.item.at === frame(b.start), `${r.item.id} at ${r.item.at} != ${frame(b.start)}`);
            if (r.lane === 'visual') assert(r.item.duration === frame(b.end) - frame(b.start), `${r.item.id} duration ${r.item.duration}`);
        }
        const c3 = markedFor(doc, 'c-0003');
        assert(c3.every(r => r.item.at === 180), `C moved ${S(summary(c3))}`);
        return { attempts, b: [b.start, b.end], marked: summary(markedFor(doc, 'c-0002')) };
    });
    await ensureTimeline(cdp).catch(() => null);
    await shot(cdp, '08-moved-b');
    await check('B を動かした後の undo 1 回 → 2 ファイルとも動かす前と byte 一致', async () => undoOnce(cdp, beforeMove, 'move B'));

    // ===== 6. C を消す =====
    await ensureTimeline(cdp);
    const beforeDelete = await both();
    await check('字幕 C を選んで Delete → C の効果音・装飾も消える（B の分・A のひも付け・ほかの要素は残る）', async () => {
        const docBefore = await edit();
        const cIds = markedFor(docBefore, 'c-0003').map(r => r.item.id);
        const chip = await chipOf(cdp, 'c-0003');
        await realClick(cdp, chip.x, chip.y);
        await sleep(800);
        await key(cdp, 'Delete', 'Delete', 46);
        await waitFor('c-0003 removed', async () => !(await captions())['c-0003'], 30_000);
        await sleep(1500);
        const doc = await edit();
        const left = flatItems(doc).map(r => r.item.id);
        for (const id of cIds) assert(!left.includes(id), `${id} remains`);
        assert(markedFor(doc, 'c-0002').length === 2, 'B marked removed');
        for (const id of ['sfx-a', 'deco-a', 'cut-base']) assert(left.includes(id), `${id} removed`);
        const expected = flatItems(docBefore).map(r => r.item.id).filter(id => !cIds.includes(id));
        assert(S(left) === S(expected), `items ${S(left)} != ${S(expected)}`);
        return { removed: cIds, left };
    });
    await ensureTimeline(cdp).catch(() => null);
    await shot(cdp, '09-deleted-c');
    await check('C を消した後の undo 1 回 → 2 ファイルとも消す前と byte 一致（C・効果音・装飾が戻る）', async () => undoOnce(cdp, beforeDelete, 'delete C'));

    // ===== 7. 手で動かす =====
    await ensureTimeline(cdp);
    const beforeHand = await both();
    await check('印付きの装飾（B の分）を手でドラッグ → anchor と印が外れ普通の要素になる', async () => {
        const decoB = markedFor(await edit(), 'c-0002').find(r => r.lane === 'visual').item.id;
        const strip = await stripOf(cdp, decoB);
        const pxPerSec = strip.width / 2.5;
        await realClick(cdp, strip.x, strip.y);
        await sleep(600);
        // 同じ段に C の装飾（180 フレーム〜）があるので、重ならない 0.3 秒だけ動かす
        const attempts = await dragUntilWritten(cdp, () => stripOf(cdp, decoB), pxPerSec * 0.3);
        const item = flatItems(await edit()).find(r => r.item.id === decoB).item;
        assert(item.anchor === undefined && item.attached_by === undefined, `still anchored ${S(item)}`);
        assert(item.at !== 90, `not moved ${item.at}`);
        return { attempts, item };
    });
    await check('手で動かした後の undo 1 回 → byte 一致', async () => undoOnce(cdp, beforeHand, 'hand move marked'));
    await ensureTimeline(cdp);
    const beforeHand2 = await both();
    await check('印の無いアンカー要素（「字幕にひも付ける」で作った deco-a）を手でドラッグ → anchor は残る（基点と同じ挙動）', async () => {
        const strip = await stripOf(cdp, 'deco-a');
        const pxPerSec = strip.width / 2.5;
        await realClick(cdp, strip.x, strip.y);
        await sleep(600);
        const attempts = await dragUntilWritten(cdp, () => stripOf(cdp, 'deco-a'), pxPerSec * 0.3);
        const item = flatItems(await edit()).find(r => r.item.id === 'deco-a').item;
        assert(item.anchor?.caption === 'c-0001', `anchor removed ${S(item)}`);
        return { attempts, item };
    });
    await check('印の無い要素を動かした後の undo 1 回 → byte 一致', async () => undoOnce(cdp, beforeHand2, 'hand move unmarked'));

    // ===== 8. 書き出し用に B を動かした状態を作る =====
    await ensureTimeline(cdp);
    await check('書き出し用: B を右へ動かす（効果音・装飾が追従）', async () => {
        const chip = await chipOf(cdp, 'c-0002');
        await realClick(cdp, chip.x, chip.y);
        await sleep(600);
        await dragUntilWritten(cdp, () => chipOf(cdp, 'c-0002'), chip.width / 2.5);
        const rows = await captions(), doc = await edit();
        for (const r of markedFor(doc, 'c-0002')) assert(r.item.at === frame(rows['c-0002'].start), `${r.item.id} at`);
        finalState = { captions: Object.fromEntries(Object.values(rows).map(c => [c.id, [c.start, c.end]])), marked: Object.fromEntries(['c-0001', 'c-0002', 'c-0003'].map(id => [id, summary(markedFor(doc, id))])) };
        return finalState;
    });
    await check('edit-lint（書き出し前の検査）: エラーなし・v2.item-anchor-stale なし', async () => {
        const r = spawnSync(process.execPath, [path.join(REPO, 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'), PJ, '--json'], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home') } });
        let report; try { report = JSON.parse(r.stdout); } catch { report = { raw: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 2000) }; }
        const findings = S(report);
        assert(!/item-anchor-stale/.test(findings), 'anchor stale');
        assert(r.status === 0, `edit-lint exit ${r.status}: ${findings.slice(0, 600)}`);
        return { exit: r.status, summary: report.summary ?? report.pass ?? null };
    });
    out.notices = await evalOn(cdp, NOTICE).catch(() => []);
} catch (error) {
    out.fatal = sanitize(error, REPO).replaceAll(WORK, '<work>');
    console.log(`FATAL ${out.fatal}`);
    try { await shot(session.cdp, '99-error'); } catch {}
} finally {
    await stop(session);
    await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`);
}

// 書き出した動画の測り方（r0 と同じ）: 音の立ち上がり = A・B・C の字幕の頭 / 装飾の枠の色 = 字幕の間だけ
function measureExport(exported) {
    // 音: 1/30 秒ごとの RMS（-45 dB を超えたところを立ち上がりとする）
    const a = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', exported, '-af', 'asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const lines = a.stdout.split('\n');
    const levels = [];
    for (let i = 0; i < lines.length; i++) {
        const t = /pts_time:([\d.]+)/.exec(lines[i]);
        const v = t && /RMS_level=(-?[\d.]+|-inf)/.exec(lines[i + 1] ?? '');
        if (t && v) levels.push({ t: Number(t[1]), db: v[1] === '-inf' ? -200 : Number(v[1]) });
    }
    const onsets = levels.filter((x, i) => x.db > -45 && (i === 0 || levels[i - 1].db <= -45)).map(x => Math.round(x.t * 1000) / 1000);
    const starts = ['c-0001', 'c-0002', 'c-0003'].map(id => finalState.captions[id][0]);
    assert(onsets.length === 3 && starts.every((s, i) => Math.abs(onsets[i] - s) <= 0.05), `onsets ${S(onsets)} vs caption starts ${S(starts)}`);
    // 装飾: 枠の左の線（x=54, y=90）の色（yuv420p なので 2×2 で切り出して左上の画素を読む）
    const pixel = t => { const p = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(t), '-i', exported, '-frames:v', '1', '-vf', 'crop=2:2:54:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 }); return [...p.stdout].slice(0, 3); };
    const pink = rgb => rgb[0] > 190 && rgb[1] < 130 && rgb[2] > 80;
    const mid = id => (finalState.captions[id][0] + finalState.captions[id][1]) / 2;
    const probes = { A: mid('c-0001'), B: mid('c-0002'), C: mid('c-0003'), 'gap-after-A': (finalState.captions['c-0001'][1] + finalState.captions['c-0002'][0]) / 2, 'after-C': finalState.captions['c-0003'][1] + 0.5 };
    const colors = Object.fromEntries(Object.entries(probes).map(([k, t]) => [k, { t, rgb: pixel(t) }]));
    for (const k of ['A', 'B', 'C']) assert(pink(colors[k].rgb), `${k} deco not visible ${S(colors[k])}`);
    for (const k of ['gap-after-A', 'after-C']) assert(!pink(colors[k].rgb), `${k} deco visible ${S(colors[k])}`);
    return { onsets, colors };
}

// ===== 9. 書き出し（render-cut）→ 音の立ち上がりと装飾の色 =====
if (finalState) {
    const exported = path.join(PJ, 'exports', 'attach-parts.mp4'); // 出力はプロジェクト内に限る（render-cut の制約）
    await mkdir(path.dirname(exported), { recursive: true });
    const renderEnv = { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home') };
    const tail = r => (r.stderr || r.stdout || '').trim().split('\n').slice(-3).map(l => l.replaceAll(PJ, '<ws>').replaceAll(REPO, '<worktree>'));
    // r1: 参照のまま（素材をまとめずに）。render-cut の html 読み込み（loadOverlays）は参照台帳でライブラリの実体を読む
    await check('参照のまま（素材をまとめずに）render-cut --plan-only: html の読み込みで止まらない（exit 0）', async () => {
        const r = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), PJ, '--plan-only', '--force'], { cwd: REPO, encoding: 'utf8', env: renderEnv });
        assert(r.status === 0, `plan-only exit ${r.status}: ${S(tail(r))}`);
        return { exit: r.status, tail: tail(r) };
    });
    // r2: 参照のまま（素材をまとめずに）gpu と osr の両方で書き出し、r0 と同じ測り方（音の立ち上がり・装飾の枠の色）で確かめる。
    //     GPU / OSR の page-builder（別の Electron プロセス）も html と fragment の参照を参照台帳でライブラリの実体へ解決する
    for (const engine of ['gpu', 'osr']) {
        const referenceOnlyOut = path.join(PJ, 'exports', `attach-parts-reference-only-${engine}.mp4`);
        await check(`参照のまま（素材をまとめずに）render-cut --engine ${engine}: exit 0・効果音の立ち上がり = A・B・C の字幕の頭 / 装飾 = 字幕の間だけ`, async () => {
            await rm(referenceOnlyOut, { force: true });
            const started = Date.now();
            const r = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), PJ, '--engine', engine, '--out', referenceOnlyOut, '--force'], { cwd: REPO, encoding: 'utf8', env: renderEnv, timeout: 1_800_000 });
            const at = [...(r.stderr || '').matchAll(/packages\/[a-z-]+\/src\/[a-z-]+\.mjs:\d+/g)].map(m => m[0]);
            assert(r.status === 0, `render-cut exit ${r.status}: ${S(tail(r))} at ${S([...new Set(at)])}`);
            const references = JSON.parse(await text('.akari/asset-references.json')).references.map(x => `${x.category}:${x.id}`);
            const inProject = ['assets/overlay/deco-frame/deco.html', 'assets/audio/sfx-pop/pop.wav'].filter(file => { try { return spawnSync('/bin/test', ['-e', path.join(PJ, file)]).status === 0; } catch { return false; } });
            assert(inProject.length === 0, `参照のままではない（プロジェクトに実体がある）: ${S(inProject)}`);
            // 指定した出口で書き出したこと（gpu が落ちて osr へ回った場合は adopted が osr になる）
            const rasterizer = JSON.parse(await text('.akari/render.json')).provenance?.rasterizer ?? null;
            assert(rasterizer?.adopted === engine, `adopted ${S(rasterizer)}`);
            return { exit: r.status, seconds: Math.round((Date.now() - started) / 1000), rasterizer, references, ...measureExport(referenceOnlyOut), renderTail: (r.stdout || '').split('\n').filter(line => /^(PASS|FAIL)/.test(line)).map(line => line.replaceAll(PJ, '<ws>')) };
        });
    }
    await check('書き出し（「素材をまとめる」→ render-cut）: 効果音の立ち上がり = A・B・C の字幕の頭 / 装飾（枠の色）= 字幕の間だけ', async () => {
        await rm(exported, { force: true });
        const env = { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home') };
        // r0: 参照のままでは書き出しが html の読み込みで止まったので、既存の「素材をまとめる」で参照を実体化してから書き出す（r1 も比較のため残す）
        const referenceOnly = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), PJ, '--plan-only', '--force'], { cwd: REPO, encoding: 'utf8', env });
        const bundled = spawnSync(process.execPath, [path.join(REPO, 'packages', 'asset-resolver', 'bin', 'akari-assets.mjs'), 'bundle', '--project', PJ], { cwd: REPO, encoding: 'utf8', env });
        assert(bundled.status === 0, `bundle exit ${bundled.status}: ${(bundled.stderr || bundled.stdout).slice(-800)}`);
        const lint = spawnSync(process.execPath, [path.join(REPO, 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'), PJ, '--json'], { encoding: 'utf8', env });
        const r = spawnSync(process.execPath, [path.join(REPO, 'packages', 'render-cut', 'bin', 'render-cut.mjs'), PJ, '--out', exported, '--force'],
            { cwd: REPO, encoding: 'utf8', env: { ...process.env, AKARI_HOME: path.join(ISO, 'akari-home') }, timeout: 1_800_000 });
        assert(r.status === 0, `render-cut exit ${r.status}: ${(r.stderr || r.stdout).slice(-1500)}`);
        const { onsets, colors } = measureExport(exported);
        return { captions: finalState.captions, onsets, colors, referenceOnlyPlan: { exit: referenceOnly.status, error: (referenceOnly.stderr || referenceOnly.stdout).trim().split('\n').at(-1)?.replaceAll(PJ, '<ws>') },
            bundle: (bundled.stdout || '').trim().split('\n').slice(-2), lintExit: lint.status, renderTail: (r.stdout || '').split('\n').filter(Boolean).slice(-3) };
    });
}
await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`);
const failed = out.checks.filter(c => !c.pass).length;
console.log(S({ pass: out.checks.length - failed, total: out.checks.length, fatal: out.fatal ?? null }));
