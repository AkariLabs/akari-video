#!/usr/bin/env node
// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-22-right-panel-tone-and-toolbar-trim の受け入れ条件を実機で測る:
//   - ダーク / ライトで 台本 → カット → 注釈 → インスペクター → 音声メーター の widget ルート computed background
//   - 注釈・台本のパネル内見出しが出ていない / 注釈のフィルタ・ボードを開くが動く
//   - タイムラインのツールバーに「注釈」「録音帯」が無い / 他のボタンが動く /
//     localStorage に録音帯 true を入れて起動（reload）しても帯が出ない
//   - 台本の行選択・カットの一覧表示
//   - 主要テキストのコントラスト比（computed の文字色 × 実効背景色）
// 使い方: node run-l1.mjs [--port=9452]
// fixture・プロファイルは OS の一時ディレクトリ配下 right-panel-tone-and-toolbar-trim-l1/ に作る。
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S, command, evalOn, launch, realClick, sanitize, saveJson, screenshot, sleep, stop, waitEval } from './l1-lib.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(SCRIPTS);
const REPO = path.resolve(ROOT, '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9452);
const TMP = path.join(os.tmpdir(), 'right-panel-tone-and-toolbar-trim-l1');
const WS = path.join(TMP, 'ws');
const RESULTS = path.join(ROOT, 'results-l1.json');
const MATERIAL = 'assets/base.mp4';
const PANELS = [
    ['台本', 'akari-daihon-widget'], ['カット', 'akari-cuts-widget'], ['注釈', 'akari-review-panel-widget'],
    ['インスペクター', 'akari-inspector-widget'], ['音声メーター', 'akari-audio-meter-widget']
];
const RANGES_KEY = 'akari.annotations.reviewSessionRanges.visible';
const out = { status: 'running', port: PORT, checks: [], screenshots: [], measured: {} };

const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', c => { err += c; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${code}: ${err.slice(-800)}`)));
});

async function fixture() {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
    cpSync(path.join(REPO, 'templates/project-default'), WS, { recursive: true });
    mkdirSync(path.join(WS, 'assets'), { recursive: true });
    await run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(WS, MATERIAL)], WS);
    writeFileSync(path.join(WS, 'edit.json'), `${JSON.stringify({
        version: 2, output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'main', path: MATERIAL }],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [{ id: 'main-clip', at: 0, duration: 900, source: { kind: 'media', src: 'main', in: 0, out: 30 } }] },
            { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
        ]
    }, null, 2)}\n`);
    writeFileSync(path.join(WS, 'captions.json'), `${JSON.stringify(Array.from({ length: 6 }, (_, i) => ({
        id: `s-${i + 1}`, start: i * 5, end: i * 5 + 4, text: `これは ${i + 1} 行目の話した言葉です`,
        speaker: null, sourceRef: { segment: i }, edited: false
    })), null, 2)}\n`);
    const cutsPath = path.join(WS, '.akari/sidecars', `${MATERIAL}.analysis`, 'cuts.json');
    mkdirSync(path.dirname(cutsPath), { recursive: true });
    const kinds = ['filler', 'redo', 'silence', 'unrecognized'];
    writeFileSync(cutsPath, `${JSON.stringify({
        version: 1, generated_at: '2026-09-22T00:00:00Z', basis: 'cloud-scribe',
        rules: { filler: 'off', redo: 'off', silence_min_sec: 1.5, silence_keep_sec: 0.5, silence_break_sec: 3, unrecognized: 'off' },
        candidates: Array.from({ length: 8 }, (_, i) => {
            const kind = kinds[i % 4], start = 0.5 + i * 3;
            return { id: `${kind}-${start.toFixed(1)}`, kind, start, end: start + 0.4, text: kind === 'filler' ? 'えー、' : kind === 'redo' ? 'で、で、' : null, on: i < 3, default_on: false, reason: 'L1 fixture' };
        }),
        hand_edited: [{ candidate: 'filler-0.5', line: 1 }]
    }, null, 2)}\n`);
    for (const args of [['init', '-q'], ['config', 'user.email', 'rptt@localhost'], ['config', 'user.name', 'rptt'], ['add', '-A'], ['commit', '-q', '-m', 'fixture']]) await run('/usr/bin/git', args, WS);
}

const assert = (c, m) => { if (!c) throw new Error(m); };
async function check(name, fn) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await fn(); record.pass = true; } catch (e) { record.error = sanitize(e, REPO); } finally { await saveJson(RESULTS, out); }
    return record.detail;
}
async function shot(cdp, name) { await sleep(500); await screenshot(cdp, path.join(ROOT, name)); out.screenshots.push(name); }

const FIND = names => `[...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&${names.map(n => `typeof k.prototype?.${n}==='function'`).join('&&')})`;
const SHELL_EXPR = `window.theia.container.get(${FIND(['collapsePanel', 'expandPanel', 'revealWidget'])})`;
const THEME_EXPR = `window.theia.container.get(${FIND(['setCurrentTheme', 'getCurrentTheme'])})`;
const widgetExpr = id => `(${SHELL_EXPR}.widgets.find(w=>w.id===${S(id)}))`;
// タイムライン widget は edit ファイル名で id が変わる（timelineWidgetId）ので、インスタンスの形で探す。
const TL = `(${SHELL_EXPR}.widgets.find(w=>w.reviewSessionRangesButton&&w.snapToggleButton))`;

// 色の解析とコントラスト（WCAG 2.x 相対輝度）。
function parseColor(text) {
    const s = String(text).trim();
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
    m = s.match(/^color\(srgb ([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] ?? 1 }; }
    return null;
}
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
// ページ側: 要素の文字色と、祖先を上へ辿った背景色スタック（上から順）。
const COLOR_PROBE = sel => `(()=>{const e=document.querySelector(${S(sel)});if(!e)return null;const stack=[];for(let n=e;n&&n.nodeType===1;n=n.parentElement){const b=getComputedStyle(n).backgroundColor;stack.push(b);}return{text:(e.textContent||'').trim().slice(0,30),color:getComputedStyle(e).color,visibility:getComputedStyle(e).visibility,stack}})()`;
function contrastOf(probe) {
    if (!probe) return null;
    let bg = { r: 0, g: 0, b: 0, a: 0 };
    const layers = probe.stack.map(parseColor).filter(Boolean).filter(c => c.a > 0);
    let acc = null;
    for (const layer of layers.reverse()) acc = acc ? blend(layer, acc) : (layer.a >= 1 ? layer : blend(layer, { r: 255, g: 255, b: 255, a: 1 }));
    bg = acc ?? { r: 255, g: 255, b: 255, a: 1 };
    const fg0 = parseColor(probe.color);
    const fg = fg0.a < 1 ? blend(fg0, bg) : fg0;
    return { text: probe.text, color: probe.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, ratio: ratio(fg, bg) };
}

async function activate(cdp, id) {
    // 右ドックのアイコンタブは「前面のタブを再度押すとパネルが畳まれる」ため、実クリックではなく
    // ApplicationShell.activateWidget で前面化する（ユーザーのタブ切り替えと同じ経路）。
    const visible = `(()=>{const n=document.getElementById(${S(id)});return !!n&&!n.classList.contains('lm-mod-hidden')&&n.getBoundingClientRect().width>0})()`;
    const opener = { 'akari-inspector-widget': 'akari.inspector.open', 'akari-audio-meter-widget': 'akari.preview.openAudioMeter' }[id];
    if (opener && !await evalOn(cdp, `!!${widgetExpr(id)}`)) { await evalOn(cdp, command(opener)).catch(() => null); await sleep(1500); }
    if (!await evalOn(cdp, visible)) await evalOn(cdp, `(async()=>{await ${SHELL_EXPR}.activateWidget(${S(id)});return true})()`);
    await waitEval(cdp, visible, { label: `${id} visible`, timeoutMs: 30_000 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 600, button: 'none' });
    await sleep(1500);
}

async function setTheme(cdp, id) {
    await evalOn(cdp, `(()=>{${THEME_EXPR}.setCurrentTheme(${S(id)},true);return true})()`);
    await waitEval(cdp, `${THEME_EXPR}.getCurrentTheme().id===${S(id)}`, { label: `theme ${id}` });
    await sleep(2500);
}

let session;
try {
    await fixture();
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project: WS, port: PORT, isoDir: path.join(TMP, 'profile') });
    let { cdp } = session;
    // 録音帯 true を localStorage に入れてから再読み込み（= その値で起動）
    await evalOn(cdp, `(()=>{localStorage.setItem(${S(RANGES_KEY)},'true');return true})()`);
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(3000);
    await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'workbench after reload', timeoutMs: 180_000 });
    await waitEval(cdp, `(()=>{const p=document.querySelector('.theia-preload');return !p||p.classList.contains('theia-hidden')})()`, { label: 'preload hidden', timeoutMs: 120_000 });
    await sleep(3000);
    await evalOn(cdp, command('akari.daihon.open')).catch(() => null);
    await waitEval(cdp, `document.querySelectorAll('.akari-daihon-row').length>=6`, { label: 'daihon rows', timeoutMs: 240_000 });
    if (!await evalOn(cdp, `!!${TL}`)) await evalOn(cdp, command('akari.annotations.open')).catch(() => null);
    await waitEval(cdp, `(()=>{const w=${TL};return !!w&&w.node.isConnected})()`, { label: 'timeline widget', timeoutMs: 120_000 });
    out.measured.timelineWidgetId = await evalOn(cdp, `${TL}.id`);
    await sleep(2000);

    await check('timeline-toolbar-no-annotation-or-ranges-button', async () => {
        const state = await evalOn(cdp, `(()=>{const w=${TL}.node;const bs=[...w.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);const toolbar=bs[0]?.parentElement;const tb=[...(toolbar?.querySelectorAll('button')??[])];return{localStorage:localStorage.getItem(${S(RANGES_KEY)}),toolbarButtons:tb.map(b=>({text:b.textContent.trim(),title:b.title,testid:b.dataset.testid??null,width:Math.round(b.getBoundingClientRect().width)})),rangesToggle:!!document.querySelector('[data-testid="akari-timeline-review-session-ranges-toggle"]'),reviewButton:bs.some(b=>b.textContent.trim()==='注釈'),rangesButton:bs.some(b=>b.textContent.trim()==='録音帯')}})()`);
        assert(state.localStorage === 'true', 'localStorage true not kept');
        assert(!state.rangesToggle && !state.reviewButton && !state.rangesButton, 'annotation/ranges button still present');
        return state;
    });
    await check('recording-ranges-hidden-despite-localStorage-true', async () => {
        const w = TL;
        const injected = await evalOn(cdp, `(()=>{const w=${w};const visibleAtStart=w.recordingRangesVisible;w.reviewSessionState={...(w.reviewSessionState??{}),sessions:[{id:'rs-l1',ranges:[{start:2,end:8}]}]};w.updateReviewSessionRangeLayout();w.renderStrip();return{visibleAtStart,bands:document.querySelectorAll('[data-review-session]').length}})()`);
        await sleep(800);
        const hidden = await evalOn(cdp, `document.querySelectorAll('[data-review-session]').length`);
        // 対照: 可視フラグを立てると同じ state で帯が描かれる（プローブの有効性の裏取り）→ 元に戻す
        const control = await evalOn(cdp, `(async()=>{const w=${w};w.recordingRangesVisible=true;w.updateReviewSessionRangeLayout();w.renderStrip();await new Promise(r=>setTimeout(r,800));const n=document.querySelectorAll('[data-review-session]').length;w.recordingRangesVisible=false;w.reviewSessionState=undefined;w.updateReviewSessionRangeLayout();w.renderStrip();return n})()`);
        assert(injected.visibleAtStart === false, 'recordingRangesVisible true at startup');
        assert(hidden === 0, `bands shown: ${hidden}`);
        assert(control > 0, 'control did not render bands (probe invalid)');
        return { ...injected, bandsAfterInject: hidden, controlBandsWhenForcedVisible: control };
    });
    await check('timeline-other-button-works (snap toggle)', async () => {
        const read = `(()=>{const b=[...${TL}.node.querySelectorAll('button')].find(b=>b===${TL}.snapToggleButton);const r=b.getBoundingClientRect();return{pressed:b.getAttribute('aria-pressed'),title:b.title,x:r.left+r.width/2,y:r.top+r.height/2,snap:${TL}.snapEnabled}})()`;
        const before = await evalOn(cdp, read);
        await realClick(cdp, before.x, before.y); await sleep(600);
        const after = await evalOn(cdp, read);
        await realClick(cdp, after.x, after.y); await sleep(600);
        const restored = await evalOn(cdp, read);
        assert(before.snap !== after.snap && restored.snap === before.snap, 'snap toggle did not toggle');
        return { before, after, restored };
    });
    await shot(cdp, 'timeline-toolbar.png');

    for (const theme of ['dark', 'light']) {
        await setTheme(cdp, theme);
        const panels = [];
        for (const [label, id] of PANELS) {
            await activate(cdp, id);
            const m = await evalOn(cdp, `(()=>{const n=document.getElementById(${S(id)});const cs=getComputedStyle(n);const tab=document.getElementById(${S(`shell-tab-${id}`)});return{id:${S(id)},background:cs.backgroundColor,color:cs.color,tabLabel:${widgetExpr(id)}?.title.label??null,tabCaption:${widgetExpr(id)}?.title.caption??null}})()`);
            panels.push({ label, ...m });
            await shot(cdp, `${theme}-${panels.length}-${id}.png`);
        }
        out.measured[`${theme}-backgrounds`] = panels;
        await check(`${theme}: widget root backgrounds identical`, async () => {
            const set = new Set(panels.map(p => p.background));
            assert(set.size === 1, `backgrounds differ: ${[...set].join(' | ')}`);
            return { background: [...set][0], panels };
        });
        // コントラスト（主要テキスト）
        await activate(cdp, 'akari-daihon-widget');
        const daihonProbes = {
            rowWordPast: '.akari-daihon-row .akari-daihon-word', count: '.akari-daihon-count', tc: '.akari-daihon-tc',
            headButton: '.akari-daihon-head .akari-daihon-history', gapChip: '.akari-daihon-gapchip', qcState: '.akari-daihon-qc', widget: '.akari-daihon-widget'
        };
        const contrasts = {};
        for (const [k, sel] of Object.entries(daihonProbes)) contrasts[`daihon.${k}`] = contrastOf(await evalOn(cdp, COLOR_PROBE(sel)));
        await activate(cdp, 'akari-cuts-widget');
        for (const [k, sel] of Object.entries({ row: '#akari-cuts-widget [data-candidate-id] s', rowReason: '#akari-cuts-widget [data-candidate-id] div', rowSmall: '#akari-cuts-widget [data-candidate-id] small', foot: '#akari-cuts-widget p', handEditedMark: '#akari-cuts-widget [data-candidate-id] small:last-child', footButton: '#akari-cuts-widget button' })) contrasts[`cuts.${k}`] = contrastOf(await evalOn(cdp, COLOR_PROBE(sel)));
        out.measured[`${theme}-contrast`] = contrasts;
        await check(`${theme}: main text contrast >= 4.5`, async () => {
            const low = Object.entries(contrasts).filter(([, v]) => v && v.ratio < 4.5);
            assert(Object.values(contrasts).every(v => v), 'probe missing');
            assert(low.length === 0, `low contrast: ${JSON.stringify(low)}`);
            return contrasts;
        });
    }

    await setTheme(cdp, 'dark');
    await check('daihon inner heading hidden, tab label kept', async () => {
        await activate(cdp, 'akari-daihon-widget');
        const s = await evalOn(cdp, `(()=>{const t=document.querySelector('.akari-daihon-title');const h=document.querySelector('.akari-daihon-head');const cs=t?getComputedStyle(t):null;return{title:t?{text:t.textContent,visibility:cs.visibility,display:cs.display}:null,headHeight:Math.round(h.getBoundingClientRect().height),headChildren:[...h.children].map(c=>(c.className||c.tagName).toString().split(' ')[0]),tabLabel:${widgetExpr('akari-daihon-widget')}.title.label,ariaLabel:document.getElementById('akari-daihon-widget').getAttribute('aria-label')}})()`);
        assert(!s.title || s.title.visibility === 'hidden' || s.title.display === 'none', 'title visible');
        assert(s.tabLabel === '台本', 'tab label changed');
        return s;
    });
    await check('daihon row select works (plain click = seek, cmd-click = select)', async () => {
        // 行の空き（右端の手前）を押す。素のクリックはシーク、⌘ クリックで選択（planRowClick の既定）。
        const p = await evalOn(cdp, `(()=>{const r=document.querySelectorAll('.akari-daihon-row')[2];r.scrollIntoView({block:'center'});const b=r.getBoundingClientRect();return{x:b.right-12,y:b.top+b.height/2}})()`);
        await realClick(cdp, p.x, p.y, { modifiers: 4 }); await sleep(1200);
        const s = await evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('.akari-daihon-row')];const sel=rows.filter(r=>r.classList.contains('selected'));return{selected:sel.map(r=>r.dataset.captionId),selectedBg:sel[0]?getComputedStyle(sel[0]).backgroundColor:null,selectedOutline:sel[0]?getComputedStyle(sel[0]).outlineColor:null,selbar:!!document.querySelector('.akari-daihon-selbar')&&getComputedStyle(document.querySelector('.akari-daihon-selbar')).display!=='none'}})()`);
        assert(s.selected.length === 1, `selected ${JSON.stringify(s.selected)}`);
        return s;
    });
    await shot(cdp, 'dark-daihon-after-select.png');
    await check('cuts list shows candidates', async () => {
        await activate(cdp, 'akari-cuts-widget');
        const s = await evalOn(cdp, `(()=>{const rows=[...document.querySelectorAll('#akari-cuts-widget [data-candidate-id]')];return{rows:rows.length,firstBorder:rows[0]?getComputedStyle(rows[0]).borderTopColor:null,firstBg:rows[0]?getComputedStyle(rows[0]).backgroundColor:null,secondBorder:rows[1]?getComputedStyle(rows[1]).borderTopColor:null,foot:document.querySelector('#akari-cuts-widget p')?.textContent}})()`);
        assert(s.rows === 8, `rows ${s.rows}`);
        return s;
    });
    await check('review panel: inner heading gone, filter + board work', async () => {
        await activate(cdp, 'akari-review-panel-widget');
        const s = await evalOn(cdp, `(()=>{const w=document.getElementById('akari-review-panel-widget');const sel=w.querySelector('select');const tb=sel.parentElement;const texts=[...tb.children].filter(c=>c!==sel&&c.tagName!=='BUTTON').map(c=>c.textContent.trim());const sr=sel.getBoundingClientRect(),br=w.querySelector('[data-review-open-board]').getBoundingClientRect();return{toolbarTexts:texts,strong:[...w.querySelectorAll('strong')].map(x=>x.textContent),select:{x:Math.round(sr.left),w:Math.round(sr.width),options:[...sel.options].map(o=>o.value),value:sel.value},board:{x:Math.round(br.left),w:Math.round(br.width)},tabLabel:${widgetExpr('akari-review-panel-widget')}.title.label}})()`);
        assert(!s.toolbarTexts.includes('注釈') && !s.strong.includes('注釈'), 'inner heading 注釈 still shown');
        assert(s.tabLabel === '注釈', 'tab label changed');
        const next = s.select.options.find(v => v !== s.select.value);
        const changed = await evalOn(cdp, `(()=>{const sel=document.querySelector('#akari-review-panel-widget select');sel.value=${S(next)};sel.dispatchEvent(new Event('change'));return sel.value})()`);
        await sleep(600);
        await evalOn(cdp, `(()=>{const sel=document.querySelector('#akari-review-panel-widget select');sel.value=${S(s.select.value)};sel.dispatchEvent(new Event('change'));return true})()`);
        const beforeIds = await evalOn(cdp, `${SHELL_EXPR}.widgets.map(w=>w.id)`);
        const b = await evalOn(cdp, `(()=>{const r=document.querySelector('#akari-review-panel-widget [data-review-open-board]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await realClick(cdp, b.x, b.y);
        await sleep(3000);
        const afterIds = await evalOn(cdp, `${SHELL_EXPR}.widgets.map(w=>w.id)`);
        const opened = afterIds.filter(id => !beforeIds.includes(id));
        const current = await evalOn(cdp, `${SHELL_EXPR}.currentWidget?.id??null`);
        assert(opened.length > 0 || /board/i.test(String(current)), 'board did not open');
        return { ...s, filterChangedTo: changed, boardOpened: opened, currentAfterBoard: current };
    });
    await shot(cdp, 'dark-review-board-opened.png');
    await activate(cdp, 'akari-review-panel-widget');
    await shot(cdp, 'dark-review-panel-heading.png');
    out.status = out.checks.every(c => c.pass) ? 'PASS' : 'FAIL';
} catch (error) {
    out.status = 'ERROR';
    out.error = sanitize(error, REPO);
} finally {
    await saveJson(RESULTS, out);
    await stop(session);
}
process.stdout.write(`${JSON.stringify({ status: out.status, checks: out.checks.map(c => [c.name, c.pass, c.error ?? null]) }, null, 2)}\n`);
