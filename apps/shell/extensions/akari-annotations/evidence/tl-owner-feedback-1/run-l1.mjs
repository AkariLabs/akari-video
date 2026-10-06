// オーナー実機確認の指摘 1（ズームバーの丸・最下段バー中央の課題チップと報告）を実機で採る検証スクリプト。
// 使い方（リポのルートで、apps/shell を build 済みにしてから）:
//   node apps/shell/extensions/akari-annotations/evidence/tl-owner-feedback-1/run-l1.mjs <issue|clean> [記録先]
//   issue = 存在しない静止画を sources[0] に持つ fixture（課題 1 件） / clean = 課題 0 件の fixture
// 一時ディレクトリ（名前に tl-owner-feedback-1 を含む）に fixture を作り、CDP ポート 9473 で Electron を起動し、
// 自分が起動した PID だけを止める。記録物（JSON・PNG・ログ）は記録先（リポの外）へ書く。
// クリップボードは検証の前に退避し、終わったら戻す。
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot } from '../timeline-tracks/scripts/cdp-lib.mjs';

const PORT = 9473;
const mode = process.argv[2] === 'clean' ? 'clean' : 'issue';
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const base = process.argv[3] || await mkdtemp(join(tmpdir(), `tl-owner-feedback-1-${mode}-`));
const workspace = join(base, 'tl-owner-feedback-1-workspace');
const userData = join(base, 'tl-owner-feedback-1-user-data');
const config = join(base, 'tl-owner-feedback-1-config');
const akariHome = join(base, 'tl-owner-feedback-1-home');
const rec = { at: new Date().toISOString(), mode, base, steps: {} };
const save = () => writeFileSync(join(base, `l1-${mode}.json`), `${JSON.stringify(rec, null, 2)}\n`);

const portOccupied = await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
});
if (portOccupied) throw new Error(`CDP port ${PORT} is already in use; no Electron was started`);

await mkdir(base, { recursive: true });
await cp(join(root, 'templates/project-default'), workspace, { recursive: true });
await Promise.all([userData, config, akariHome, join(workspace, 'assets')].map(d => mkdir(d, { recursive: true })));
await copyFile(join(root, 'apps/shell/extensions/akari-preview/evidence/preview-audio-wiring/fixture/fixture-video.mp4'),
    join(workspace, 'assets', 'clip.mp4'));
const cuts = [0, 180, 360, 540].map((at, index) => ({
    id: `cut-${index + 1}`, at, duration: 180, source: { kind: 'media', src: 'clip', in: 0, out: 6 }
}));
const sources = [{ id: 'clip', path: 'assets/clip.mp4' }];
if (mode === 'issue') sources.unshift({ id: 'bg', path: 'assets/still/xxx/bg.png' });
const editPath = join(workspace, 'edit.json');
writeFileSync(editPath, `${JSON.stringify({
    version: 2, output: { width: 640, height: 360, fps: 30 }, sources,
    tracks: [{ id: 'main', lane: 'visual', items: cuts }]
}, null, 2)}\n`);

let clipboardBefore = null;
try { clipboardBefore = execFileSync('pbpaste', { encoding: 'utf8' }); } catch { /* 退避できなければ戻さない */ }

const electronLog = openSync(join(base, 'electron.log'), 'w');
const env = { ...process.env, THEIA_CONFIG_DIR: config, AKARI_HOME: akariHome };
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(join(root, 'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
    join(root, 'apps/shell'), workspace, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, '--no-sandbox'
], { env, stdio: ['ignore', electronLog, electronLog] });
if (!electron.pid) throw new Error('Electron did not start');
rec.electronPid = electron.pid;

async function waitFor(read, label, timeout = 30000) {
    const end = Date.now() + timeout;
    let lastError;
    while (Date.now() < end) {
        try { const value = await read(); if (value) return value; } catch (error) { lastError = error; }
        await sleep(100);
    }
    throw new Error(`timeout: ${label}${lastError ? `; ${lastError}` : ''}`);
}

const SERVICE = `((...m)=>{const c=window.theia.container;const k=[...c._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));return c.get(k)})`;
const SHELL = `${SERVICE}('collapsePanel','revealWidget')`;
const THEMES = `${SERVICE}('setCurrentTheme','getCurrentTheme','getThemes')`;
const WGT = `${SHELL}.getWidgets('bottom').find(w=>w.id==='akari-annotations-widget')`;
const BOX = `const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};`;
// 状態の採取: 最下段バーの課題チップ・報告・ポップアップ・タイムライン内の帯
const SEAT = `(()=>{${BOX}const bar=document.getElementById('theia-statusBar');const chip=document.querySelector('[data-testid="akari-timeline-issue-chip"]');const msg=document.querySelector('[data-testid="akari-timeline-message"]');const pop=document.querySelector('[data-testid="akari-timeline-issue-popup"]');const W=${WGT};const span=msg?.querySelector('span:not(.codicon)')??msg;const cs=e=>e&&getComputedStyle(e);
return{bar:box(bar),barCenter:box(bar).left+box(bar).width/2,
chip:chip?{text:chip.textContent.trim(),box:box(chip),color:cs(chip).color,parentArea:chip.parentElement.className}:null,
message:msg?{text:msg.textContent.trim(),title:msg.title,box:box(msg),color:cs(msg).color,clipped:span.scrollWidth>span.clientWidth,textOverflow:cs(span).textOverflow,whiteSpace:cs(span).whiteSpace,parentArea:msg.parentElement.className}:null,
popup:pop?{box:box(pop),heading:pop.querySelector('.akari-timeline-issue-heading')?.textContent,rows:[...pop.querySelectorAll('.akari-timeline-issue-row')].map(e=>e.textContent),buttons:[...pop.querySelectorAll('button')].map(b=>({text:b.textContent,testid:b.dataset.testid})),background:cs(pop).backgroundColor,border:cs(pop).borderTopColor}:null,
longNoticeInDocument:document.body.innerText.includes('保存前からの課題'),
timelineText:W.node.innerText.includes('保存前から'),
footerText:W.footer?.textContent??null}})()`;

let main;
try {
    const target = await waitFor(async () => (await listTargets(PORT)).find(item => item.type === 'page'), 'main page', 90000);
    main = new CDP(target.webSocketDebuggerUrl);
    await main.connect();
    await main.send('Page.enable');
    await main.send('Runtime.enable');
    await main.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => evalOn(main, `document.readyState === 'complete' && !!window.theia?.container`), 'page ready', 90000);
    if (!await evalOn(main, `!!document.getElementById('akari-annotations-widget')`)) {
        await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
        await sleep(500);
        await main.send('Input.insertText', { text: 'タイムラインを開く' });
        await sleep(500);
        await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    }
    await waitFor(() => evalOn(main, `document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]').length >= 4`), 'timeline clips', 90000);
    await sleep(1500);
    const ev = expression => evalOn(main, expression);
    const shot = name => screenshot(main, join(base, `${mode}-${name}.png`));
    const clipShot = async (name, clip) => {
        const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 3 } });
        writeFileSync(join(base, `${mode}-${name}.png`), Buffer.from(data, 'base64'));
    };
    await ev(`(()=>{document.querySelectorAll('.akari-guide-announcement .close,.theia-notification-list-item .codicon-close').forEach(e=>e.click());return true})()`);
    await sleep(800);
    rec.steps.initial = await ev(SEAT);

    // 1. ズームバーの丸（ダーク / ライト）
    const setTheme = async type => {
        await ev(`(async()=>{const s=${THEMES};await s.initialized;const t=s.getThemes().find(t=>t.type==='${type}');s.setCurrentTheme(t.id,true);return t.id})()`);
        await waitFor(() => ev(`${THEMES}.getCurrentTheme().type==='${type}'`), `theme ${type}`);
        await sleep(800);
    };
    const HANDLES = `(()=>{${BOX}const W=${WGT};const lum=c=>{const m=c.match(/[\\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
const root=getComputedStyle(document.documentElement);
return ['h','v'].map(axis=>{const bar=document.querySelector('.akari-timeline-zoom-bar--'+axis);const thumb=bar.querySelector('.akari-timeline-zoom-bar__thumb');
return{axis,bar:{box:box(bar),background:getComputedStyle(bar).backgroundColor},thumb:{background:getComputedStyle(thumb).backgroundColor},
handles:[...bar.querySelectorAll('.akari-timeline-zoom-bar__handle')].map(h=>{const s=getComputedStyle(h);const b=box(h);const cx=b.left+b.width/2,cy=b.top+b.height/2;
const hit=(dx,dy)=>{const e=document.elementFromPoint(cx+dx,cy+dy);return e===h};const who=(dx,dy)=>{const e=document.elementFromPoint(cx+dx,cy+dy);return e?(e===h?'self':e.tagName+'.'+String(e.className).slice(0,60)):null};
return{cls:h.className,box:b,width:s.width,height:s.height,background:s.backgroundColor,borderColor:s.borderTopColor,borderWidth:s.borderTopWidth,
lumHandle:lum(s.backgroundColor),lumBar:lum(getComputedStyle(bar).backgroundColor),beforeInset:getComputedStyle(h,'::before').top,
hitCenter:hit(0,0),hitWho:[[10.5,0],[-10.5,0],[0,10.5],[0,-10.5]].map(([x,y])=>who(x,y)),matchesHoverAfter:null,hitPlus10_5:hit(axis==='h'?10.5:0,axis==='h'?0:10.5),hitMinus10_5:hit(axis==='h'?-10.5:0,axis==='h'?0:-10.5)}})}}).concat([{tokens:{foreground:root.getPropertyValue('--theia-foreground'),editorWidgetBackground:root.getPropertyValue('--theia-editorWidget-background'),focusBorder:root.getPropertyValue('--theia-focusBorder')}}])})()`;
    rec.steps.handles = {};
    for (const type of ['dark', 'light']) {
        await setTheme(type);
        // 縦バーの丸が見えるよう、少し縦にも寄せる（倍率は workspace storage に保存されるが一時ディレクトリ）
        const measured = await ev(HANDLES);
        const hb = measured[0].bar.box;
        const vb = measured[1].bar.box;
        await clipShot(`zoom-h-${type}`, { x: hb.left - 8, y: hb.top - 8, width: Math.min(420, hb.width + 16), height: hb.height + 16 });
        await clipShot(`zoom-h-end-${type}`, { x: hb.right - 220, y: hb.top - 8, width: 228, height: hb.height + 16 });
        await clipShot(`zoom-v-${type}`, { x: vb.left - 30, y: vb.top - 8, width: vb.width + 38, height: Math.min(220, vb.height + 16) });
        // ホバー時の縁
        const endHandle = measured[0].handles[1].box;
        await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: endHandle.left + endHandle.width / 2, y: endHandle.top + endHandle.height / 2 });
        await sleep(300);
        const hoverBorder = await ev(`(()=>{const h=document.querySelector('.akari-timeline-zoom-bar--h .akari-timeline-zoom-bar__handle--end');const r=h.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{border:getComputedStyle(h).borderTopColor,matchesHover:h.matches(':hover'),under:e===h?'self':e?.tagName+'.'+String(e?.className).slice(0,60),hovered:[...document.querySelectorAll(':hover')].at(-1)?.className}})()`);
        const startBox = measured[0].handles[0].box;
        await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startBox.left + startBox.width / 2, y: startBox.top + startBox.height / 2 });
        await sleep(300);
        const hoverStart = await ev(`(()=>{const h=document.querySelector('.akari-timeline-zoom-bar--h .akari-timeline-zoom-bar__handle--start');return{border:getComputedStyle(h).borderTopColor,matchesHover:h.matches(':hover')}})()`);
        await clipShot(`zoom-h-end-hover-${type}`, { x: hb.right - 220, y: hb.top - 8, width: 228, height: hb.height + 16 });
        await main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
        rec.steps.handles[type] = { measured, hoverBorder, hoverStart };
        await shot(`theme-${type}`);
        save();
    }
    await setTheme('dark');

    // ズームバーの操作が従来どおり（右の丸ドラッグ → 終了だけ動く / ダブルクリック → 100%）
    const VIEW = `(()=>{const W=${WGT};return{start:W.viewStart,dur:W.visibleDuration(),label:W.zoomLabel?.textContent}})()`;
    const before = await ev(VIEW);
    const hEnd = await ev(`(()=>{const r=document.querySelector('.akari-timeline-zoom-bar--h .akari-timeline-zoom-bar__handle--end').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realDrag(main, [hEnd, { x: hEnd.x - 300, y: hEnd.y }]);
    await sleep(400);
    const afterHandleDrag = await ev(VIEW);
    const dragClass = await ev(`document.querySelector('.akari-timeline-zoom-bar__handle--dragging')?.className ?? null`);
    const hBar = await ev(`(()=>{const r=document.querySelector('.akari-timeline-zoom-bar--h').getBoundingClientRect();return{x:r.right-20,y:r.top+r.height/2}})()`);
    await realClick(main, hBar.x, hBar.y, { clickCount: 2 });
    await sleep(400);
    const afterDouble = await ev(VIEW);
    // 縦バー: 下の丸を上へ → 倍率が上がる / ダブルクリック → 倍率 1
    const VSCALE = `(()=>{const W=${WGT};const rows=[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')].map(e=>Math.round(e.getBoundingClientRect().height));return{scale:W.trackHeightScale,rows}})()`;
    const vBefore = await ev(VSCALE);
    const vEnd = await ev(`(()=>{const r=document.querySelector('.akari-timeline-zoom-bar--v .akari-timeline-zoom-bar__handle--end').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realDrag(main, [vEnd, { x: vEnd.x, y: vEnd.y - 80 }]);
    await sleep(400);
    const vAfterDrag = await ev(VSCALE);
    const vBar = await ev(`(()=>{const r=document.querySelector('.akari-timeline-zoom-bar--v').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height-6,box:{top:r.top,bottom:r.bottom}}})()`);
    await realClick(main, vBar.x, vBar.y, { clickCount: 2 });
    await sleep(400);
    const vAfterDouble = await ev(VSCALE);
    rec.steps.zoomOps = { before, afterHandleDrag, dragClassAfterRelease: dragClass, afterDouble, vBefore, vAfterDrag, vBar, vAfterDouble };
    save();

    // 2. クリップを動かして保存 → 課題チップ
    const editBefore = readFileSync(editPath, 'utf8');
    const clip = await ev(`(()=>{const e=[...document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]')].at(-1);const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,ui:e.dataset.akariUi??null}})()`);
    await realDrag(main, [clip, { x: clip.x + 40, y: clip.y }]);
    const saved = await waitFor(() => readFileSync(editPath, 'utf8') !== editBefore, 'edit.json written', 15000);
    rec.steps.save = { clip, saved: !!saved };
    if (mode === 'issue') {
        const shown = await waitFor(async () => { const s = await ev(SEAT); return s.chip ? s : undefined; }, 'issue chip', 20000);
        await sleep(5000); // 4 秒 / 8 秒のタイマーに載っていないこと
        const after5s = await ev(SEAT);
        await shot('chip');
        const sb = after5s.bar;
        await clipShot('statusbar-chip', { x: sb.left, y: sb.top - 4, width: sb.width, height: sb.height + 8 });
        rec.steps.chip = { shown, after5s };
        save();

        const clickChip = async () => { const b = (await ev(SEAT)).chip.box; await realClick(main, b.left + b.width / 2, b.top + b.height / 2); };
        // ポップアップ → コピー（フォーカスの出入りを記録する: blur で閉じる実装の副作用の確認）
        await ev(`(()=>{window.__focusLog=[];const log=t=>window.__focusLog.push({t,at:performance.now(),hasFocus:document.hasFocus(),active:document.activeElement?.tagName+'.'+String(document.activeElement?.className).slice(0,40),popup:!!document.querySelector('[data-testid="akari-timeline-issue-popup"]')});window.addEventListener('blur',()=>log('blur'));window.addEventListener('focus',()=>log('focus'));document.addEventListener('pointerdown',()=>log('pointerdown'),true);new MutationObserver(()=>log('dom-popup')).observe(document.body,{childList:true});log('start');return true})()`);
        await clickChip();
        const popup = await waitFor(async () => { const s = await ev(SEAT); return s.popup ? s : undefined; }, 'popup');
        await shot('popup');
        await clipShot('popup-zoom', { x: popup.popup.box.left - 10, y: popup.popup.box.top - 10, width: popup.popup.box.width + 20,
            height: popup.chip.box.bottom - popup.popup.box.top + 16 });
        execFileSync('pbcopy', { input: '__before_copy__' });
        const copyBtn = await ev(`(()=>{const r=document.querySelector('[data-testid="akari-timeline-issue-copy"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await realClick(main, copyBtn.x, copyBtn.y);
        await sleep(800);
        const clipboard = execFileSync('pbpaste', { encoding: 'utf8' });
        const fallback = await ev(`document.querySelector('.akari-timeline-issue-fallback')?.value ?? null`);
        rec.steps.popup = { popup, clipboard, fallback, clipboardMatchesRow: popup.popup.rows.join('\n') === clipboard };
        save();
        // Esc で閉じる
        await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await sleep(400);
        rec.steps.escape = await ev(SEAT);
        // 外側クリックで閉じる
        await clickChip();
        await waitFor(async () => (await ev(SEAT)).popup, 'popup again');
        // (a) 左パネルの見出し（main の DOM）を押す / (b) ホームの面（webview の場合あり）を押す
        const pointInfo = (x, y) => ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?{tag:e.tagName,cls:String(e.className).slice(0,80),text:(e.textContent||'').trim().slice(0,30)}:null})()`);
        rec.steps.outside = {};
        for (const [label, x, y] of [['side-panel-heading', 85, 527], ['home-surface', 700, 300]]) {
            if (!(await ev(SEAT)).popup) {
                await clickChip();
                await waitFor(async () => (await ev(SEAT)).popup, `popup before ${label}`);
            }
            const at = await pointInfo(x, y);
            await realClick(main, x, y);
            await sleep(400);
            const seat = await ev(SEAT);
            rec.steps.outside[label] = { at, popupClosed: !seat.popup };
        }
        rec.steps.focusLog = await ev(`window.__focusLog`);
        // 開いた状態でチップをもう一度押す → 閉じる（トグル）・受け皿が残らない
        if (!(await ev(SEAT)).popup) { await clickChip(); await waitFor(async () => (await ev(SEAT)).popup, 'popup before toggle'); }
        await clickChip();
        await sleep(500);
        rec.steps.toggle = { popupAfterSecondClick: !!(await ev(SEAT)).popup,
            backdrops: await ev(`document.querySelectorAll('[data-testid="akari-timeline-issue-backdrop"]').length`) };
        if ((await ev(SEAT)).popup) { await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300); }
        // Lint レポートを開く
        await clickChip();
        await waitFor(async () => (await ev(SEAT)).popup, 'popup for report');
        const tabsBefore = await ev(`[...document.querySelectorAll('.p-TabBar-tab .p-TabBar-tabLabel, .lm-TabBar-tab .lm-TabBar-tabLabel')].map(e=>e.textContent)`);
        const reportBtn = await ev(`(()=>{const r=document.querySelector('[data-testid="akari-timeline-issue-open-report"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
        await realClick(main, reportBtn.x, reportBtn.y);
        await sleep(2500);
        const tabsAfter = await ev(`[...document.querySelectorAll('.p-TabBar-tab .p-TabBar-tabLabel, .lm-TabBar-tab .lm-TabBar-tabLabel')].map(e=>e.textContent)`);
        const notifications = await ev(`[...document.querySelectorAll('.theia-notification-list-item')].map(e=>e.innerText.trim())`);
        await shot('open-report');
        rec.steps.openReport = { tabsBefore, tabsAfter, notifications, seat: await ev(SEAT) };
        save();
        await ev(`(()=>{document.querySelectorAll('.theia-notification-list-item .codicon-close').forEach(e=>e.click());return true})()`);
        await ev(`(()=>{const S=${SHELL};const W=${WGT};S.activateWidget(W.id);return true})()`);
        await sleep(600);
    } else {
        await sleep(8000);
        rec.steps.noChip = await ev(SEAT);
        await shot('no-chip');
        save();
    }

    // 3. ルーラーのクリック報告（中央席・4 秒）
    const ruler = await ev(`(()=>{const r=${WGT}.rulerBar.getBoundingClientRect();return{x:r.left+r.width*0.3,y:r.top+r.height/2}})()`);
    await realClick(main, ruler.x, ruler.y);
    const rulerShown = await waitFor(async () => { const s = await ev(SEAT); return s.message ? { ...s, at: Date.now() } : undefined; }, 'ruler message');
    await shot('ruler-message');
    { const sb = rulerShown.bar; await clipShot('statusbar-message', { x: sb.left, y: sb.top - 4, width: sb.width, height: sb.height + 8 }); }
    const rulerGone = await waitFor(async () => { const s = await ev(SEAT); return !s.message ? { ...s, at: Date.now() } : undefined; }, 'ruler message gone', 12000);
    rec.steps.ruler = { shown: rulerShown, gone: rulerGone, visibleMs: rulerGone.at - rulerShown.at };
    save();

    // 4. 警告の文言（8 秒）と長い文言の省略（足元の受け口 = 既存の書き込み経路へ書く）
    await ev(`(()=>{${WGT}.footer.textContent='このクリップはロック中のため動かせません。';return true})()`);
    const warnShown = await waitFor(async () => { const s = await ev(SEAT); return s.message ? { ...s, at: Date.now() } : undefined; }, 'warning message');
    const warnGone = await waitFor(async () => { const s = await ev(SEAT); return !s.message ? { ...s, at: Date.now() } : undefined; }, 'warning gone', 15000);
    rec.steps.warning = { shown: warnShown, gone: warnGone, visibleMs: warnGone.at - warnShown.at };
    const longText = '素材「とても長い名前の素材ファイル_2026-10-06_撮影分_カメラA_テイク12.mp4」を 00:00:12.345 の位置に置きました。続けて字幕の位置も合わせてください。';
    await ev(`(()=>{${WGT}.footer.textContent=${JSON.stringify(longText)};return true})()`);
    const longShown = await waitFor(async () => { const s = await ev(SEAT); return s.message ? s : undefined; }, 'long message');
    await shot('long-message');
    { const sb = longShown.bar; await clipShot('statusbar-long', { x: sb.left, y: sb.top - 4, width: sb.width, height: sb.height + 8 }); }
    rec.steps.long = { longText, shown: longShown, titleIsFull: longShown.message?.title === longText };
    save();
} catch (error) {
    rec.error = String(error?.stack ?? error);
    try {
        await screenshot(main, join(base, `${mode}-failure.png`));
        rec.failureDom = await evalOn(main, `({widget:!!document.getElementById('akari-annotations-widget'),items:document.querySelectorAll('[data-akari-item-kind]').length,text:document.body.innerText.slice(0,1500),focusLog:window.__focusLog??null,hasFocus:document.hasFocus()})`);
    } catch { /* 画面が取れなければ記録だけ */ }
    throw error;
} finally {
    save();
    try { main?.close?.(); } catch { /* 接続済みでなければ何もしない */ }
    electron.kill('SIGTERM');
    await Promise.race([once(electron, 'exit'), sleep(3000)]);
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
    closeSync(electronLog);
    if (clipboardBefore !== null) execFileSync('pbcopy', { input: clipboardBefore });
    console.log(JSON.stringify({ base, electronPid: electron.pid }));
}
