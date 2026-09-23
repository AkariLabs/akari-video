#!/usr/bin/env node
// L1（ラッパー検証専用）: 空のプロジェクトのホーム帯・再生ボタン・中身ありの帯・進め方ポップアップを実機で観測する。
// 使い方: node l1-home-empty.mjs <apps/shell 絶対パス> <before|after>
//   before = 基点 b07bb3fe のビルド、after = 本ブランチのビルド。結果は同ディレクトリへ <label>-*.png / <label>-results.json
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick } from '../../../akari-shell-strip/evidence/right-rail-regroup/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const shell = process.argv[2] ?? path.join(repo, 'apps/shell');
const label = process.argv[3] ?? 'after';
const temp = '/tmp/home-empty-and-mode-selected-l1';
const port = 9471;
const results = { label, shell, runs: {} };
let child; let cdp;
const E = expression => evalOn(cdp, expression);

async function waitFor(expression, what, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { const v = await E(expression); if (v) return v; } catch { /* starting */ }
        // 非表示ウィンドウでも描画を進めるためにフレームを要求する
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        await sleep(300);
    }
    throw new Error(`Timed out: ${what}`);
}
async function shot(name) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(here, `${label}-${name}.png`), Buffer.from(data, 'base64'));
}
async function clipShot(name, selector) {
    const r = await E(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height}})()`);
    if (!r) return;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    await writeFile(path.join(here, `${label}-${name}.png`), Buffer.from(data, 'base64'));
}

async function launch(project, userKey) {
    const logPath = path.join(temp, `${userKey}.log`);
    const fd = openSync(logPath, 'w');
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, project, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, `ud-${userKey}`)}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: path.join(temp, `cfg-${userKey}`), AKARI_HOME: path.join(temp, `home-${userKey}`) }, stdio: ['ignore', 'ignore', fd] });
    closeSync(fd);
    let target;
    for (let i = 0; i < 180 && !target; i++) {
        try { target = (await listTargets(port)).find(t => t.type === 'page'); } catch { /* starting */ }
        if (!target) await sleep(500);
    }
    if (!target) throw new Error(`no page: ${(await readFile(logPath, 'utf8')).slice(-800)}`);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(`!!window.theia?.container && !document.querySelector('.theia-preload')`, 'shell');
    await E(`(()=>{const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];const find=p=>keys.find(k=>{try{return typeof k==='function'&&k.prototype&&p(k.prototype)}catch{return false}});window.__shell=c.get(find(p=>typeof p.activateWidget==='function'&&typeof p.getLayoutData==='function'&&typeof p.revealWidget==='function'));window.__theme=c.get(find(p=>typeof p.getThemes==='function'&&typeof p.setCurrentTheme==='function'));return true})()`);
    await sleep(1500);
    await E(`(()=>{for(const d of document.querySelectorAll('[role="dialog"]')){const x=d.querySelector('[aria-label="閉じる"], .codicon-close');if(x)x.click()}return true})()`);
    await sleep(400);
}
async function stop() {
    cdp?.close(); cdp = undefined;
    if (child?.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ } }
    await sleep(1200);
    if (child?.pid && child.exitCode === null) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }
    child = undefined;
    await sleep(800);
}
async function setTheme(id) { await E(`(()=>{__theme.setCurrentTheme(${JSON.stringify(id)});return true})()`); await sleep(500); }
async function showHome() {
    await E(`(()=>{const w=__shell.getWidgets('main').find(w=>w.id&&/home/i.test(w.id));if(w)__shell.activateWidget(w.id);return true})()`);
    await waitFor(`!!document.querySelector('[data-akari-current-band]')`, 'home band', 60000);
    await sleep(800);
}
const bandState = `(()=>{const h=document.querySelector('[data-akari-current-hero]');const cs=h?getComputedStyle(h):null;const band=document.querySelector('[data-akari-current-band]');
 const img=h?.querySelector('img');
 return {heroTag:h?.tagName,heroClass:h?.className,heroBackgroundColor:cs?.backgroundColor,heroBackgroundImage:cs?.backgroundImage,heroSize:h?[h.getBoundingClientRect().width,h.getBoundingClientRect().height]:null,
  heroText:h?.innerText,hasPlayButton:!!document.querySelector('[aria-label="出力プレビューで再生"]'),hasPlayGlyph:!!h?.querySelector('.akari-current-play'),
  posterLoaded:img?img.complete&&img.naturalWidth>0:null,
  thumbnails:[...document.querySelectorAll('[data-akari-current-thumbnail]')].map(e=>({tag:e.tagName,cls:e.className,bg:getComputedStyle(e).backgroundColor,border:getComputedStyle(e).borderTopColor})),
  stats:[...document.querySelectorAll('[data-akari-stat]')].map(e=>e.getAttribute('data-akari-stat')+'='+e.querySelector('b')?.textContent),
  bandBackground:band?getComputedStyle(band).backgroundColor:null}})()`;
const errorsState = `(()=>({notifications:[...document.querySelectorAll('.theia-notification-list-item, .theia-notification-toast, .theia-notifications-container .theia-notification-message')].map(e=>e.innerText.trim()).filter(Boolean),
 statusBar:document.querySelector('#theia-statusBar')?.innerText.replace(/\\s+/g,' ').trim(),
 bodyHasOpenError:/開けませんでした/.test(document.body.innerText),
 openErrorSnippets:(document.body.innerText.match(/.{0,30}開けませんでした.{0,30}/g)||[])}))()`;
const modeState = `(()=>{const p=document.querySelector('.akari-mode-popup');if(!p)return null;const cards=[...p.querySelectorAll('.mo')].map(c=>{const cs=getComputedStyle(c);const bar=getComputedStyle(c,'::before');const ck=c.querySelector(':scope > svg');const ic=c.querySelector('.ic');
 return {label:c.querySelector('b')?.textContent,on:c.classList.contains('on'),background:cs.backgroundColor,border:cs.borderTopColor,barContent:bar.content,barBackground:bar.backgroundColor,barWidth:bar.width,checkVisible:ck?getComputedStyle(ck).visibility:null,checkColor:ck?getComputedStyle(ck).color:null,iconColor:ic?getComputedStyle(ic).color:null,iconBorder:ic?getComputedStyle(ic).borderTopColor:null,iconBackground:ic?getComputedStyle(ic).backgroundColor:null}});
 const b=document.querySelector('.theia-sidebar-menu-item:has(> .akari-mode-switch-icon)');const mk=b?getComputedStyle(b.querySelector('.akari-mode-switch-icon'),'::after'):null;
 return {cards,accent:getComputedStyle(document.body).getPropertyValue('--akari-accent').trim(),buttonTitle:b?.title||b?.getAttribute('aria-label'),buttonMarker:mk?{content:mk.content,background:mk.backgroundColor,width:mk.width}:null}})()`;

async function modeButtonRect() {
    return E(`(()=>{const b=document.querySelector('.theia-sidebar-menu-item:has(> .akari-mode-switch-icon)');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}

try {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await mkdir(temp, { recursive: true });

    // (1) 空のプロジェクト: 器 + 空の edit.json（素材 0）
    const empty = path.join(temp, 'empty-project');
    await cp(path.join(repo, 'templates/project-default'), empty, { recursive: true });
    await writeFile(path.join(empty, 'edit.json'), `${JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [] }, null, 2)}\n`);
    await mkdir(path.join(empty, '.akari'), { recursive: true });
    await writeFile(path.join(empty, '.akari/intake.json'), '{\n  "autonomy": "checkpoint"\n}\n');
    await launch(empty, 'empty');
    for (const theme of ['dark', 'light']) {
        await setTheme(theme);
        await showHome();
        const run = { band: await E(bandState) };
        await shot(`${theme}-empty-home`);
        await clipShot(`${theme}-empty-band`, '[data-akari-current-band]');
        // 再生ボタン（あれば）/ 大きなサムネを押す
        const target = await E(`(()=>{const e=document.querySelector('[aria-label="出力プレビューで再生"]')||document.querySelector('[data-akari-current-hero]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/4,what:e.getAttribute('aria-label')||e.className}})()`);
        run.clicked = target;
        if (target) { await realClick(cdp, target.x, target.y); }
        await sleep(3500);
        run.afterClick = await E(errorsState);
        run.activeMain = await E(`__shell.currentWidget?.id ?? null`);
        await shot(`${theme}-empty-after-click`);
        await E(`(()=>{for(const d of document.querySelectorAll('[role="dialog"]')){const x=d.querySelector('[aria-label="閉じる"], .codicon-close');if(x)x.click()}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true})()`);
        await sleep(400);
        // 次の一手（空の表示のボタン）→ 始め方の窓
        await showHome();
        const action = await E(`(()=>{const e=document.querySelector('.akari-current-empty-action');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,text:e.textContent}})()`);
        if (action) {
            await realClick(cdp, action.x, action.y);
            await sleep(900);
            run.nextStep = { button: action.text, dialog: await E(`(()=>{const d=[...document.querySelectorAll('[role="dialog"], .akari-home-scrim, [class*="scrim"]')].map(e=>e.innerText.trim()).filter(Boolean);return d[0]?.slice(0,200)??null})()`) };
            await shot(`${theme}-empty-next-step`);
            await E(`(()=>{for(const d of document.querySelectorAll('[role="dialog"], [class*="scrim"]')){const x=d.querySelector('[aria-label="閉じる"], .codicon-close');if(x){x.click();break}}return true})()`);
            await sleep(500);
        }
        // 進め方ポップアップ
        await showHome();
        const btn = await modeButtonRect();
        if (btn) {
            await realClick(cdp, btn.x, btn.y);
            await sleep(450);
            run.mode = await E(modeState);
            await shot(`${theme}-mode-popup`);
            await clipShot(`${theme}-mode-popup-crop`, '.akari-mode-popup');
            await realClick(cdp, btn.x, btn.y);
            await sleep(300);
        }
        results.runs[`empty-${theme}`] = run;
    }
    await stop();

    // (1b) edit.json がまだ無いプロジェクト（器をコピーしただけ）
    const noedit = path.join(temp, 'noedit-project');
    await cp(path.join(repo, 'templates/project-default'), noedit, { recursive: true });
    await launch(noedit, 'noedit');
    {
        await setTheme('dark');
        await showHome();
        const run = { band: await E(bandState) };
        await clipShot('dark-noedit-band', '[data-akari-current-band]');
        const target = await E(`(()=>{const e=document.querySelector('[aria-label="出力プレビューで再生"]')||document.querySelector('[data-akari-current-hero]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/4,what:e.getAttribute('aria-label')||e.className}})()`);
        run.clicked = target;
        if (target) { await realClick(cdp, target.x, target.y); }
        await sleep(1500);
        run.afterClick = await E(errorsState);
        run.activeMain = await E(`__shell.currentWidget?.id ?? null`);
        await shot('dark-noedit-after-click');
        results.runs['noedit-dark'] = run;
    }
    await stop();

    // (2) 中身のあるプロジェクト（帯の見た目が前後で同じか）
    const full = path.join(temp, 'content-project');
    await cp(path.join(repo, 'templates/project-default'), full, { recursive: true });
    await mkdir(path.join(full, 'assets'), { recursive: true });
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(full, 'assets/take-a.mp4')]);
    await writeFile(path.join(full, 'edit.json'), `${JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 'a', path: 'assets/take-a.mp4' }],
        tracks: [{ id: 'v-main', lane: 'visual', items: [{ id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } }] }] }, null, 2)}\n`);
    await launch(full, 'content');
    for (const theme of ['dark', 'light']) {
        await setTheme(theme);
        await showHome();
        await waitFor(`(()=>{const i=document.querySelector('[data-akari-current-hero] img');return !!i&&i.complete&&i.naturalWidth>0})()`, 'poster', 60000).catch(() => undefined);
        await sleep(800);
        results.runs[`content-${theme}`] = { band: await E(bandState) };
        await clipShot(`${theme}-content-band`, '[data-akari-current-band]');
    }
    await stop();
    results.status = 'DONE';
} catch (error) {
    results.status = 'ERROR';
    results.error = String(error?.stack ?? error);
    console.error(error);
} finally {
    await stop();
    await writeFile(path.join(here, `${label}-results.json`), `${JSON.stringify(results, null, 2)}\n`);
    if (!process.env.KEEP_TEMP) await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
}
