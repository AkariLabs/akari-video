#!/usr/bin/env node
// L1（task 2026-09-22-right-rail-regroup）: 実機（Electron + CDP・ダーク）で、右端のレールが 1 本・区切り線が縦の
// 真ん中・上にエージェント・下に 5 パネル・右パネルは起動時 1 面であること、ホバーで 100ms 以内に名前だけが出ること、
// 5 パネルのアイコン、実マウスのドラッグでメイン / レールの線の上 / 右の下半分へ置けること、2 段の規則（区切り線どおり）、
// 1 面に戻す 3 通り、既存の呼び出し、再起動での復元、壊れた保存データでの既定を観測する。
//
// 使い方: node l1-right-rail-regroup.mjs [--port=9458]
// 一時ディレクトリは /tmp/right-rail-regroup-l1（AKARI_HOME・--user-data-dir・THEIA_CONFIG_DIR も専用）。
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, realDrag } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const L1 = '/tmp/right-rail-regroup-l1';
const PROJECT = path.join(L1, 'project');
const ISO = path.join(L1, 'iso-main');
const FIXTURE_DIR = path.join(ROOT, 'fixture');
const RESULTS = path.join(ROOT, 'results.json');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const PORT = Number(arg('port') ?? 9458);
const S = value => JSON.stringify(value);
const out = { status: 'running', startedAt: new Date().toISOString(), port: PORT, steps: [], screenshots: [] };

const ID = {
    partner: 'akari-partner-onboarding', daihon: 'akari-daihon-widget', cuts: 'akari-cuts-widget',
    review: 'akari-review-panel-widget', inspector: 'akari-inspector-widget', meter: 'akari-audio-meter-widget'
};
const LOWER_FIVE = [ID.daihon, ID.cuts, ID.review, ID.inspector, ID.meter];

const sanitize = value => String(value?.stack || value?.message || value)
    .replaceAll(REPO, '<worktree>').replace(/\/Users\/[^\s)"]+/g, '<machine-path>');
const save = async () => {
    const temporary = `${RESULTS}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(out, null, 2)}\n`);
    await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const run = (command, args, { cwd = ROOT, timeoutMs = 60_000 } = {}) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)); });
});

async function step(name, operation) {
    const record = { name, pass: false };
    out.steps.push(record);
    const started = Date.now();
    console.log(`▶ ${name}`);
    try { record.detail = await operation(); record.pass = true; console.log('  ✓'); return record.detail; }
    catch (error) { record.error = sanitize(error); console.log(`  ✗ ${record.error.split('\n')[0]}`); throw error; }
    finally { record.ms = Date.now() - started; await save(); }
}
async function waitEval(cdp, expression, { timeoutMs = 90_000, intervalMs = 300, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; }
        await sleep(intervalMs);
    }
    throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
// 背面の Electron は描画を止めるので、スクリーンショットを取ってフレームを回しながら preload が外れるのを待つ。
async function pumpFrames(cdp, timeoutMs = 600_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        if (await evalOn(cdp, `!document.querySelector('.theia-preload')&&!!document.getElementById('theia-right-content-panel')`).catch(() => false)) return;
        await sleep(300);
    }
    throw new Error('preload overlay never detached');
}
async function shot(cdp, file, clip) {
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    // clip は fromSurface: false では無視されるので、切り抜きのときだけ描画面から撮る。
    const params = clip ? { format: 'png', fromSurface: true, clip: { ...clip, scale: 3 } } : { format: 'png', fromSurface: false };
    const { data } = await cdp.send('Page.captureScreenshot', params);
    await writeFile(path.join(ROOT, file), Buffer.from(data, 'base64'));
    out.screenshots.push(file);
}

// ページ内ヘルパー。Theia のクラス名は production バンドルで縮むため、プロトタイプの形で DI キーを探す。
const HELPERS = `(()=>{
  const c=window.theia.container; const keys=[...c._bindingDictionary._map.keys()];
  const fk=pred=>keys.find(k=>{try{return typeof k==='function'&&k.prototype&&pred(k.prototype)}catch{return false}});
  window.__svc=()=>({
    sh:c.get(fk(p=>typeof p.activateWidget==='function'&&typeof p.getLayoutData==='function'&&typeof p.revealWidget==='function')),
    app:c.get(fk(p=>typeof p.restoreLayout==='function'&&typeof p.start==='function')),
    lr:c.get(fk(p=>typeof p.storeLayout==='function'&&typeof p.restoreLayout==='function')),
    cmd:c.get(fk(p=>typeof p.executeCommand==='function')),
    dnd:c.get(fk(p=>typeof p.zonesFor==='function'&&typeof p.drop==='function'))
  });
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
  window.__rect=r;
  window.__state=()=>{
    const sh=__svc().sh,h=sh.rightPanelHandler;
    const dock=document.getElementById('theia-right-side-panel');
    const dockShown=!h.dockPanel.isHidden;
    const panes=dockShown?[...dock.children].filter(e=>e.classList.contains('lm-DockPanel-widget')&&!e.classList.contains('lm-mod-hidden')&&e.getBoundingClientRect().height>0).map(e=>({id:e.id,rect:r(e)})).sort((a,b)=>a.rect.y-b.rect.y):[];
    const headers=dockShown?[...dock.querySelectorAll(':scope > .lm-TabBar')].filter(b=>!b.classList.contains('lm-mod-hidden')).map(b=>({rect:r(b),focus:b.classList.contains('akari-rail-pane-focus'),label:(b.querySelector('.lm-TabBar-tab.lm-mod-current .lm-TabBar-tabLabel')||{}).textContent,close:!!b.querySelector('.akari-rail-pane-close')})):[];
    const handles=dockShown?[...dock.querySelectorAll(':scope > .lm-DockPanel-handle')].filter(x=>!x.classList.contains('lm-mod-hidden')).map(r):[];
    const bar=h.tabBar.node;
    const rail=[...h.tabBar.contentNode.children].map((t,i)=>({id:h.tabBar.titles[i].owner.id,label:h.tabBar.titles[i].label,group:t.classList.contains('akari-rail-agent')?'agent':t.classList.contains('akari-rail-lower')?'lower':null,
      current:t.classList.contains('lm-mod-current'),shown:t.classList.contains('akari-rail-shown'),icon:(t.querySelector('.lm-TabBar-tabIcon')||{}).className,rect:r(t)}));
    const railRect=r(bar);const middle=parseFloat(getComputedStyle(bar).getPropertyValue('--akari-rail-middle'));
    const sep=getComputedStyle(bar,'::after');
    const toolbar=document.querySelector('#theia-right-content-panel .theia-sidepanel-toolbar');
    return {railRect,separator:{y:railRect.y+middle,top:railRect.y+parseFloat(sep.top),display:sep.display,width:sep.width,height:sep.height,left:railRect.x+parseFloat(sep.left)},crowded:bar.classList.contains('akari-rail-crowded'),
      rail,current:h.tabBar.currentTitle?.owner.id??null,dockShown,panes,headers,handles,
      toolbar:toolbar&&!toolbar.classList.contains('lm-mod-hidden')?{rect:r(toolbar),title:(toolbar.querySelector('.theia-sidepanel-title')||{}).textContent}:null,
      rail_state:h.railState(),main:sh.getWidgets('main').map(w=>w.id),bottom:sh.getWidgets('bottom').map(w=>w.id),
      bottomMenu:r([...document.querySelectorAll('.theia-sidebar-menu-item')].filter(e=>e.getBoundingClientRect().left>innerWidth/2).at(-1)),
      theme:document.body.className.match(/theia-(dark|light)/)?.[0]??null,window:{w:innerWidth,h:innerHeight}};
  };
  window.__layoutKey=()=>Object.keys(localStorage).filter(k=>/:layout$/.test(k));
  window.__readLayout=k=>{let v=JSON.parse(localStorage.getItem(k));return typeof v==='string'?JSON.parse(v):v};
  window.__writeLayout=(k,l)=>{const raw=JSON.parse(localStorage.getItem(k));localStorage.setItem(k,JSON.stringify(typeof raw==='string'?JSON.stringify(l):l))};
  // ホバー計測: document の mouseover（capture）と、ツールチップが表示された瞬間を performance.now() で記録する。
  window.__tip={over:null,shown:null,text:null};
  const tip=document.querySelector('.akari-rail-tip');
  new MutationObserver(()=>{if(tip.style.display==='block'&&window.__tip.shown===null){window.__tip.shown=performance.now();window.__tip.text=tip.textContent}}).observe(tip,{attributes:true,childList:true,characterData:true,subtree:true});
  document.addEventListener('mouseover',()=>{if(window.__tip.over===null)window.__tip.over=performance.now()},true);
  return 'ok';
})()`;
const cmd = id => `(async()=>{let error=null;try{await __svc().cmd.executeCommand(${S(id)})}catch(e){error=String(e&&e.message||e)}await new Promise(r=>setTimeout(r,900));const s=__state();if(error)s.commandError=error;return s})()`;
const storeLayout = `(async()=>{const s=__svc();await s.lr.storeLayout(s.app);const k=__layoutKey();return {keys:k,layout:k.length?__readLayout(k[0]):null}})()`;
const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

async function launch(label) {
    const log = path.join(L1, `${label}.log`);
    const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), SHELL, PROJECT, String(PORT), ISO, log]);
    const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
    assert(Number.isInteger(pid) && pid > 0, 'Electron PID was not reported');
    const started = Date.now();
    let target;
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline && !target) {
        try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch { /* not up yet */ }
        if (!target) await sleep(500);
    }
    assert(target, 'CDP page target did not appear');
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await pumpFrames(cdp);
    await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.querySelector('.akari-rail-tip'))`, { label: 'Theia container' });
    await evalOn(cdp, HELPERS);
    await sleep(2500);
    out.launches = [...(out.launches ?? []), { label, readyMs: Date.now() - started }];
    return { pid, cdp, label };
}
async function stop(session) {
    if (!session) return;
    session.cdp?.close();
    try { process.kill(session.pid, 'SIGTERM'); } catch { /* already gone */ }
    let alive = true;
    for (let i = 0; i < 60 && alive; i++) {
        try { process.kill(session.pid, 0); await sleep(500); } catch { alive = false; }
    }
    if (alive) { try { process.kill(session.pid, 'SIGKILL'); } catch { /* gone */ } }
    for (let i = 0; i < 120; i++) {
        try { await listTargets(PORT); await sleep(500); } catch { break; }
    }
    await sleep(1000);
}
const center = rect => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
const railTab = (state, id) => state.rail.find(item => item.id === id);
/** 押すと畳む（出ているものを押した）場合があるので、前面にするだけの準備は activateWidget で行う。 */
const activate = (cdp, id) => evalOn(cdp, `(async()=>{await __svc().sh.activateWidget(${S(id)});await new Promise(r=>setTimeout(r,900));return __state()})()`);
async function clickRail(cdp, id) {
    const state = await evalOn(cdp, '__state()');
    const tab = railTab(state, id);
    assert(tab, `rail tab ${id} missing`);
    await realClick(cdp, center(tab.rect).x, center(tab.rect).y);
    await sleep(900);
    return evalOn(cdp, '__state()');
}
/** 実マウスのドラッグ。途中で止めて置き場所の表示を記録・撮影し、離す。 */
async function dragTo(cdp, from, to, { midShot, label } = {}) {
    const { x, y } = from;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (to.x - x) * i / steps, y: y + (to.y - y) * i / steps, button: 'left', buttons: 1 });
        await sleep(25);
    }
    await sleep(250);
    const zones = await evalOn(cdp, `[...document.querySelectorAll('.akari-rail-drop')].map(e=>({zone:e.dataset.zone,label:e.textContent,hot:e.classList.contains('akari-rail-drop-hot'),rect:__rect(e)}))`);
    if (midShot) await shot(cdp, midShot);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left' });
    await sleep(1200);
    const after = await evalOn(cdp, '__state()');
    const leftover = await evalOn(cdp, `document.querySelectorAll('.akari-rail-drop').length`);
    assert(leftover === 0, `${label}: drop zones left on screen`);
    return { zones, after };
}
function assertOnePane(state, where) {
    assert(state.dockShown, `${where}: right panel collapsed`);
    assert(!state.rail_state.split, `${where}: still split`);
    assert(state.panes.length === 1, `${where}: expected 1 visible pane, got ${S(state.panes)}`);
    assert(state.headers.length === 0, `${where}: pane headers visible in 1-pane mode`);
}
function assertTwoPanes(state, where) {
    assert(state.dockShown && state.rail_state.split, `${where}: not split`);
    assert(state.panes.length === 2 && state.headers.length === 2, `${where}: expected 2 panes / headers ${S({ panes: state.panes, headers: state.headers })}`);
    const [top, bottom] = state.panes;
    assert(top.id === state.rail_state.top && bottom.id === state.rail_state.bottom, `${where}: panes ${top.id}/${bottom.id} vs state ${state.rail_state.top}/${state.rail_state.bottom}`);
    assert(railTab(state, top.id).group === 'agent' && railTab(state, bottom.id).group === 'lower', `${where}: panes do not follow the line`);
    assert(top.rect.y + top.rect.h <= bottom.rect.y, `${where}: panes overlap`);
}
const summary = state => ({
    current: state.current, split: state.rail_state.split, top: state.rail_state.top, bottom: state.rail_state.bottom, focus: state.rail_state.focus,
    panes: state.panes, headers: state.headers, groups: state.rail_state.groups, displaced: state.rail_state.displaced,
    rail: state.rail.map(item => `${item.id}:${item.group}${item.current ? ':current' : ''}${item.shown ? ':shown' : ''}@${item.rect.y}`), main: state.main
});

let session;
try {
    await rm(L1, { recursive: true, force: true });
    await mkdir(L1, { recursive: true });
    await mkdir(FIXTURE_DIR, { recursive: true });
    await cp(path.join(REPO, 'templates', 'project-default'), PROJECT, { recursive: true });
    await writeFile(path.join(PROJECT, '.akari', 'intake.json'), `${JSON.stringify({ autonomy: 'checkpoint' }, null, 2)}\n`);

    session = await launch('main-1');
    const cdp = () => session.cdp;

    // ---- 1. 起動直後 ----
    await step('1. 起動時: レールは 1 本・区切り線が縦の真ん中・上にエージェント・下に 5 パネル・右パネルは 1 面（ダーク）', async () => {
        // インスペクターと音声メーターは開くまでレールに居ないので、開く操作で住人を揃えてから、パートナーを前面に戻す。
        await evalOn(cdp(), cmd('akari.inspector.open'));
        await evalOn(cdp(), cmd('akari.preview.openAudioMeter'));
        const state = await evalOn(cdp(), `(async()=>{await __svc().sh.activateWidget(${S(ID.partner)});await new Promise(r=>setTimeout(r,1200));return __state()})()`);
        assert(state.theme === 'theia-dark', `theme ${state.theme}`);
        const rails = await evalOn(cdp(), `document.querySelectorAll('.lm-TabBar.theia-app-right').length`);
        assert(rails === 1, `right rails ${rails}`);
        assertOnePane(state, 'startup');
        const agents = state.rail.filter(item => item.group === 'agent').map(item => item.id);
        const lower = state.rail.filter(item => item.group === 'lower').map(item => item.id);
        assert(S(agents) === S([ID.partner]), `agents ${S(agents)}`);
        assert(S(lower) === S(LOWER_FIVE), `lower ${S(lower)}`);
        const railMiddle = state.railRect.y + state.railRect.h / 2;
        assert(Math.abs(state.separator.top - railMiddle) <= 1, `separator ${state.separator.top} vs rail middle ${railMiddle}`);
        assert(state.separator.display !== 'none', 'separator hidden');
        const lastAgent = railTab(state, agents.at(-1)).rect;
        const firstLower = railTab(state, lower[0]).rect;
        assert(lastAgent.y + lastAgent.h < state.separator.top && firstLower.y > state.separator.top, 'icons are not split by the line');
        assert(state.bottomMenu && state.bottomMenu.y >= state.railRect.y + state.railRect.h, 'bottom menu is not at the bottom');
        await shot(cdp(), '01-startup-one-pane-rail.png');
        return { theme: state.theme, window: state.window, railRect: state.railRect, railMiddleY: railMiddle, separator: state.separator,
            lastAgentIcon: lastAgent, firstLowerIcon: firstLower, rail: summary(state).rail, panes: state.panes, toolbar: state.toolbar, bottomMenu: state.bottomMenu };
    });

    // ---- 2. ホバー ----
    await step('2. レールのアイコンにホバー → 100ms 以内に名前だけのツールチップ（Theia の遅延ツールチップは出ない）', async () => {
        const state = await evalOn(cdp(), '__state()');
        const records = [];
        const expected = { [ID.partner]: 'パートナーを追加', [ID.daihon]: '台本', [ID.cuts]: 'カット', [ID.review]: '注釈', [ID.inspector]: 'インスペクター', [ID.meter]: '音声メーター' };
        for (const item of state.rail) {
            await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 330, button: 'none' });
            await sleep(150);
            await evalOn(cdp(), `(()=>{window.__tip={over:null,shown:null,text:null};return 1})()`);
            const sentAt = await evalOn(cdp(), 'performance.now()');
            const p = center(item.rect);
            await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
            await sleep(120);
            const tip = await evalOn(cdp(), `({...window.__tip,rect:__rect(document.querySelector('.akari-rail-tip')),visible:document.querySelector('.akari-rail-tip').style.display==='block'})`);
            assert(tip.visible && tip.shown !== null, `${item.id}: tooltip not shown`);
            const fromSend = tip.shown - sentAt;
            const fromOver = tip.shown - tip.over;
            assert(fromSend <= 100, `${item.id}: tooltip after ${fromSend}ms`);
            assert(tip.text === item.label, `${item.id}: tooltip "${tip.text}"`);
            if (expected[item.id]) assert(tip.text === expected[item.id], `${item.id}: expected ${expected[item.id]}, got ${tip.text}`);
            records.push({ id: item.id, text: tip.text, msFromMouseMove: round(fromSend, 1), msFromMouseOver: round(fromOver, 1), tipRect: tip.rect });
            if (item.id === ID.inspector) await shot(cdp(), '02-hover-tooltip-inspector.png');
        }
        // 長い説明（caption）の遅延ツールチップが出ないこと: 乗せたまま 2 秒待つ。
        const insp = railTab(state, ID.inspector);
        await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center(insp.rect).x, y: center(insp.rect).y + 1, button: 'none' });
        await sleep(2000);
        const delayed = await evalOn(cdp(), `[...document.querySelectorAll('.theia-hover')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>0).map(e=>e.textContent)`);
        assert(delayed.length === 0, `delayed Theia hover appeared: ${S(delayed)}`);
        const caption = await evalOn(cdp(), `__svc().sh.rightPanelHandler.tabBar.titles.find(t=>t.owner.id===${S(ID.inspector)}).caption`);
        await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 800, y: 330, button: 'none' });
        return { records, maxMsFromMouseMove: Math.max(...records.map(item => item.msFromMouseMove)), delayedHoverAfter2s: delayed, inspectorCaptionNotShown: caption };
    });

    // ---- 3. アイコン ----
    await step('3. 5 パネルのアイコンがハサミ / 紙 / 吹き出し / つまみ / レベルのバー（線画）', async () => {
        const state = await evalOn(cdp(), '__state()');
        const icons = Object.fromEntries(state.rail.map(item => [item.id, item.icon]));
        const expected = { [ID.daihon]: 'akari-rail-icon-daihon', [ID.cuts]: 'akari-rail-icon-cuts', [ID.review]: 'akari-rail-icon-review', [ID.inspector]: 'akari-rail-icon-inspector', [ID.meter]: 'akari-rail-icon-audio-meter' };
        for (const [id, cls] of Object.entries(expected)) assert(icons[id].includes(cls) && !icons[id].includes('codicon'), `${id} icon ${icons[id]}`);
        const masks = await evalOn(cdp(), `(()=>{const o={};for(const t of document.querySelectorAll('.theia-app-right .lm-TabBar-content .akari-rail-icon')){const cs=getComputedStyle(t);o[t.className]={w:t.clientWidth,h:t.clientHeight,maskSize:cs.webkitMaskSize||cs.maskSize,mask:(cs.webkitMaskImage||cs.maskImage).slice(0,40)}}return o})()`);
        const top = railTab(state, ID.daihon).rect;
        await shot(cdp(), '03-rail-icons.png', { x: state.railRect.x - 4, y: top.y - 12, width: state.railRect.w + 8, height: 5 * 52 + 24 });
        return { icons, masks, tabHeights: state.rail.map(item => `${item.id}:${item.rect.h}`) };
    });

    // ---- 4. カットをメインへ → 戻す ----
    await step('4. カットをレールからメインへドラッグ → メインのタブになりレールから消える → メインのタブをレールの線の下へ戻すと元どおり', async () => {
        let state = await evalOn(cdp(), '__state()');
        const cuts = railTab(state, ID.cuts);
        const mainRect = await evalOn(cdp(), `__rect(document.getElementById('theia-main-content-panel'))`);
        const toMain = await dragTo(cdp(), center(cuts.rect), { x: mainRect.x + mainRect.w / 2, y: mainRect.y + mainRect.h / 2 }, { midShot: '04a-drag-cuts-zones.png', label: 'cuts→main' });
        assert(toMain.zones.some(zone => zone.zone === 'main' && zone.hot), `main zone not hot: ${S(toMain.zones)}`);
        state = toMain.after;
        assert(state.main.includes(ID.cuts), `cuts not in main ${S(state.main)}`);
        assert(!railTab(state, ID.cuts), 'cuts still on the rail');
        const mainTab = await evalOn(cdp(), `(()=>{const e=document.querySelector('#theia-main-content-panel #shell-tab-${ID.cuts}');return e?{rect:__rect(e),current:e.classList.contains('lm-mod-current')}:null})()`);
        assert(mainTab?.current, 'cuts is not the current main tab');
        assert(state.rail_state.displaced[ID.cuts] === 'main', 'displaced not recorded');
        await shot(cdp(), '04b-cuts-in-main.png');
        const inMain = { mainTab, rail: summary(state).rail, zonesShown: toMain.zones.map(zone => zone.zone) };
        const railBottom = { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h * 0.75 };
        const back = await dragTo(cdp(), center(mainTab.rect), railBottom, { midShot: '04c-drag-main-tab-back-zones.png', label: 'cuts→rail' });
        assert(back.zones.some(zone => zone.zone === 'railbottom' && zone.hot), `railbottom not hot: ${S(back.zones)}`);
        assert(!back.zones.some(zone => zone.zone === 'main'), 'main zone shown while the panel is already in main');
        state = back.after;
        assert(!state.main.includes(ID.cuts), 'cuts still in main');
        const lower = state.rail.filter(item => item.group === 'lower').map(item => item.id);
        assert(S(lower) === S(LOWER_FIVE), `lower after return ${S(lower)}`);
        assert(!(ID.cuts in state.rail_state.displaced), 'displaced not cleared');
        await shot(cdp(), '04d-cuts-back-on-rail.png');
        return { inMain, zonesWhileReturning: back.zones.map(zone => zone.zone), afterReturn: summary(state) };
    });

    // ---- 5. 注釈を線の上へ ----
    await step('5. 注釈をレールの線の上へドラッグ → 上の所属になる', async () => {
        let state = await evalOn(cdp(), '__state()');
        const review = railTab(state, ID.review);
        const railTop = { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h * 0.3 };
        const moved = await dragTo(cdp(), center(review.rect), railTop, { midShot: '05a-drag-review-zones.png', label: 'review→railtop' });
        assert(moved.zones.some(zone => zone.zone === 'railtop' && zone.hot), `railtop not hot ${S(moved.zones)}`);
        state = moved.after;
        assert(railTab(state, ID.review).group === 'agent', 'review is not above the line');
        assert(railTab(state, ID.review).rect.y + railTab(state, ID.review).rect.h < state.separator.top, 'review icon is not above the separator');
        assert(state.rail_state.groups[ID.review] === 'agent', 'group not recorded');
        assertOnePane(state, 'after review→railtop');
        await shot(cdp(), '05b-review-above-line.png');
        return { ...summary(state), separator: state.separator };
    });

    // ---- 6. インスペクターを右の下半分へ ----
    await step('6. インスペクターを右パネルの下半分へドラッグ → そのときだけ 2 段（上 = 出ていたエージェント / 下 = インスペクター）', async () => {
        let state = await activate(cdp(), ID.partner);
        assert(state.current === ID.partner, 'partner not shown');
        const insp = railTab(state, ID.inspector);
        const dock = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
        const target = { x: dock.x + dock.w / 2, y: dock.y + dock.h * 0.75 };
        const moved = await dragTo(cdp(), center(insp.rect), target, { midShot: '06a-drag-inspector-zones.png', label: 'inspector→rbottom' });
        assert(moved.zones.some(zone => zone.zone === 'rbottom' && zone.hot), `rbottom not hot ${S(moved.zones)}`);
        state = moved.after;
        assertTwoPanes(state, 'after split');
        assert(state.rail_state.top === ID.partner && state.rail_state.bottom === ID.inspector, `panes ${state.rail_state.top}/${state.rail_state.bottom}`);
        assert(state.headers[1].focus && !state.headers[0].focus, 'focus should be on the bottom pane');
        assert(railTab(state, ID.inspector).current && railTab(state, ID.partner).shown, 'rail does not show both panes');
        assert(state.handles.length === 1, 'gutter missing');
        await shot(cdp(), '06b-two-panes.png');
        return { ...summary(state), handle: state.handles[0], zones: moved.zones };
    });

    // ---- 7. 2 段の規則 ----
    await step('7. 2 段で、線の上のアイコンを押すと上の段、線の下のアイコンを押すと下の段が変わる（フォーカスも移る）', async () => {
        const records = [];
        const expectations = [
            [ID.review, 'top'], [ID.meter, 'bottom'], [ID.daihon, 'bottom'], [ID.partner, 'top'], [ID.cuts, 'bottom']
        ];
        let before = await evalOn(cdp(), '__state()');
        for (const [id, slot] of expectations) {
            const state = await clickRail(cdp(), id);
            assertTwoPanes(state, `click ${id}`);
            const other = slot === 'top' ? 'bottom' : 'top';
            assert(state.rail_state[slot] === id, `${id} should replace the ${slot} pane (${S(summary(state))})`);
            assert(state.rail_state[other] === before.rail_state[other], `${id} changed the ${other} pane`);
            assert(state.rail_state.focus === slot && state.headers[slot === 'top' ? 0 : 1].focus, `focus not moved to ${slot}`);
            assert(state.current === id, `rail current ${state.current}`);
            records.push({ clicked: id, slot, top: state.rail_state.top, bottom: state.rail_state.bottom, focus: state.rail_state.focus, panes: state.panes.map(pane => `${pane.id}@${S(pane.rect)}`) });
            before = state;
            if (id === ID.review) await shot(cdp(), '07a-click-above-line-top-pane.png');
            if (id === ID.meter) await shot(cdp(), '07b-click-below-line-bottom-pane.png');
        }
        // 出ているものを押す → その段へフォーカスを移すだけ。段の中をクリックしてもフォーカスが移る。
        const refocus = await clickRail(cdp(), ID.partner);
        assert(refocus.rail_state.focus === 'top' && refocus.rail_state.bottom === ID.cuts, 'clicking a shown icon should only move focus');
        const bottomPane = refocus.panes[1].rect;
        await realClick(cdp(), bottomPane.x + bottomPane.w / 2, bottomPane.y + bottomPane.h - 20);
        await sleep(700);
        const clicked = await evalOn(cdp(), '__state()');
        assert(clicked.rail_state.focus === 'bottom' && clicked.headers[1].focus && clicked.current === ID.cuts, 'clicking inside the bottom pane did not focus it');
        return { records, focusByClickingInsidePane: { focus: clicked.rail_state.focus, current: clicked.current } };
    });

    // ---- 8. 1 面に戻す ----
    await step('8. 1 面に戻す: 段の見出しの × / 段の見出しをレールへドラッグ / 境目を端まで寄せる（どれもパネルはレールに残る）', async () => {
        const result = {};
        // (a) ×
        let state = await evalOn(cdp(), '__state()');
        const closeRect = await evalOn(cdp(), `__rect(document.querySelectorAll('#theia-right-side-panel > .lm-TabBar:not(.lm-mod-hidden) .akari-rail-pane-close')[1])`);
        await realClick(cdp(), center(closeRect).x, center(closeRect).y);
        await sleep(900);
        state = await evalOn(cdp(), '__state()');
        assertOnePane(state, 'after ×');
        assert(state.current === ID.partner, `after × the top pane should remain (${state.current})`);
        assert(railTab(state, ID.cuts), 'cuts vanished from the rail');
        await shot(cdp(), '08a-close-pane-one-pane.png');
        result.close = { closeButton: closeRect, ...summary(state) };
        // (b) 見出しをレールへ
        const split = async label => {
            const now = await evalOn(cdp(), '__state()');
            const dock = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
            const moved = await dragTo(cdp(), center(railTab(now, ID.inspector).rect), { x: dock.x + dock.w / 2, y: dock.y + dock.h * 0.75 }, { label });
            assertTwoPanes(moved.after, label);
            return moved.after;
        };
        state = await split('re-split for header drag');
        const header = state.headers[1].rect;
        const railBottom = { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h * 0.75 };
        const dragged = await dragTo(cdp(), { x: header.x + 40, y: header.y + header.h / 2 }, railBottom, { midShot: '08b-drag-pane-header-zones.png', label: 'header→rail' });
        state = dragged.after;
        assertOnePane(state, 'after header→rail');
        assert(railTab(state, ID.inspector)?.group === 'lower', 'inspector should stay below the line');
        result.headerToRail = { zones: dragged.zones.map(zone => zone.zone), ...summary(state) };
        // (c) 境目を端へ
        state = await split('re-split for gutter');
        const handle = state.handles[0];
        const dock = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
        await realDrag(cdp(), [{ x: handle.x + handle.w / 2, y: handle.y + 3 }, { x: handle.x + handle.w / 2, y: dock.y + dock.h - 4 }], { steps: 14 });
        await sleep(1000);
        state = await evalOn(cdp(), '__state()');
        assertOnePane(state, 'after gutter to edge');
        assert(state.current === ID.partner, `the top pane should remain (${state.current})`);
        assert(railTab(state, ID.inspector), 'inspector vanished from the rail');
        await shot(cdp(), '08c-gutter-to-edge-one-pane.png');
        result.gutterToEdge = { handleBefore: handle, ...summary(state) };
        return result;
    });

    // ---- 9. 既存の呼び出し ----
    await step('9. 既存の呼び出し: 注釈を開く / インスペクター・台本を前面 / 右パネルの畳む・開く / 進め方メニュー（1 面と 2 段の両方）', async () => {
        const records = {};
        for (const [label, expression, expected] of [
            ['akari.review.open', cmd('akari.review.open'), ID.review],
            ['akari.inspector.open', cmd('akari.inspector.open'), ID.inspector],
            ['akari.daihon.open', cmd('akari.daihon.open'), ID.daihon]
        ]) {
            const state = await evalOn(cdp(), expression);
            assertOnePane(state, label);
            assert(state.panes[0].id === expected && state.current === expected, `${label}: shown ${state.panes[0]?.id}`);
            records[label] = { shown: state.panes[0].id, ...(state.commandError ? { commandError: state.commandError } : {}) };
        }
        // 2 段: インスペクターを前面 → 線の下なので下の段、注釈（線の上へ移した）→ 上の段。
        const dock = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
        let state = await activate(cdp(), ID.partner);
        const moved = await dragTo(cdp(), center(railTab(state, ID.meter).rect), { x: dock.x + dock.w / 2, y: dock.y + dock.h * 0.75 }, { label: 'meter→rbottom' });
        assertTwoPanes(moved.after, 'split for commands');
        for (const [label, expression, slot, expected] of [
            ['split: akari.inspector.open', cmd('akari.inspector.open'), 'bottom', ID.inspector],
            ['split: akari.review.open', cmd('akari.review.open'), 'top', ID.review],
            ['split: akari.daihon.open', cmd('akari.daihon.open'), 'bottom', ID.daihon]
        ]) {
            state = await evalOn(cdp(), expression);
            assertTwoPanes(state, label);
            assert(state.rail_state[slot] === expected, `${label}: ${slot} is ${state.rail_state[slot]}`);
            records[label] = { top: state.rail_state.top, bottom: state.rail_state.bottom, ...(state.commandError ? { commandError: state.commandError } : {}) };
        }
        const collapsed = await evalOn(cdp(), cmd('core.toggle.right.panel'));
        assert(!collapsed.dockShown && collapsed.panes.length === 0, 'right panel did not collapse');
        const collapsedRightRect = await evalOn(cdp(), `__rect(document.getElementById('theia-right-content-panel'))`);
        await shot(cdp(), '09a-collapsed.png');
        const reopened = await evalOn(cdp(), cmd('core.toggle.right.panel'));
        assertTwoPanes(reopened, 'reopened');
        records['core.toggle.right.panel ×2'] = { collapsedRightRect, reopenedRightRect: await evalOn(cdp(), `__rect(document.getElementById('theia-right-content-panel'))`), reopened: { top: reopened.rail_state.top, bottom: reopened.rail_state.bottom } };
        // 進め方メニュー（Electron のメニューはネイティブなので、要求された menuPath とその項目の実行で確かめる）。
        await evalOn(cdp(), `(()=>{const r=__svc().sh.rightPanelHandler.bottomMenu.contextMenuRenderer;window.__menuCalls=[];r.render=o=>{window.__menuCalls.push({menuPath:o.menuPath});return {onDispose:()=>({dispose(){}}),dispose(){},active:true}};return true})()`);
        const menuItem = reopened.bottomMenu;
        await realClick(cdp(), center(menuItem).x, center(menuItem).y);
        let calls = await waitEval(cdp(), `window.__menuCalls.length?window.__menuCalls:null`, { label: 'menu requested', timeoutMs: 5_000 }).catch(() => null);
        let via = 'cdp-mouse';
        if (!calls) {
            via = 'element.click';
            await evalOn(cdp(), `(()=>{[...document.querySelectorAll('.theia-sidebar-menu-item')].filter(e=>e.getBoundingClientRect().left>innerWidth/2).at(-1).click();return true})()`);
            calls = await waitEval(cdp(), `window.__menuCalls.length?window.__menuCalls:null`, { label: 'menu requested', timeoutMs: 20_000 });
        }
        assert(S(calls[0].menuPath) === S(['akari-mode-switch-menu']), `menuPath ${S(calls[0].menuPath)}`);
        await evalOn(cdp(), `(async()=>{await __svc().cmd.executeCommand('akari.mode.set.collaborative');return true})()`);
        await sleep(800);
        const intake = JSON.parse(await readFile(path.join(PROJECT, '.akari', 'intake.json'), 'utf8'));
        assert(intake.autonomy === 'collaborative', `intake autonomy ${intake.autonomy}`);
        records.bottomMenu = { rect: menuItem, via, menuPath: calls[0].menuPath, intakeAutonomy: intake.autonomy };
        return records;
    });

    // ---- 10. 再起動で復元 ----
    const saved = await step('10a. 所属（注釈 = 上）・2 段・境目の比率・メインへ出したカットを作ってレイアウトを保存', async () => {
        let state = await evalOn(cdp(), '__state()');
        assert(state.rail_state.split, 'expected split from step 9');
        const handle = state.handles[0];
        const dock = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
        await realDrag(cdp(), [{ x: handle.x + handle.w / 2, y: handle.y + 3 }, { x: handle.x + handle.w / 2, y: dock.y + dock.h * 0.33 }], { steps: 12 });
        await sleep(900);
        state = await evalOn(cdp(), '__state()');
        const cuts = railTab(state, ID.cuts);
        const mainRect = await evalOn(cdp(), `__rect(document.getElementById('theia-main-content-panel'))`);
        const moved = await dragTo(cdp(), center(cuts.rect), { x: mainRect.x + mainRect.w / 2, y: mainRect.y + mainRect.h / 2 }, { label: 'cuts→main (save)' });
        state = moved.after;
        assertTwoPanes(state, 'before save');
        assert(state.main.includes(ID.cuts), 'cuts not in main');
        const ratio = state.panes[0].rect.h / (state.panes[0].rect.h + state.panes[1].rect.h);
        const stored = await evalOn(cdp(), storeLayout);
        const akariRail = stored.layout?.rightPanel?.akariRail;
        assert(akariRail?.split === true && akariRail.groups[ID.review] === 'agent' && akariRail.displaced[ID.cuts] === 'main', `stored ${S(akariRail)}`);
        await writeFile(path.join(FIXTURE_DIR, 'saved-rail-layout.json'), `${JSON.stringify(JSON.parse(JSON.stringify(stored.layout).replaceAll(PROJECT, '<PROJECT>')), null, 2)}\n`);
        await shot(cdp(), '10a-before-restart.png');
        return { ...summary(state), paneRatio: round(ratio), storedAkariRail: akariRail };
    });
    await stop(session); session = undefined;
    session = await launch('main-2');
    await step('10b. 再起動後に所属・2 段・比率・メインのカットが復元される', async () => {
        const state = await waitEval(cdp(), `(()=>{const s=__state();return s&&s.rail_state.split&&s.panes.length===2?s:null})()`, { label: 'split after restart', timeoutMs: 30_000 });
        assertTwoPanes(state, 'after restart');
        assert(state.rail_state.top === saved.top && state.rail_state.bottom === saved.bottom, `panes ${state.rail_state.top}/${state.rail_state.bottom} vs ${saved.top}/${saved.bottom}`);
        assert(railTab(state, ID.review).group === 'agent', 'review group not restored');
        assert(state.main.includes(ID.cuts) && !railTab(state, ID.cuts), 'cuts not restored in main');
        const ratio = state.panes[0].rect.h / (state.panes[0].rect.h + state.panes[1].rect.h);
        assert(Math.abs(ratio - saved.paneRatio) < 0.03, `ratio ${ratio} vs ${saved.paneRatio}`);
        await shot(cdp(), '10b-after-restart-restored.png');
        return { ...summary(state), paneRatio: round(ratio), expectedPaneRatio: saved.paneRatio };
    });

    // ---- 11. 壊れた保存データ ----
    async function injectAndRestart(label, mutate, fixtureName) {
        const key = await evalOn(cdp(), `(async()=>{const s=__svc();await s.lr.storeLayout(s.app);return __layoutKey()[0]})()`);
        const layout = await evalOn(cdp(), `__readLayout(${S(key)})`);
        const broken = mutate(JSON.parse(JSON.stringify(layout)));
        await writeFile(path.join(FIXTURE_DIR, fixtureName), `${JSON.stringify(JSON.parse(JSON.stringify(broken).replaceAll(PROJECT, '<PROJECT>')), null, 2)}\n`);
        // 終了時の storeLayout が注入を上書きしないよう、注入直前にそのインスタンスの storeLayout を止める。
        await evalOn(cdp(), `(()=>{window.__svc().lr.storeLayout=async()=>{};__writeLayout(${S(key)},${JSON.stringify(broken)});return true})()`);
        await stop(session);
        session = await launch(label);
        await sleep(1500);
        return evalOn(cdp(), '__state()');
    }
    await step('11a. 右レールの保存データ（akariRail）だけが壊れている → 右レールは既定（1 面・既定の所属）', async () => {
        const state = await injectAndRestart('main-3', layout => {
            layout.rightPanel.akariRail = { version: 1, groups: { [ID.review]: 'middle' }, split: 'yes', top: 42, bottom: null, focus: 'up', ratio: 'NaN', displaced: [] };
            return layout;
        }, 'broken-akari-rail.json');
        assertOnePane(state, 'broken akariRail');
        assert(S(state.rail_state.groups) === '{}', `groups ${S(state.rail_state.groups)}`);
        assert(railTab(state, ID.review).group === 'lower', 'review should be back below the line');
        const agents = state.rail.filter(item => item.group === 'agent').map(item => item.id);
        assert(S(agents) === S([ID.partner]), `agents ${S(agents)}`);
        await shot(cdp(), '11a-broken-akari-rail-default.png');
        return summary(state);
    });
    await step('11b. 右パネル全体の保存データが壊れている（items に null・幅が文字列）→ 既定（1 面・既定の所属）', async () => {
        // まず所属と 2 段を作ってから、右パネルのデータ全体を壊して保存する。
        let state = await evalOn(cdp(), '__state()');
        const review = railTab(state, ID.review);
        const moved = await dragTo(cdp(), center(review.rect), { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h * 0.3 }, { label: 'review→railtop (11b)' });
        assert(moved.after.rail_state.groups[ID.review] === 'agent', 'setup failed');
        state = await injectAndRestart('main-4', layout => {
            layout.rightPanel = { type: 'sidepanel', items: [{ widget: { id: ID.review }, expanded: 'broken', rank: 'x' }, null], size: 'NaN',
                akariRail: { version: 1, groups: { [ID.review]: 'agent' }, split: true, top: ID.review, bottom: ID.review, focus: 'top', ratio: 0.5, displaced: {} } };
            return layout;
        }, 'broken-right-panel.json');
        assert(!state.rail_state.split, 'still split after broken layout');
        assert(S(state.rail_state.groups) === '{}', `groups ${S(state.rail_state.groups)}`);
        if (state.dockShown) assertOnePane(state, 'broken right panel');
        await shot(cdp(), '11b-broken-right-panel-default.png');
        return summary(state);
    });
    out.status = 'pass';
} catch (error) {
    out.status = 'fail';
    out.error = sanitize(error);
    process.exitCode = 1;
} finally {
    await stop(session);
    out.finishedAt = new Date().toISOString();
    out.pass = out.status === 'pass' && out.steps.every(item => item.pass);
    await save();
}
