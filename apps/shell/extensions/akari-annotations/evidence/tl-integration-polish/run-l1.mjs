// タイムライン統合の仕上げ（最大化中のチップ・シャトルの画面追従・「切る」の札のアイコン）を実機で採る検証スクリプト。
// 使い方（リポのルートで、apps/shell を build 済みにしてから）:
//   node apps/shell/extensions/akari-annotations/evidence/tl-integration-polish/run-l1.mjs [記録先]
// 一時ディレクトリ（名前に tl-integration-polish を含む）に fixture を作り、CDP ポート 9472 で Electron を起動し、
// 自分が起動した PID だけを止める。記録物（JSON・PNG・ログ）は記録先（リポの外）へ書く。
import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { cp, copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from '../timeline-tracks/scripts/cdp-lib.mjs';

const PORT = 9472;
const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const base = process.argv[2] || await mkdtemp(join(tmpdir(), 'tl-integration-polish-'));
const workspace = join(base, 'tl-integration-polish-workspace');
const userData = join(base, 'tl-integration-polish-user-data');
const config = join(base, 'tl-integration-polish-config');
const akariHome = join(base, 'tl-integration-polish-home');
const rec = { at: new Date().toISOString(), base, steps: {} };
const save = () => writeFileSync(join(base, 'l1.json'), `${JSON.stringify(rec, null, 2)}\n`);

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
writeFileSync(join(workspace, 'edit.json'), `${JSON.stringify({
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'clip', path: 'assets/clip.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: cuts }]
}, null, 2)}\n`);

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
        await sleep(150);
    }
    throw new Error(`timeout: ${label}${lastError ? `; ${lastError}` : ''}`);
}

const SHELL = `(()=>{const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');return window.theia.container.get(k)})()`;
const WGT = `${SHELL}.getWidgets('bottom').find(w=>w.id==='akari-annotations-widget')`;
const VIEW = `(()=>{const W=${WGT};return{start:W.viewStart,dur:W.visibleDuration(),playhead:W.playheadT,label:W.zoomLabel.textContent,rate:Number(document.querySelector('[data-testid="akari-timeline-shuttle-rate"]')?.dataset.shuttleRate)}})()`;
const MESSAGE = `(()=>{const S=${SHELL};const W=${WGT};const chip=document.querySelector('[data-testid="akari-timeline-message-chip"]');const bar=document.getElementById('status-bar-akari-timeline-message');const box=e=>{const r=e.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const cs=chip&&getComputedStyle(chip);return{maximized:S.bottomPanel.hasClass('theia-maximized'),chip:chip?{shown:!chip.hidden&&cs.display!=='none',text:chip.textContent,fontSize:cs.fontSize,color:cs.color,background:cs.backgroundColor,border:cs.borderTopColor,borderLeftWidth:cs.borderLeftWidth,borderRightWidth:cs.borderRightWidth,box:box(chip),count:document.querySelectorAll('[data-testid="akari-timeline-message-chip"]').length}:null,status:bar?{text:bar.textContent.trim(),visible:bar.getClientRects().length>0&&!!document.elementFromPoint(box(bar).left+box(bar).width/2,box(bar).top+box(bar).height/2)?.closest('#status-bar-akari-timeline-message')}:null,body:box(W.timelineBody),widget:box(W.node)}})()`;

let main;
try {
    const target = await waitFor(async () => (await listTargets(PORT)).find(item => item.type === 'page'), 'main page', 60000);
    main = new CDP(target.webSocketDebuggerUrl);
    await main.connect();
    await main.send('Page.enable');
    await main.send('Runtime.enable');
    await main.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => evalOn(main, `document.readyState === 'complete' && !!window.theia?.container`), 'page ready', 60000);
    if (!await evalOn(main, `!!document.getElementById('akari-annotations-widget')`)) {
        await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
        await sleep(500);
        await main.send('Input.insertText', { text: 'タイムラインを開く' });
        await sleep(500);
        await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    }
    await waitFor(() => evalOn(main, `!!document.querySelector('[data-testid="akari-timeline-shuttle-rate"]')`), 'timeline', 60000);
    await waitFor(() => evalOn(main, `document.querySelectorAll('.akari-annotations-widget [data-akari-item-kind]').length >= 4`), 'timeline clips', 60000);
    await sleep(1500);
    const ev = expression => evalOn(main, expression);
    const shot = name => screenshot(main, join(base, `${name}.png`));
    const blur = () => ev(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    const rulerPoint = ratio => ev(`(()=>{const r=${WGT}.rulerBar.getBoundingClientRect();return{x:r.left+r.width*${ratio},y:r.top+r.height/2}})()`);
    const clickRuler = async ratio => { const p = await rulerPoint(ratio); await realClick(main, p.x, p.y); };
    const setMaximized = async on => {
        await ev(`(()=>{const S=${SHELL};const W=${WGT};if(S.bottomPanel.hasClass('theia-maximized')!==${on})S.toggleMaximized(W);return true})()`);
        await waitFor(async () => (await ev(MESSAGE)).maximized === on, `maximized=${on}`);
        await sleep(400);
    };

    // 起動時の案内トーストが右下を覆うので、計測の前に閉じる
    await ev(`(()=>{document.querySelectorAll('.akari-guide-announcement .close,.theia-notification-list-item .codicon-close').forEach(e=>e.click());return true})()`);
    await sleep(800);

    // 1. 最大化中はチップ・解除後はステータスバー
    await setMaximized(true);
    await clickRuler(0.3);
    const maxShown = await waitFor(async () => { const m = await ev(MESSAGE); return m.chip?.shown ? { ...m, at: Date.now() } : undefined; }, 'chip shown');
    await shot('1-maximized-chip');
    const maxHidden = await waitFor(async () => { const m = await ev(MESSAGE); return m.chip && !m.chip.shown ? { ...m, at: Date.now() } : undefined; }, 'chip hidden', 10000);
    rec.steps.maximized = { shown: maxShown, hidden: maxHidden, visibleMs: maxHidden.at - maxShown.at };
    save();

    await clickRuler(0.4);
    await waitFor(async () => (await ev(MESSAGE)).chip?.shown, 'chip shown before restore');
    await setMaximized(false);
    const afterRestore = await ev(MESSAGE);
    await setMaximized(true);
    const afterReMaximize = await ev(MESSAGE);
    await setMaximized(false);
    await sleep(4500);
    const afterTimeout = await ev(MESSAGE);
    rec.steps.toggleWhileShown = { afterRestore, afterReMaximize, afterTimeout };
    save();

    await clickRuler(0.5);
    const normalShown = await waitFor(async () => { const m = await ev(MESSAGE); return m.status ? { ...m, at: Date.now() } : undefined; }, 'status bar message');
    await shot('1-normal-status-bar');
    const normalGone = await waitFor(async () => { const m = await ev(MESSAGE); return !m.status ? { ...m, at: Date.now() } : undefined; }, 'status bar cleared', 10000);
    rec.steps.normal = { shown: normalShown, gone: normalGone, visibleMs: normalGone.at - normalShown.at };
    save();

    // 2. ズーム約 300% で LL / JJ → ビューが追従する
    await ev(`(()=>{const W=${WGT};W.applyViewDuration(W.contentEndDuration()/3,0,0);return true})()`);
    await clickRuler(0.02);
    await blur();
    await sleep(3500);
    const sample = async (label, ms) => {
        const rows = [];
        const end = Date.now() + ms;
        while (Date.now() < end) { rows.push({ t: Date.now(), ...await ev(VIEW) }); await sleep(100); }
        const pages = rows.filter((row, i) => i > 0 && row.start !== rows[i - 1].start).length;
        const outside = rows.filter(row => row.playhead < row.start - 1e-6 || row.playhead > row.start + row.dur + 1e-6);
        return { label, first: rows[0], last: rows.at(-1), viewChanges: pages, playheadOutsideSamples: outside.length, samples: rows.length,
            rows: rows.filter((_, i) => i % 5 === 0) };
    };
    const startForward = await ev(VIEW);
    await keyPress(main, { key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
    await sleep(120);
    await keyPress(main, { key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
    const forward = await sample('LL', 7000);
    await shot('2-shuttle-forward');
    await keyPress(main, { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 });
    await sleep(3500);
    const startReverse = await ev(VIEW);
    await keyPress(main, { key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
    await sleep(120);
    await keyPress(main, { key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74 });
    const reverse = await sample('JJ', 7000);
    await shot('2-shuttle-reverse');
    await keyPress(main, { key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 });
    rec.steps.shuttle = { startForward, forward, startReverse, reverse };
    save();

    // 3. 「切る」の札のアイコン
    const tag = await ev(`(()=>{const rows=[...document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id]')];return rows.map(row=>{const e=row.querySelector('[data-akari-ripple-mode]');const icon=e?.querySelector('.codicon');const r=e?.getBoundingClientRect();return{id:row.dataset.akariTimelineTrackId,mode:e?.dataset.akariRippleMode??null,text:e?.textContent??null,icon:icon?[...icon.classList].filter(c=>c.startsWith('codicon-')):null,iconWidth:icon?.getBoundingClientRect().width??null,glyph:icon?getComputedStyle(icon,'::before').content:null,box:r?{x:r.left,y:r.top,w:r.width,h:r.height}:null}})})()`);
    rec.steps.rippleTag = tag;
    const cutRow = tag.find(row => row.mode === 'cut' && row.box);
    if (cutRow) {
        const clip = { x: Math.max(0, cutRow.box.x - 160), y: Math.max(0, cutRow.box.y - 40), width: 420, height: 120, scale: 2 };
        const { data } = await main.send('Page.captureScreenshot', { format: 'png', clip });
        writeFileSync(join(base, '3-cut-tag.png'), Buffer.from(data, 'base64'));
    }
    await shot('3-track-headers');
    save();
} finally {
    save();
    try { main?.close?.(); } catch { /* 接続済みでなければ何もしない */ }
    electron.kill('SIGTERM');
    await Promise.race([once(electron, 'exit'), sleep(3000)]);
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
    closeSync(electronLog);
    console.log(JSON.stringify({ base, electronPid: electron.pid }));
}
