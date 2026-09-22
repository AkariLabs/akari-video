#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, keyPress } from '../../../akari-shell-strip/evidence/right-rail-regroup/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const shell = path.join(repo, 'apps/shell');
const temp = '/tmp/mode-switch-popup-l1';
const project = path.join(temp, 'project');
const intake = path.join(project, '.akari/intake.json');
const port = 9464;
const results = { checks: [], screenshots: [] };
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const E = expression => evalOn(cdp, expression);
let child;
let cdp;

async function waitFor(expression, label, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { const value = await E(expression); if (value) return value; } catch { /* still starting */ }
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        await sleep(300);
    }
    throw new Error(`Timed out: ${label}`);
}
async function state() {
    return E(`(()=>{const b=document.querySelector('.theia-sidebar-menu-item:has(> .akari-mode-switch-icon)');const p=document.querySelector('.akari-mode-popup');const r=e=>e?{left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,right:e.getBoundingClientRect().right,bottom:e.getBoundingClientRect().bottom,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}:null;return {button:r(b),popup:r(p),open:!!p,active:b?.classList.contains('akari-mode-switch-open'),route:!!b?.querySelector('svg circle[cx="6"]'),cards:[...(p?.querySelectorAll('.mo')||[])].map(e=>({label:e.querySelector('b')?.textContent,selected:e.classList.contains('on')})),contextMenus:document.querySelectorAll('.p-Menu,.lm-Menu,.theia-context-menu').length,theme:document.body.className,viewport:{width:innerWidth,height:innerHeight}}})()`);
}
async function shot(name) {
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    await writeFile(path.join(here, name), Buffer.from(data, 'base64'));
    results.screenshots.push(name);
}
async function clickButton() {
    const { button } = await state();
    assert(button, 'mode button missing');
    await realClick(cdp, button.left + button.width / 2, button.top + button.height / 2);
    // The popup transition lasts .2s; measure only its settled rect.
    await sleep(350);
}
function checkPosition(s, label) {
    assert(s.open && s.popup && s.button, `${label}: popup missing`);
    assert(s.popup.left >= 0 && s.popup.top >= 0 && s.popup.right <= s.viewport.width && s.popup.bottom <= s.viewport.height, `${label}: popup outside viewport`);
    assert(s.popup.right <= s.button.left - 7, `${label}: popup is not left of button`);
    assert(Math.abs(s.popup.bottom - s.button.bottom) <= 1.5, `${label}: popup is not aligned to button bottom`);
    assert(s.contextMenus === 0, `${label}: Theia context menu appeared`);
    results.checks.push({ label, ...s });
}

try {
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await mkdir(temp, { recursive: true });
    await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
    await writeFile(intake, '{\n  "autonomy": "checkpoint"\n}\n');
    const logPath = path.join(temp, 'electron.log');
    const logFd = openSync(logPath, 'w');
    child = spawn(path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, project, `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temp, 'user-data')}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: path.join(temp, 'config'), AKARI_HOME: path.join(temp, 'akari-home') }, stdio: ['ignore', 'ignore', logFd] });
    closeSync(logFd);
    let target;
    for (let i = 0; i < 180 && !target; i++) {
        try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch { /* starting */ }
        if (!target) await sleep(500);
    }
    assert(target, `Electron page unavailable: ${(await readFile(logPath, 'utf8')).slice(-1000)}`);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitFor(`!!window.theia?.container && !!document.querySelector('.akari-mode-switch-icon') && !document.querySelector('.theia-preload')`, 'mode button');
    await E(`(()=>{const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];const find=pred=>keys.find(k=>{try{return typeof k==='function'&&k.prototype&&pred(k.prototype)}catch{return false}});window.__modeShell=c.get(find(p=>typeof p.activateWidget==='function'&&typeof p.getLayoutData==='function'&&typeof p.revealWidget==='function'));window.__modeTheme=c.get(find(p=>typeof p.getThemes==='function'&&typeof p.setCurrentTheme==='function'));return true})()`);
    // Fresh installations may present the setup dialog over the shell.
    await E(`(()=>{const d=document.querySelector('[role="dialog"]');const close=d?.querySelector('[aria-label="閉じる"], .codicon-close');if(close)close.click();return true})()`);
    await sleep(400);
    await clickButton();
    let s = await state();
    checkPosition(s, 'dark-open');
    assert(s.cards.length === 3 && s.cards[1].selected && s.route && s.active, 'cards, current selection or route icon incorrect');
    await shot('01-dark-open.png');

    await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(120);
    assert(!(await state()).open, 'Escape did not close popup');
    results.checks.push({ label: 'escape-close', pass: true });
    await clickButton();
    await clickButton();
    assert(!(await state()).open, 'second button click did not toggle popup');
    results.checks.push({ label: 'button-toggle', pass: true });
    await clickButton();
    await realClick(cdp, 200, 180);
    await sleep(120);
    assert(!(await state()).open, 'outside click did not close popup');
    results.checks.push({ label: 'outside-close', pass: true });

    await clickButton();
    const before = JSON.parse(await readFile(intake, 'utf8'));
    const selected = await E(`(()=>{const r=document.querySelector('.mo[data-autonomy="collaborative"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await realClick(cdp, selected.x, selected.y);
    await sleep(550);
    const after = JSON.parse(await readFile(intake, 'utf8'));
    assert(before.autonomy === 'checkpoint' && after.autonomy === 'collaborative' && !(await state()).open, 'mode command did not save and close');
    results.checks.push({ label: 'save', before, after });

    await E(`(async()=>{await __modeShell.rightPanelHandler.collapse();return true})()`);
    await sleep(350);
    const collapsed = await E(`(()=>{const h=__modeShell.rightPanelHandler;const r=h.dockPanel.node.getBoundingClientRect();return {currentTitle:h.tabBar.currentTitle?.owner.id??null,expansion:h.state.expansion,dockHidden:h.dockPanel.isHidden,dockWidth:r.width,dockHeight:r.height}})()`);
    assert(collapsed.currentTitle === null && (collapsed.dockHidden || collapsed.dockWidth === 0), `right panel was not collapsed: ${JSON.stringify(collapsed)}`);
    results.checks.push({ label: 'right-panel-collapsed-state', ...collapsed });
    await clickButton();
    s = await state();
    checkPosition(s, 'collapsed-right-panel');
    await shot('02-collapsed-open.png');
    await clickButton();

    await E(`(async()=>{const sh=__modeShell;const w=sh.getWidgets('right').find(w=>w.id==='akari-daihon-widget');if(!w)throw Error('daihon widget missing');await sh.rightPanelHandler.dropPanel(w,'rbottom',(widget,area)=>sh.addWidget(widget,{area}));return sh.rightPanelHandler.railState()})()`);
    await sleep(400);
    await clickButton();
    s = await state();
    checkPosition(s, 'two-tier-right-rail');
    results.checks.push({ label: 'rail-split', state: await E('__modeShell.rightPanelHandler.railState()') });
    await shot('03-two-tier-open.png');
    await clickButton();

    await E(`(()=>{__modeTheme.setCurrentTheme('light');return true})()`);
    await sleep(350);
    await clickButton();
    s = await state();
    checkPosition(s, 'light-open');
    assert(s.theme.includes('theia-light'), 'light theme not active');
    await shot('04-light-open.png');
    results.status = 'PASS';
} catch (error) {
    results.status = 'FAIL';
    results.error = String(error?.stack ?? error);
    throw error;
} finally {
    await writeFile(path.join(here, 'l1-results.json'), `${JSON.stringify(results, null, 2)}\n`);
    cdp?.close();
    if (child?.pid) child.kill('SIGTERM');
    await sleep(400);
    if (child?.pid && child.exitCode === null) child.kill('SIGKILL');
    child?.unref();
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
