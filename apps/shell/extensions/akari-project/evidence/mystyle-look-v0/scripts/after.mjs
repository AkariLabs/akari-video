#!/usr/bin/env node
// マイスタイル v0 の AFTER（L1・受け入れ条件の判定つき）。ラッパー作成の検証スクリプト。
// 使い方: node after.mjs <作業用ディレクトリ（実体パス）>   （fixture = <作業用>/fixture/spoken・vertical・horizontal。CDP_PORT 既定 9485）
// r1: 保存形（schema akari-style + version 1 + revision + uid・license オブジェクト・reference_height_px）・部品単位の置換・
//     style_preset を外す・利用台帳（.akari/style-usage.json）・縦（1080×1920）で保存 → 横（1920×1080）へ当てる、を判定に追加。
// 流れ: 保存（インスペクターの ⋯）→ 棚 → 3 本に当てる → undo 1 回 → ＋ / ドラッグで置く → 名前の変更 →
//       motion 入りの style.json を手で足す → 起動し直す → 残っている・motion 入りを当てる → ミニパネルから保存 → 削除。
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalOn, realClick, screenshot } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop, waitEval } from './l1-lib.mjs';
import { openProject } from './l1-common.mjs';
import { prepareLibrary } from './library-home.mjs';
import { PLATE_CENTER, TOOLS, calibrate, toPage, view } from './view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9485);
const PJ = path.join(WORK, 'ws');
const ISO = path.join(WORK, 'iso');
const LIBRARY = path.join(WORK, 'creator', 'library');
const STYLES = path.join(LIBRARY, 'styles');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const S = JSON.stringify;
const out = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [], screenshots: [] };
const RESULTS = path.join(OUT, 'results-after.json');
const POSITION_KEYS = ['text_anchor', 'position', 'zone', 'textAnchor'];
const ABS = /(^|["'\s])(\/(Users|private|tmp|var|home|Volumes)\/|[A-Za-z]:\\|\\\\|file:\/\/|~\/)/;
const SOURCE_LOOK = { color: '#FFD400', size_px: 52, font_weight: 900, stroke: { color: '#D12B2B', width_px: 5 },
    background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
    shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 },
    glow: { color: '#000000', density: 0 }, reference_height_px: 720 };
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const usage = async project => { try { return JSON.parse(await readFile(path.join(project, '.akari', 'style-usage.json'), 'utf8')); } catch { return null; } };

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO).replaceAll(WORK, '<work>'); }
    finally { await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`); }
    console.log(`${record.pass ? 'PASS' : 'FAIL'} ${name}${record.error ? ` — ${record.error.slice(0, 300)}` : ''}`);
    return record.detail;
}
const scrub = value => JSON.parse(S(value).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>'));
async function shot(cdp, name) {
    await sleep(500);
    const raw = path.join(WORK, `${name}.png`);
    await screenshot(cdp, raw);
    execFileSync('sips', ['-Z', '1440', raw, '--out', path.join(OUT, `after-${name}.png`)], { stdio: 'ignore' });
    out.screenshots.push(`after-${name}.png`);
}
const captionsText = () => readFile(path.join(PROJECT, 'captions.json'), 'utf8');
const captions = async () => JSON.parse(await captionsText()).captions;
const row = async id => (await captions()).find(c => c.id === id);
const headCaptions = () => execFileSync('/usr/bin/git', ['show', 'HEAD:captions.json'], { cwd: PJ, encoding: 'utf8' });
let PROJECT = PJ;
const editUri = () => `file://${path.join(PJ, 'edit.json')}`;
async function waitFor(label, fn, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(200); }
    throw new Error(`${label} not reached${last ? `: ${last.message}` : ''}`);
}
const center = async (cdp, selector) => waitFor(`${selector} visible`, () => evalOn(cdp, `(()=>{const e=document.querySelector(${S(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width>0&&r.height>0?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`));
const clickSel = async (cdp, selector) => { const p = await center(cdp, selector); await realClick(cdp, p.x, p.y); await sleep(400); return p; };
async function typeInto(cdp, selector, text) {
    await clickSel(cdp, selector);
    const k = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, commands: ['selectAll'] }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    await cdp.send('Input.insertText', { text }); await sleep(150);
}
async function key(cdp, keyName, code, keyCode, modifiers = 0) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, modifiers });
}
async function undoOnce(cdp) {
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    let equal = false;
    const original = await readFile(path.join(WORK, 'fixture', path.basename(PROJECT) === 'ws' ? 'spoken' : path.basename(PROJECT), 'captions.json'), 'utf8');
    const now = () => readFile(path.join(PROJECT, 'captions.json'), 'utf8');
    for (let i = 0; i < 24 && !equal; i++) { await sleep(250); equal = (await now()) === original; }
    await sleep(800);
    return { captionsEqualHead: (await now()) === original, gitStatus: execFileSync('/usr/bin/git', ['status', '--porcelain', '--', 'captions.json', 'edit.json'], { cwd: PROJECT, encoding: 'utf8' }) };
}
const select = (cdp, ids) => evalOn(cdp, command('akari.timeline.selectCaptions', { editUri: `file://${path.join(PROJECT, 'edit.json')}`, captionIds: ids }));
const NOTICE = `[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&e.getBoundingClientRect().width>0&&/マイスタイル|v0|当てません|当てました|未対応/.test(e.textContent)&&e.textContent.length<140&&!e.closest('[data-akari-my-style-shelf],[data-akari-my-style-dialog]')&&!(e.style.height==='26px'&&e.style.fontSize==='11px')).map(e=>e.textContent.trim())`;
async function styleFiles() {
    let ids = [];
    try { ids = (await readdir(STYLES, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch {}
    const files = {};
    for (const id of ids) { try { files[id] = await readFile(path.join(STYLES, id, 'style.json'), 'utf8'); } catch {} }
    return files;
}
function deepKeys(value, acc = []) {
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { acc.push(k); deepKeys(v, acc); }
    return acc;
}
const pick = (look, keys) => Object.fromEntries(keys.map(k => [k, look?.[k]]));
const LOOK_KEYS = ['color', 'size_px', 'font_weight', 'stroke', 'background', 'shadow', 'glow', 'reference_height_px'];
async function openShelf(cdp) {
    await evalOn(cdp, `(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close, .theia-notification-list-item [title]').forEach(e=>{if(/close/.test(e.className))e.click()});return true})()`).catch(() => {});
    const tab = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='ライブラリ'&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top<80);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (tab) { await realClick(cdp, tab.x, tab.y); await sleep(1500); }
    const back = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (back) { await realClick(cdp, back.x, back.y); await sleep(800); }
    const det = await evalOn(cdp, `(()=>{const b=document.querySelector('[data-akari-library-details-toggle]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,expanded:b.getAttribute('aria-expanded')}})()`);
    if (det && det.expanded !== 'true') { await realClick(cdp, det.x, det.y); await sleep(800); }
    await clickSel(cdp, '[data-akari-library-category=textstyle]');
    await sleep(1500);
}
const SHELF = `(()=>{const s=document.querySelector('[data-akari-my-style-shelf]');if(!s)return null;const px=v=>Math.round(v*10)/10;const r=s.getBoundingClientRect();return{rect:{x:px(r.left),y:px(r.top),w:px(r.width),h:px(r.height)},cards:[...s.querySelectorAll('[data-akari-my-style-card]')].map(c=>{const cr=c.getBoundingClientRect();const btns=[...c.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);const tops=new Set(btns.map(b=>Math.round(b.getBoundingClientRect().top)));return{id:c.getAttribute('data-akari-my-style-card'),rect:{w:px(cr.width),h:px(cr.height)},draggable:c.getAttribute('draggable'),badge:c.querySelector('[data-akari-my-style-badge]')?.textContent?.trim()??null,parts:[...c.querySelectorAll('[data-akari-my-style-part]')].map(p=>({kind:p.getAttribute('data-akari-my-style-part'),label:p.textContent.trim()})),text:c.innerText.replace(/\\n+/g,' / ').slice(0,200),buttons:btns.map(b=>({aria:b.getAttribute('aria-label'),text:b.textContent.trim().slice(0,20),w:px(b.getBoundingClientRect().width),h:px(b.getBoundingClientRect().height)})),buttonRows:tops.size}})}})()`;

async function preparedLaunch() {
    return launch({ shellDir: SHELL, electron: ELECTRON, project: PJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
}
// 起動直後の通知（プロジェクトとして使うかの確認・置き場の移動のお知らせ）はタイムラインの上に重なって
// ドロップを奪うので閉じる（確認は「開くだけ」= 何も作らない方）。
async function dismissToasts(cdp) {
    await sleep(1500);
    await evalOn(cdp, `(()=>{let n=0;for(const i of document.querySelectorAll('.theia-notification-list-item')){const b=[...i.querySelectorAll('button')].find(b=>b.textContent.trim()==='開くだけ');if(b){b.click();n++;continue}i.querySelector('.codicon-close')?.click();n++}return n})()`);
    await sleep(800);
}
async function setupWindow(cdp) {
    await evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).resize(360,'right');return true})()`);
    await sleep(800);
    await dismissToasts(cdp);
}
// タイムラインを縦に広げて（プレビューとのスプリッターを上げる）縦スクロールを上端に戻す（狭いと字幕行が見える範囲の外に出る）。
async function widenTimeline(cdp) {
    const h = await evalOn(cdp, `(()=>{const h=[...document.querySelectorAll('.lm-SplitPanel-handle')].find(h=>h.parentElement.dataset.orientation==='vertical'&&h.getBoundingClientRect().width>300);if(!h)return null;const r=h.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    if (h && h.y > 320) { const { realDrag } = await import('./cdp-lib.mjs'); await realDrag(cdp, [h, { x: h.x, y: 300 }], { steps: 10 }); await sleep(1500); }
    await evalOn(cdp, `(()=>{const e=document.querySelector('.akari-timeline-scroll');if(e){e.scrollTop=0;e.dispatchEvent(new Event('scroll'))}return true})()`);
    await sleep(600);
}

await rm(PJ, { recursive: true, force: true });
await rm(path.join(WORK, 'creator'), { recursive: true, force: true });
await mkdir(LIBRARY, { recursive: true });
await cp(path.join(WORK, 'fixture', 'spoken'), PJ, { recursive: true });
process.chdir(REPO);
let session = await preparedLaunch();
let styleId, presetStyleId;
try {
    let cdp = session.cdp;
    await openProject(session, PJ, 1, PORT);
    await setupWindow(cdp);
    out.window = await evalOn(cdp, '({w:innerWidth,h:innerHeight})');

    // ===== 1. 保存（インスペクターの見出し帯の ⋯）=====
    await check('インスペクター: 字幕の見出し帯の右端に ⋯（見出しの高さは BEFORE と同じ 60px・即時の説明）', async () => {
        await select(cdp, ['c-0001']);
        await evalOn(cdp, command('akari.inspector.open'));
        await sleep(1200);
        const m = await evalOn(cdp, `(()=>{const h=document.querySelector('.akari-inspector-selection-header');const b=h?.querySelector('[data-akari-my-style-inspector-menu]');if(!b)return null;const hr=h.getBoundingClientRect(),br=b.getBoundingClientRect();const t=h.querySelector('.akari-inspector-selection-title, [class*=title]')?.getBoundingClientRect();return{header:{w:hr.width,h:hr.height,right:hr.right},button:{x:br.left,y:br.top,w:br.width,h:br.height,right:br.right},titleTop:t?.top??null,hasTitleAttr:b.hasAttribute('title'),aria:b.getAttribute('aria-label'),emoji:/[\\p{Extended_Pictographic}]/u.test(b.textContent)}})()`);
        assert(m, 'no ⋯ button');
        const p = { x: m.button.x + m.button.w / 2, y: m.button.y + m.button.h / 2 };
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
        const t0 = Date.now(); let tip = null;
        while (Date.now() - t0 < 1000) { tip = await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-my-style-inspector-tip]');if(!t)return null;const cs=getComputedStyle(t);return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0?t.textContent.trim():null})()`); if (tip) break; await sleep(25); }
        m.tooltip = { text: tip, ms: Date.now() - t0 };
        assert(Math.abs(m.header.h - 60) <= 1, `header height ${m.header.h}`);
        assert(m.header.right - m.button.right < 24, `⋯ not at right end (${m.header.right - m.button.right}px)`);
        assert(tip && m.tooltip.ms <= 200, `tooltip ${S(m.tooltip)}`);
        assert(!m.emoji, 'emoji');
        return m;
    });
    await shot(cdp, '01-inspector-header');
    await check('⋯ → 「マイスタイルに保存…」→ ダイアログ（見た目だけ有効・動き / 効果音 / 画面効果 / 装飾は近日で無効）', async () => {
        await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
        await sleep(400);
        const menu = await evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-my-style-inspector-save]');if(!s||s.hidden)return null;const r=s.getBoundingClientRect();return{text:s.textContent.trim(),w:r.width,h:r.height}})()`);
        assert(menu, 'menu item not shown');
        await shot(cdp, '02-inspector-menu');
        await clickSel(cdp, '[data-akari-my-style-inspector-save]');
        const dialog = await waitFor('dialog', () => evalOn(cdp, `(()=>{const d=document.querySelector('[data-akari-my-style-dialog]');if(!d)return null;return{text:d.innerText.replace(/\\n+/g,' / '),name:d.querySelector('[data-akari-my-style-name]')?.value,parts:[...d.querySelectorAll('[data-akari-my-style-part-input]')].map(i=>({kind:i.getAttribute('data-akari-my-style-part-input'),checked:i.checked,disabled:i.disabled,label:i.closest('label')?.textContent.trim()}))}})()`));
        const parts = Object.fromEntries(dialog.parts.map(p => [p.kind, p]));
        assert(parts.look?.checked && !parts.look.disabled, 'look not enabled');
        for (const k of ['motion', 'sfx', 'fx', 'decor']) assert(parts[k]?.disabled && /近日/.test(parts[k].label), `${k} not disabled/近日`);
        return { menu, dialog };
    });
    await typeInto(cdp, '[data-akari-my-style-name]', '強調テロップ');
    await typeInto(cdp, '[data-akari-my-style-when]', '驚きや大事な一言を目立たせたいとき');
    await shot(cdp, '03-save-dialog');
    await check('保存 → ライブラリの styles/<id>/style.json（形・位置なし・絶対パスなし・実効の見た目）', async () => {
        const before = Object.keys(await styleFiles());
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(); return Object.keys(f).length > before.length ? f : null; });
        await waitFor('dialog closed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`)));
        styleId = Object.keys(files).find(id => !before.includes(id));
        const text = files[styleId];
        const style = JSON.parse(text);
        const look = style.parts.find(p => p.kind === 'look')?.text_style;
        assert(style.schema === 'akari-style' && style.id === styleId && style.name === '強調テロップ' && style.when_to_use === '驚きや大事な一言を目立たせたいとき', `header ${text.slice(0, 200)}`);
        assert(style.version === 1 && style.revision === 1 && ULID.test(style.uid) && style.created_at && style.updated_at, 'version/revision/uid/dates');
        assert(style.license && typeof style.license === 'object' && typeof style.license.spdx === 'string' && style.visibility === 'private' && style.price === null && Array.isArray(style.requires) && Array.isArray(style.tags) && style.provenance && typeof style.provenance === 'object', `lab fields ${S({ license: style.license, visibility: style.visibility, price: style.price })}`);
        assert(style.parts.length === 1 && style.parts[0].kind === 'look' && style.parts[0].scope === 'caption' && style.parts[0].mode === 'modify', `parts ${S(style.parts.map(p => [p.kind, p.scope, p.mode]))}`);
        assert(!('applies_to' in style), 'applies_to is written');
        assert(!deepKeys(style).some(k => POSITION_KEYS.includes(k) || k === 'animation' || k === 'layout'), 'position / animation / layout key present');
        assert(!ABS.test(text), 'absolute path present');
        for (const k of LOOK_KEYS) assert(S(look[k]) === S(SOURCE_LOOK[k]), `${k}: ${S(look[k])} != ${S(SOURCE_LOOK[k])}`);
        return { relativeFile: `styles/${styleId}/style.json`, style };
    });
    await check('保存: style_preset 付きの字幕（c-0005 = subtitle-variety）の見た目にプリセットの値が入る', async () => {
        await select(cdp, ['c-0005']);
        await sleep(1000);
        await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
        await clickSel(cdp, '[data-akari-my-style-inspector-save]');
        await waitFor('dialog', () => evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`));
        await typeInto(cdp, '[data-akari-my-style-name]', 'バラエティ由来');
        await typeInto(cdp, '[data-akari-my-style-when]', 'バラエティ番組風に盛り上げたいとき');
        const before = Object.keys(await styleFiles());
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(); return Object.keys(f).length > before.length ? f : null; });
        presetStyleId = Object.keys(files).find(id => !before.includes(id));
        const look = JSON.parse(files[presetStyleId]).parts[0].text_style;
        const preset = JSON.parse(await readFile(path.join(REPO, 'presets', 'textstyle', 'subtitle-variety.json'), 'utf8')).style;
        assert(String(look.color).toLowerCase() === preset.color.toLowerCase(), `color ${look.color} vs ${preset.color}`);
        assert(look.size_px === preset.size_px, `size ${look.size_px} vs ${preset.size_px}`);
        assert(String(look.stroke?.color).toLowerCase() === preset.stroke.color.toLowerCase() && look.stroke?.width_px === preset.stroke.width_px, `stroke ${S(look.stroke)} vs ${S(preset.stroke)}`);
        return { look, preset };
    });

    // ===== 2. ライブラリの棚 =====
    await openShelf(cdp);
    await check('棚: テキストスタイルの棚にマイスタイル（札・部品のチップ = 見た目・名前・使いどころ）が同梱のテキストスタイルと並ぶ・崩れない', async () => {
        const shelf = await evalOn(cdp, SHELF);
        const builtIn = await evalOn(cdp, `document.querySelectorAll('[data-akari-catalog-preset-item^="textstyle/"]').length`);
        assert(shelf && builtIn === 12, `shelf ${S(shelf)} builtIn ${builtIn}`);
        const card = shelf.cards.find(c => c.id === styleId);
        assert(card, 'card missing');
        assert(card.badge === 'マイスタイル', `badge ${card.badge}`);
        assert(card.parts.length === 1 && card.parts[0].kind === 'look' && card.parts[0].label === '見た目', `parts ${S(card.parts)}`);
        assert(/強調テロップ/.test(card.text) && /驚きや大事な一言/.test(card.text), `text ${card.text}`);
        assert(card.buttonRows === 1, `buttons wrap into ${card.buttonRows} rows`);
        for (const b of card.buttons) assert(b.h <= 32, `button too tall ${S(b)}`);
        assert(card.draggable === 'true', 'not draggable');
        return { builtIn, shelf };
    });
    await shot(cdp, '04-library-shelf');

    // ===== 3. 3 本に当てる → undo 1 回 =====
    await check('当てる: 字幕 3 本（c-0002〜c-0004）を選んで当てる → 3 本とも同じ見た目・位置は変わらない', async () => {
        const before = Object.fromEntries((await captions()).map(c => [c.id, c.text_style ?? null]));
        await select(cdp, ['c-0002', 'c-0003', 'c-0004']);
        await sleep(800);
        await clickSel(cdp, `[data-akari-my-style-apply=${S(styleId)}]`);
        await waitFor('captions written', async () => (await captionsText()) !== headCaptions());
        await sleep(1200);
        const rows = Object.fromEntries((await captions()).map(c => [c.id, c.text_style ?? null]));
        for (const id of ['c-0002', 'c-0003', 'c-0004']) {
            for (const k of LOOK_KEYS) assert(S(rows[id]?.[k]) === S(SOURCE_LOOK[k]), `${id}.${k} ${S(rows[id]?.[k])}`);
            for (const k of POSITION_KEYS) assert(S(rows[id]?.[k]) === S(before[id]?.[k]), `${id}.${k} changed ${S(before[id]?.[k])} -> ${S(rows[id]?.[k])}`);
            assert(rows[id]?.animation === undefined, `${id} animation written`);
        }
        assert(S(rows['c-0001']) === S(before['c-0001']) && S(rows['c-0005']) === S(before['c-0005']), 'unselected captions changed');
        const notices = await evalOn(cdp, NOTICE);
        const ledger = await waitFor('usage appended', async () => { const u = await usage(PJ); return u?.entries?.length ? u : null; }, 10_000);
        const saved = JSON.parse((await styleFiles())[styleId]);
        const last = ledger.entries.at(-1);
        assert(S(last.caption_ids) === S(['c-0002', 'c-0003', 'c-0004']) && last.style_uid === saved.uid && last.revision === saved.revision && S(last.parts) === S(['look']) && last.applied_at, `usage ${S(last)}`);
        return { before: pick(before, ['c-0002', 'c-0003', 'c-0004']), after: pick(rows, ['c-0002', 'c-0003', 'c-0004']), notices, usage: ledger };
    });
    await check('当てる: 出力プレビューで 3 本の見た目（文字色・縁取り・座布団・影・大きさ）が保存元 c-0001 と同じ', async () => {
        const v = await view(PORT);
        // 「無し」の glow（density 0）は透明な影の層（rgba(…, 0)）として描かれ、目には見えない。比べるのは見える層だけ（生の値も記録する）。
        const STYLE = id => `(()=>{const visibleShadow=v=>v==='none'?v:v.split(/,(?![^(]*\\))/).map(x=>x.trim()).filter(x=>!/rgba\\([^)]*,\\s*0\\)/.test(x)).join(', ')||'none';const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p;const b=p.querySelector('.akari-caption__block')||l;const cs=getComputedStyle(l),bs=getComputedStyle(b);return{color:cs.color,fontSize:cs.fontSize,fontWeight:cs.fontWeight,stroke:cs.webkitTextStrokeColor+' '+cs.webkitTextStrokeWidth,textShadow:visibleShadow(cs.textShadow),background:bs.backgroundColor,radius:bs.borderTopLeftRadius}})()`;
        // 書き込み直後はプレビューの再読込が追いつかないことがあるので、c-0001 と一致するまで最大 15 秒待ち、待った時間も記録する。
        const got = {}, waitedMs = {};
        for (const [id, t] of [['c-0001', 1], ['c-0002', 4], ['c-0003', 7], ['c-0004', 10]]) {
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), time: t }));
            const t0 = Date.now();
            got[id] = await waitFor(`plate ${id}`, () => v.eval(STYLE(id)), 20_000);
            if (id !== 'c-0001') {
                const deadline = Date.now() + 15_000;
                while (S(got[id]) !== S(got['c-0001']) && Date.now() < deadline) { await sleep(250); got[id] = await v.eval(STYLE(id)) ?? got[id]; }
            }
            waitedMs[id] = Date.now() - t0;
            if (id === 'c-0003') await shot(cdp, '05-applied-preview');
        }
        const rawTextShadow = {};
        for (const [id, t] of [['c-0001', 1], ['c-0002', 4]]) {
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), time: t }));
            await sleep(800);
            rawTextShadow[id] = await v.eval(`(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));const l=p?.querySelector('.akari-caption__line')||p;return l?getComputedStyle(l).textShadow:null})()`);
        }
        v.close();
        for (const id of ['c-0002', 'c-0003', 'c-0004']) assert(S(got[id]) === S(got['c-0001']), `${id} ${S(got[id])} != c-0001 ${S(got['c-0001'])}`);
        return { styles: got, waitedMs, rawTextShadow };
    });
    await check('当てる: Cmd+Z 1 回で 3 本とも戻る（captions.json が fixture と byte 一致）', async () => {
        const r = await undoOnce(cdp);
        assert(r.captionsEqualHead && r.gitStatus === '', S(r));
        return r;
    });

    // ===== 4. ＋ / ドラッグで置いた文字として置く =====
    await check('＋: プレイヘッド 5 秒で ＋ → 置いた文字に保存した見た目・Cmd+Z 1 回で戻る', async () => {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), time: 5 }));
        await sleep(1500);
        const ids = new Set((await captions()).map(c => c.id));
        await clickSel(cdp, `[data-akari-my-style-add=${S(styleId)}]`);
        await waitFor('placed', async () => (await captions()).some(c => !ids.has(c.id)));
        await sleep(1500);
        const placed = (await captions()).find(c => !ids.has(c.id));
        for (const k of LOOK_KEYS) assert(S(placed.text_style?.[k]) === S(SOURCE_LOOK[k]), `placed.${k} ${S(placed.text_style?.[k])}`);
        assert(placed.time_domain === 'output', 'not a placed text');
        await shot(cdp, '06-plus-placed');
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualHead && undo.gitStatus === '', `undo ${S(undo)}`);
        return { placed, undo };
    });
    await check('ドラッグ: マイスタイルのカードをタイムラインの 10 秒へ → 置いた文字に見た目・Cmd+Z 1 回で戻る', async () => {
        await dismissToasts(cdp);
        await widenTimeline(cdp);
        const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
        const card = await evalOn(cdp, `(()=>{const el=document.querySelector('[data-akari-my-style-card=${S(styleId).replaceAll('"', '\\"')}]');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2))}})()`);
        const tx = await evalOn(cdp, `(()=>{const c=document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="c-0004"]');const r=c.getBoundingClientRect();const pps=r.width/2.5;return{x0:r.left-9*pps,pps,y:r.top+r.height/2}})()`);
        const drop = { x: Math.round(tx.x0 + 10 * tx.pps), y: Math.round(tx.y) };
        const ids = new Set((await captions()).map(c => c.id));
        await cdp.send('Input.setInterceptDrags', { enabled: true });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
        for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
        await sleep(400);
        assert(events.length, 'drag not started');
        const data = events[0].data;
        const payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0];
        for (const type of ['dragEnter', 'dragOver', 'dragOver', 'drop']) { await cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data }); await sleep(150); }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
        await cdp.send('Input.setInterceptDrags', { enabled: false });
        await waitFor('placed', async () => (await captions()).some(c => !ids.has(c.id)));
        await sleep(1500);
        const placed = (await captions()).find(c => !ids.has(c.id));
        for (const k of LOOK_KEYS) assert(S(placed.text_style?.[k]) === S(SOURCE_LOOK[k]), `placed.${k} ${S(placed.text_style?.[k])}`);
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualHead && undo.gitStatus === '', `undo ${S(undo)}`);
        const at = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${drop.x},${drop.y});return e?String(e.className).slice(0,60):null})()`);
        return { payloadKind: payload?.kind, drop, elementAtDrop: at, placed: { id: placed.id, start: placed.start, end: placed.end }, undo };
    });

    await check('style_preset だけの字幕（c-0005）に当てる → style_preset が外れ見た目が入る・Cmd+Z 1 回で両方戻る', async () => {
        await select(cdp, ['c-0005']);
        await sleep(800);
        await clickSel(cdp, `[data-akari-my-style-apply=${S(styleId)}]`);
        await waitFor('captions written', async () => (await captionsText()) !== headCaptions());
        await sleep(1000);
        const after = await row('c-0005');
        assert(after.style_preset === undefined, `style_preset remains ${after.style_preset}`);
        for (const k of LOOK_KEYS) assert(S(after.text_style?.[k]) === S(SOURCE_LOOK[k]), `c-0005.${k} ${S(after.text_style?.[k])}`);
        const undo = await undoOnce(cdp);
        const restored = await row('c-0005');
        assert(undo.captionsEqualHead && restored.style_preset === 'subtitle-variety' && restored.text_style === undefined, `undo ${S({ undo, restored })}`);
        return { after, undo, restored };
    });

    // ===== 5. 名前の変更 =====
    await check('名前の変更: 「強調テロップ（黄）」へ → style.json とカードに反映', async () => {
        await clickSel(cdp, `[data-akari-my-style-rename=${S(styleId)}]`);
        const dlg = await waitFor('rename dialog', () => evalOn(cdp, `(()=>{const d=document.querySelector('.dialogBlock');return d?{text:d.innerText.replace(/\\n+/g,' / '),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent.trim())}:null})()`));
        await typeInto(cdp, '.dialogBlock input', '強調テロップ（黄）');
        await key(cdp, 'Enter', 'Enter', 13);
        const beforeRename = JSON.parse((await styleFiles())[styleId]);
        const style = await waitFor('renamed', async () => { const s = JSON.parse((await styleFiles())[styleId]); return s.name === '強調テロップ（黄）' ? s : null; });
        assert(style.uid === beforeRename.uid && style.id === beforeRename.id && style.revision === beforeRename.revision + 1, `uid/id/revision ${S([beforeRename.uid, style.uid, beforeRename.revision, style.revision])}`);
        await waitFor('card renamed', () => evalOn(cdp, `/強調テロップ（黄）/.test(document.querySelector('[data-akari-my-style-card=${S(styleId).replaceAll('"', '\\"')}]')?.innerText||'')`));
        assert(dlg.buttons.every(b => !/^(OK|Cancel)$/.test(b)), `english buttons ${S(dlg.buttons)}`);
        return { dialog: dlg, name: style.name, uid: style.uid, revision: [beforeRename.revision, style.revision], updated_at: style.updated_at, created_at: style.created_at };
    });

    // ===== 6. motion 入りの style.json を手で足す → 起動し直す =====
    await mkdir(path.join(STYLES, 'hand-motion'), { recursive: true });
    {
        // 保存された 1 件を写して id / uid / 名前を変え、look の色と縁取りを変え、parts に motion と未知の kind を手で足す。
        const base = JSON.parse((await styleFiles())[presetStyleId]);
        const look = base.parts.find(p => p.kind === 'look');
        await writeFile(path.join(STYLES, 'hand-motion', 'style.json'), `${S({ ...base, id: 'hand-motion', uid: '01K5ZZZZZZHANDM0T10N000000', name: '手書きの動き入り', when_to_use: '動きの部品が混ざった保存形の確認',
            sample_text: '動きつき', tags: ['確認用'],
            parts: [{ ...look, text_style: { ...look.text_style, color: '#00E5FF', stroke: { color: '#002233', width_px: 4 } } },
                { kind: 'motion', scope: 'caption', mode: 'modify', animation: { in: { id: 'pop' }, out: { id: 'fade' } } },
                { kind: 'future-kind', scope: 'clip', mode: 'attach', attach: { at: 'in', offset_frames: 3 }, ref: { category: 'sfx', id: 'whoosh' } }] }, null, 2)}\n`);
    }
    const filesBeforeRestart = await styleFiles();
    await stop(session);
    session = await preparedLaunch();
    cdp = session.cdp;
    await openProject(session, PJ, 1, PORT);
    await setupWindow(cdp);
    await openShelf(cdp);
    await check('起動し直し: マイスタイルが棚に残る（保存・手で足した 3 件）・style.json は起動で書き換わらない', async () => {
        const shelf = await evalOn(cdp, SHELF);
        const ids = shelf.cards.map(c => c.id).sort();
        assert(S(ids) === S([styleId, presetStyleId, 'hand-motion'].sort()), `ids ${S(ids)}`);
        const files = await styleFiles();
        for (const id of Object.keys(filesBeforeRestart)) assert(files[id] === filesBeforeRestart[id], `${id} rewritten`);
        const motionCard = shelf.cards.find(c => c.id === 'hand-motion');
        const hand = JSON.parse(files['hand-motion']);
        assert(hand.parts.some(p => p.kind === 'future-kind' && p.attach?.offset_frames === 3), 'unknown kind not kept');
        return { ids, motionCardParts: motionCard.parts };
    });
    await shot(cdp, '07-shelf-after-restart');
    await check('motion 入りを当てる: 壊れず見た目だけ当たり（animation は書かない）、1 行知らせる・Cmd+Z 1 回で戻る', async () => {
        await select(cdp, ['c-0002']);
        await sleep(800);
        const before = await row('c-0002');
        await clickSel(cdp, '[data-akari-my-style-apply="hand-motion"]');
        const notice = await waitFor('notice', async () => { const n = await evalOn(cdp, NOTICE); return n.length ? n : null; }, 5_000);
        await waitFor('captions written', async () => (await captionsText()) !== headCaptions());
        await sleep(1000);
        const after = await row('c-0002');
        assert(after.text_style.color === '#00E5FF' && S(after.text_style.stroke) === S({ color: '#002233', width_px: 4 }), `look ${S(after.text_style)}`);
        assert(after.text_style.animation === undefined, 'animation written');
        for (const k of POSITION_KEYS) assert(S(after.text_style[k]) === S(before.text_style?.[k]), `${k} changed`);
        assert(notice.length === 1 && !notice[0].includes('\n') && /動き/.test(notice[0]), `notice ${S(notice)}`);
        const hand = JSON.parse((await styleFiles())['hand-motion']);
        assert(hand.parts.length === 3, 'style.json rewritten on apply');
        await shot(cdp, '08-motion-notice');
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualHead, `undo ${S(undo)}`);
        return { before: before.text_style, after: after.text_style, notice, undo };
    });

    // ===== 7. プレビューのミニパネルから保存 =====
    await check('ミニパネル: 字幕をプレビューで選ぶ → 「マイスタイルに保存」（アイコン・即時の説明・絵文字なし）→ その字幕のダイアログ', async () => {
        await select(cdp, ['c-0001']);
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), time: 7 }));
        await sleep(1500);
        const v = await view(PORT);
        const off = await calibrate(cdp, v);
        const c = await waitFor('plate c-0003', () => v.eval(PLATE_CENTER('c-0003')));
        const pc = toPage(off, c); await realClick(cdp, pc.x, pc.y); await sleep(1200);
        const tools = await v.eval(TOOLS);
        const item = tools?.items.find(i => i.data.includes('data-caption-tool=my-style-save'));
        assert(item?.hasSvg && !/[\p{Extended_Pictographic}]/u.test(item.text), `tool ${S(item)}`);
        const b = await v.eval(`(()=>{const b=document.querySelector('[data-caption-tool="my-style-save"]');const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        const pb = toPage(off, b);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pb.x, y: pb.y, button: 'none' });
        const t0 = Date.now(); let tip = null;
        while (Date.now() - t0 < 1000) { tip = await v.eval(`(()=>{const t=document.querySelector('[data-caption-tool="my-style-save"] .akari-caption-tool-tip');if(!t)return null;const cs=getComputedStyle(t);return cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)>0?t.textContent:null})()`); if (tip) break; await sleep(25); }
        const tooltip = { text: tip, ms: Date.now() - t0 };
        await shot(cdp, '09-mini-panel-tooltip');
        await realClick(cdp, pb.x, pb.y);
        const dialog = await waitFor('dialog', () => evalOn(cdp, `(()=>{const d=document.querySelector('[data-akari-my-style-dialog]');return d?{name:d.querySelector('[data-akari-my-style-name]').value}:null})()`));
        v.close();
        assert(tip && tooltip.ms <= 200, `tooltip ${S(tooltip)}`);
        assert(dialog.name === '豆は挽きたてが一番おいしい', `dialog for ${dialog.name}`);
        const focusedMs = await (async () => { const t0 = Date.now(); await waitFor('dialog focused', () => evalOn(cdp, `document.hasFocus()&&document.activeElement?.hasAttribute('data-akari-my-style-name')`), 5_000); return Date.now() - t0; })();
        await key(cdp, 'Escape', 'Escape', 27);
        await sleep(500);
        dialog.focusedMs = focusedMs;
        const closed = !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`));
        assert(closed, 'Escape did not close the dialog');
        return { toolsCount: tools.items.length, item, tooltip, dialog, escapeCloses: closed };
    });

    // ===== 8. 削除 =====
    await check('削除: hand-motion を削除 → フォルダごと消え、カードも消える', async () => {
        await openShelf(cdp);
        await clickSel(cdp, '[data-akari-my-style-delete="hand-motion"]');
        const dlg = await waitFor('confirm', () => evalOn(cdp, `(()=>{const d=document.querySelector('.dialogBlock');return d?{text:d.innerText.replace(/\\n+/g,' / '),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent.trim())}:null})()`));
        await shot(cdp, '10-delete-confirm');
        const ok = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('.dialogBlock button')].find(b=>/削除|OK/.test(b.textContent.trim()));const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await realClick(cdp, ok.x, ok.y);
        await waitFor('dir removed', async () => !(await readdir(STYLES)).includes('hand-motion'));
        await waitFor('card removed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-card="hand-motion"]'))`)));
        assert(dlg.buttons.every(b => !/^(OK|Cancel)$/.test(b)), `english buttons ${S(dlg.buttons)}`);
        return { dialog: dlg, remaining: (await readdir(STYLES)).sort() };
    });
    await check('保存された style.json 全件: 絶対パス・位置のキーが無い', async () => {
        const files = await styleFiles();
        for (const [id, text] of Object.entries(files)) {
            assert(!ABS.test(text), `${id} absolute path`);
            assert(!deepKeys(JSON.parse(text)).some(k => POSITION_KEYS.includes(k)), `${id} position key`);
        }
        return { files: Object.keys(files).map(id => `styles/${id}/style.json`), savedExample: JSON.parse(files[styleId]) };
    });
    // ===== 9. 縦（1080×1920）で保存 → 横（1920×1080）の案件に当てる（reference_height_px の比率）=====
    const VPJ = path.join(WORK, 'xres', 'vertical');
    const HPJ = path.join(WORK, 'xres', 'horizontal');
    await rm(path.join(WORK, 'xres'), { recursive: true, force: true });
    await cp(path.join(WORK, 'fixture', 'vertical'), VPJ, { recursive: true });
    await cp(path.join(WORK, 'fixture', 'horizontal'), HPJ, { recursive: true });
    const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p;const b=p.querySelector('.akari-caption__block')||l;const cs=getComputedStyle(l),bs=getComputedStyle(b);const st=document.getElementById('preview-stage');const lr=l.getBoundingClientRect(),sr=st.getBoundingClientRect();return{color:cs.color,fontSize:parseFloat(cs.fontSize),stroke:cs.webkitTextStrokeWidth,textShadow:cs.textShadow,background:bs.backgroundColor,radius:bs.borderTopLeftRadius,stageOffsetH:st.offsetHeight,stageRectH:sr.height,lineRectH:lr.height}})()`;
    const measure = async (v, id, t, project) => {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: t }));
        return waitFor(`plate ${id}`, () => v.eval(PLATE(id)), 20_000);
    };
    let xStyleId, vertical;
    await stop(session);
    PROJECT = VPJ;
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: VPJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
    cdp = session.cdp;
    await openProject(session, VPJ, 1, PORT);
    await setupWindow(cdp);
    await check('縦（1080×1920）: c-0001 を保存 → reference_height_px = 1920', async () => {
        await select(cdp, ['c-0001']);
        await evalOn(cdp, command('akari.inspector.open'));
        await sleep(1200);
        await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
        await clickSel(cdp, '[data-akari-my-style-inspector-save]');
        await waitFor('dialog', () => evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`));
        await typeInto(cdp, '[data-akari-my-style-name]', '縦で作った強調');
        await typeInto(cdp, '[data-akari-my-style-when]', '縦の案件で作った強調を横の案件でも使うとき');
        const before = Object.keys(await styleFiles());
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(); return Object.keys(f).length > before.length ? f : null; });
        xStyleId = Object.keys(files).find(id => !before.includes(id));
        const look = JSON.parse(files[xStyleId]).parts[0].text_style;
        assert(look.reference_height_px === 1920 && look.size_px === 52, `look ${S(look)}`);
        const v = await view(PORT);
        vertical = await measure(v, 'c-0001', 1, VPJ);
        await sleep(800);
        await shot(cdp, '11-vertical-source');
        v.close();
        return { look, preview: vertical };
    });
    await stop(session);
    PROJECT = HPJ;
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: HPJ, port: PORT, isoDir: ISO, prepare: iso => prepareLibrary(iso, LIBRARY) });
    cdp = session.cdp;
    await openProject(session, HPJ, 1, PORT);
    await setupWindow(cdp);
    await openShelf(cdp);
    await check('横（1920×1080）: c-0002〜c-0004 に当てる → 置換（既定の glow も消える・位置と animation は残る・style_preset が外れる）', async () => {
        const original = JSON.parse(await readFile(path.join(HPJ, 'captions.json'), 'utf8'));
        await select(cdp, ['c-0002', 'c-0003', 'c-0004']);
        await sleep(800);
        await clickSel(cdp, `[data-akari-my-style-apply=${S(xStyleId)}]`);
        const originalText = await readFile(path.join(WORK, 'fixture', 'horizontal', 'captions.json'), 'utf8');
        await waitFor('captions written', async () => (await captionsText()) !== execFileSync('/usr/bin/git', ['show', 'HEAD:captions.json'], { cwd: HPJ, encoding: 'utf8' }));
        await sleep(1200);
        const rows = Object.fromEntries((await captions()).map(c => [c.id, c]));
        const origRows = Object.fromEntries(original.captions.map(c => [c.id, c]));
        for (const id of ['c-0002', 'c-0003', 'c-0004']) {
            const ts = rows[id].text_style;
            assert(ts.reference_height_px === 1920 && ts.size_px === 52 && ts.color === '#FFD400', `${id} ${S(ts)}`);
            assert(S(ts.glow) === S({ color: '#000000', density: 0 }), `${id} glow ${S(ts.glow)}`);
            assert(rows[id].style_preset === undefined, `${id} style_preset ${rows[id].style_preset}`);
        }
        const c2 = rows['c-0002'].text_style, o2 = origRows['c-0002'].text_style;
        assert(S(c2.position) === S(o2.position) && c2.text_anchor === o2.text_anchor && S(c2.animation) === S(o2.animation), `c-0002 kept ${S(c2)}`);
        assert(S(rows['c-0001']) === S(origRows['c-0001']) && S(rows['c-0005']) === S(origRows['c-0005']), 'unselected changed');
        const ledger = await usage(HPJ);
        assert(ledger?.entries?.length === 1 && S(ledger.entries[0].caption_ids) === S(['c-0002', 'c-0003', 'c-0004']), `usage ${S(ledger)}`);
        return { after: { 'c-0002': c2, 'c-0004': rows['c-0004'] }, usage: ledger, originalBytes: originalText.length };
    });
    await check('横: 出力プレビューで大きさが比率どおり（1920 基準の 52px → 1080 出力で 29.25px 相当 = 対照 c-0001（52px）の 0.5625 倍）・縦の保存元と画面の高さに対する比が同じ・glow が出ない', async () => {
        const v = await view(PORT);
        const control = await measure(v, 'c-0001', 1, HPJ);
        let applied = await measure(v, 'c-0003', 7, HPJ);
        const deadline = Date.now() + 15_000;
        while (Math.abs(applied.fontSize / control.fontSize - 0.5625) > 0.01 && Date.now() < deadline) { await sleep(250); applied = await v.eval(PLATE('c-0003')) ?? applied; }
        await sleep(800);
        await shot(cdp, '12-horizontal-applied');
        const c2 = await measure(v, 'c-0002', 4, HPJ);
        v.close();
        const ratio = applied.fontSize / control.fontSize;
        // プレビューの舞台は出力解像度の要素を transform で縮めて見せるので、描かれた行の高さ ÷ 描かれた舞台の高さで比べる。
        const hRel = applied.lineRectH / applied.stageRectH, vRel = vertical.lineRectH / vertical.stageRectH;
        assert(Math.abs(ratio - 1080 / 1920) < 0.01, `ratio ${ratio}`);
        assert(Math.abs(hRel / vRel - 1) < 0.03, `relative to frame height: horizontal ${hRel} vs vertical ${vRel}`);
        assert(!/rgb\(0, 255, 0\)|rgb\(255, 0, 255\)/.test(c2.textShadow), `glow remains ${c2.textShadow}`);
        return { control, applied, c0002: c2, ratio, expected: 1080 / 1920, fontSizeOverStageHeight: { horizontal: hRel, vertical: vRel } };
    });
    await check('横: Cmd+Z 1 回で 3 本とも（style_preset も）戻る', async () => {
        const r = await undoOnce(cdp);
        const c4 = (await captions()).find(c => c.id === 'c-0004');
        assert(r.captionsEqualHead && c4.style_preset === 'subtitle-variety', S({ r, c4 }));
        return r;
    });
    out.status = out.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'error'; out.error = sanitize(error, REPO).replaceAll(WORK, '<work>');
} finally {
    await stop(session);
    await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`);
}
console.log(S({ status: out.status, pass: out.checks.filter(c => c.pass).length, total: out.checks.length, error: out.error }));
