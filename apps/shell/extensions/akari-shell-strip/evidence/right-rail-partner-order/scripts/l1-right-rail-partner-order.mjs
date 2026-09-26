#!/usr/bin/env node
// L1（task 2026-09-26-right-rail-partner-order）: 実機（Electron + CDP・ダーク）で、パートナーを開くアイコンの既定の所属
// （線の上か下か）と、レールのアイコン同士をドラッグで並べ替えられるかを観測する。
//
//   --phase=before  修正前の再現。(a) Claude Code CLI / Codex CLI を接続した直後 (b) 再起動（レイアウト復元）後と接続し直し
//                   (c) 拡張形態のビュー (d) アイコンを別のアイコンの上へドラッグ、を記録するだけ（判定はしない）
//   --phase=after   修正後。(a)〜(d) に加えて (e) 線の上どうし (f) 線の下どうし (g) 線をまたぐ (h) 再起動後に並びが残る
//                   (i) 既存の「メインへ置く」「右の下の段に分ける」(j) 並びのフィールドだけ壊した保存データ、を判定する
//
// 使い方: node l1-right-rail-partner-order.mjs --phase=before|after [--port=9613]
// 一時ディレクトリは /tmp/right-rail-partner-order-l1（AKARI_HOME・--user-data-dir・THEIA_CONFIG_DIR も専用）。
// パートナー CLI は起動するだけで、ログイン・送信はしない。
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const PHASE = arg('phase') ?? 'after';
if (PHASE !== 'before' && PHASE !== 'after') throw new Error('--phase must be before or after');
const AFTER = PHASE === 'after';
const PORT = Number(arg('port') ?? 9613);
const L1 = '/tmp/right-rail-partner-order-l1';
const PROJECT = path.join(L1, `project-${PHASE}`);
const ISO = path.join(L1, `iso-${PHASE}`);
const RESULTS = path.join(ROOT, `results-${PHASE}.json`);
const S = value => JSON.stringify(value);
const out = { status: 'running', phase: PHASE, startedAt: new Date().toISOString(), port: PORT, steps: [], screenshots: [] };

const ID = {
    partner: 'akari-partner-onboarding', daihon: 'akari-daihon-widget', cuts: 'akari-cuts-widget',
    review: 'akari-review-panel-widget', inspector: 'akari-inspector-widget', meter: 'akari-audio-meter-widget'
};
const catalog = JSON.parse(await readFile(path.join(SHELL, 'extensions', 'akari-partner', 'src', 'common', 'partner-catalog.json'), 'utf8'));
const entry = id => catalog.find(item => item.id === id);
const CLAUDE_CLI = entry('anthropic/claude-code-cli');
const CODEX_CLI = entry('openai/codex-cli');
const CLAUDE_EXT = entry('anthropic/claude-code-extension');
const CODEX_EXT = entry('openai/codex-extension');

const sanitize = value => String(value?.stack || value?.message || value)
    .replaceAll(REPO, '<worktree>').replaceAll(L1, '<l1>').replace(/\/Users\/[^\s)"]+/g, '<machine-path>');
const save = async () => {
    const temporary = `${RESULTS}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(JSON.parse(sanitize(JSON.stringify(out))), null, 2)}\n`);
    await rename(temporary, RESULTS);
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const check = (condition, message) => { if (AFTER) assert(condition, message); return !!condition; };
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
async function pumpFrames(cdp, timeoutMs = 900_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
        if (await evalOn(cdp, `!document.querySelector('.theia-preload')&&!!document.getElementById('theia-right-content-panel')`).catch(() => false)) return;
        await sleep(300);
    }
    throw new Error('preload overlay never detached');
}
async function shot(cdp, file) {
    await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }).catch(() => undefined);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    const name = `${PHASE}-${file}`;
    await writeFile(path.join(ROOT, name), Buffer.from(data, 'base64'));
    out.screenshots.push(name);
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
  window.__partner=()=>{const sh=__svc().sh;return [...sh.getWidgets('right'),...sh.getWidgets('main'),...sh.getWidgets('bottom')].find(w=>w.id==='${ID.partner}')};
  window.__state=()=>{
    const sh=__svc().sh,h=sh.rightPanelHandler;
    const dock=document.getElementById('theia-right-side-panel');
    const dockShown=!h.dockPanel.isHidden;
    const panes=dockShown?[...dock.children].filter(e=>e.classList.contains('lm-DockPanel-widget')&&!e.classList.contains('lm-mod-hidden')&&e.getBoundingClientRect().height>0).map(e=>({id:e.id,rect:r(e)})).sort((a,b)=>a.rect.y-b.rect.y):[];
    const bar=h.tabBar.node;
    const rail=[...h.tabBar.contentNode.children].map((t,i)=>{const o=h.tabBar.titles[i].owner;return {id:o.id,label:h.tabBar.titles[i].label,kind:o.kind??null,
      partner:(o.terminalKind??o.kind)==='akari-partner'||undefined,group:t.classList.contains('akari-rail-agent')?'agent':t.classList.contains('akari-rail-lower')?'lower':null,
      current:t.classList.contains('lm-mod-current'),rect:r(t)}});
    const railRect=r(bar);const middle=parseFloat(getComputedStyle(bar).getPropertyValue('--akari-rail-middle'));
    return {railRect,separatorY:railRect.y+middle,railIds:h.railIds(),rail,current:h.tabBar.currentTitle?.owner.id??null,dockShown,panes,
      rail_state:h.railState(),main:sh.getWidgets('main').map(w=>w.id),bottom:sh.getWidgets('bottom').map(w=>w.id),window:{w:innerWidth,h:innerHeight}};
  };
  window.__layoutKey=()=>Object.keys(localStorage).filter(k=>/:layout$/.test(k));
  window.__readLayout=k=>{let v=JSON.parse(localStorage.getItem(k));return typeof v==='string'?JSON.parse(v):v};
  window.__writeLayout=(k,l)=>{const raw=JSON.parse(localStorage.getItem(k));localStorage.setItem(k,JSON.stringify(typeof raw==='string'?JSON.stringify(l):l))};
  window.__errors=window.__errors||[];
  if(!window.__errHooked){window.__errHooked=true;window.addEventListener('error',e=>window.__errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason&&e.reason.message||e.reason)));}
  return 'ok';
})()`;
const cmd = id => `(async()=>{let error=null;try{await __svc().cmd.executeCommand(${S(id)})}catch(e){error=String(e&&e.message||e)}await new Promise(r=>setTimeout(r,900));return error})()`;
const storeLayout = `(async()=>{const s=__svc();await s.lr.storeLayout(s.app);const k=__layoutKey();return {keys:k,layout:k.length?__readLayout(k[0]):null}})()`;

async function launch(label) {
    const log = path.join(L1, `${PHASE}-${label}.log`);
    const launched = await run('/bin/zsh', [path.join(ROOT, 'scripts', 'launch-shell.sh'), SHELL, PROJECT, String(PORT), ISO, log]);
    const pid = Number(launched.stdout.trim().split(/\s+/).at(-1));
    assert(Number.isInteger(pid) && pid > 0, 'Electron PID was not reported');
    const started = Date.now();
    let target;
    const deadline = Date.now() + 900_000;
    while (Date.now() < deadline && !target) {
        try { target = (await listTargets(PORT)).find(item => item.type === 'page'); } catch { /* not up yet */ }
        if (!target) await sleep(500);
    }
    assert(target, 'CDP page target did not appear');
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const consoleErrors = [];
    cdp.on('Runtime.exceptionThrown', params => consoleErrors.push(sanitize(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text)));
    cdp.on('Runtime.consoleAPICalled', params => {
        if (params.type === 'error') consoleErrors.push(sanitize(params.args.map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 600));
    });
    await pumpFrames(cdp);
    await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.querySelector('.akari-rail-tip'))`, { label: 'Theia container', timeoutMs: 300_000 });
    await evalOn(cdp, HELPERS);
    await sleep(3000);
    out.launches = [...(out.launches ?? []), { label, readyMs: Date.now() - started }];
    return { pid, cdp, label, consoleErrors };
}
async function stop(current) {
    if (!current) return;
    current.cdp?.close();
    try { process.kill(current.pid, 'SIGTERM'); } catch { /* already gone */ }
    let alive = true;
    for (let i = 0; i < 60 && alive; i++) {
        try { process.kill(current.pid, 0); await sleep(500); } catch { alive = false; }
    }
    if (alive) { try { process.kill(current.pid, 'SIGKILL'); } catch { /* gone */ } }
    for (let i = 0; i < 120; i++) {
        try { await listTargets(PORT); await sleep(500); } catch { break; }
    }
    await sleep(1500);
}
const center = rect => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
const railTab = (state, id) => state.rail.find(item => item.id === id);
const railLine = state => state.rail.map(item => `${item.id}:${item.group}${item.partner ? ':partner' : ''}`);
const partnerIds = state => state.rail.filter(item => item.partner).map(item => item.id);

/** 実マウスのドラッグ。途中で止めて置き場所・挿入位置の線を記録・撮影し、離す。 */
async function dragTo(cdp, from, to, { midShot, label } = {}) {
    const { x, y } = from;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + (to.x - x) * i / steps, y: y + (to.y - y) * i / steps, button: 'left', buttons: 1 });
        await sleep(30);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y + 1, button: 'left', buttons: 1 });
    await sleep(350);
    const during = await evalOn(cdp, `({zones:[...document.querySelectorAll('.akari-rail-drop')].map(e=>({zone:e.dataset.zone,hot:e.classList.contains('akari-rail-drop-hot'),rect:__rect(e)})),
      marker:[...document.querySelectorAll('.akari-rail-insert-marker')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'}).map(e=>({rect:__rect(e),color:getComputedStyle(e).backgroundColor}))[0]??null})`);
    if (midShot) await shot(cdp, midShot);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y + 1, button: 'left' });
    await sleep(1500);
    const after = await evalOn(cdp, '__state()');
    const leftover = await evalOn(cdp, `document.querySelectorAll('.akari-rail-drop').length+[...document.querySelectorAll('.akari-rail-insert-marker')].filter(e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).display!=='none').length`);
    if (AFTER) assert(leftover === 0, `${label}: drop zones / insert marker left on screen`);
    return { during, after, leftover };
}
/** 置く先: アイコンの上寄り（前へ）/ 下寄り（後ろへ）。 */
const beforeOf = rect => ({ x: rect.x + rect.w / 2, y: rect.y + Math.round(rect.h * 0.2) });
const afterOf = rect => ({ x: rect.x + rect.w / 2, y: rect.y + Math.round(rect.h * 0.8) });

async function connectCli(cdp, cli) {
    await evalOn(cdp, cmd('akari.partner.open'));
    await evalOn(cdp, `(()=>{const w=__partner();w.begin(${S(cli)}).catch(e=>window.__errors.push('begin '+String(e&&e.message||e)));return true})()`);
    return waitEval(cdp, `(()=>{const t=__svc().sh.rightPanelHandler.tabBar.titles.map(t=>t.owner).find(o=>(o.terminalKind??o.kind)==='akari-partner'&&o.title.label===${S(cli.name)});return t?t.id:false})()`,
        { timeoutMs: 600_000, intervalMs: 1000, label: `${cli.name} terminal on the rail` });
}

let session;
try {
    await rm(ISO, { recursive: true, force: true });
    await rm(PROJECT, { recursive: true, force: true });
    await mkdir(L1, { recursive: true });
    await cp(path.join(REPO, 'templates', 'project-default'), PROJECT, { recursive: true });
    await writeFile(path.join(PROJECT, '.akari', 'intake.json'), `${JSON.stringify({ autonomy: 'checkpoint' }, null, 2)}\n`);

    session = await launch('1');
    const cdp = () => session.cdp;

    // ---- (a) CLI 接続直後 ----
    const a = await step('(a) 新しい userData で Claude Code CLI / Codex CLI を接続した直後のレール', async () => {
        await evalOn(cdp(), cmd('akari.inspector.open'));
        await evalOn(cdp(), cmd('akari.preview.openAudioMeter'));
        const initial = await evalOn(cdp(), '__state()');
        const claudeId = await connectCli(cdp(), CLAUDE_CLI);
        const codexId = await connectCli(cdp(), CODEX_CLI);
        await sleep(2500);
        const state = await evalOn(cdp(), '__state()');
        await shot(cdp(), 'a-cli-connected.png');
        const claude = railTab(state, claudeId), codex = railTab(state, codexId);
        const aboveLine = item => item.group === 'agent' && item.rect.y + item.rect.h <= state.separatorY;
        const claudeAbove = check(aboveLine(claude), `Claude Code CLI (${claudeId}) is not above the line: ${S(railLine(state))}`);
        const codexAbove = check(aboveLine(codex), `Codex CLI (${codexId}) is not above the line: ${S(railLine(state))}`);
        return { initialRail: railLine(initial), claudeId, codexId, claudeAbove, codexAbove, railIds: state.railIds, rail: railLine(state), railState: state.rail_state, separatorY: state.separatorY,
            icons: { claude: claude.rect, codex: codex.rect } };
    });

    // ---- (c) 拡張形態 ----
    const c = await step('(c) 拡張形態（Claude Code 拡張 / Codex 拡張）のビューを開いた直後のレール', async () => {
        // 拡張の実物は Open VSX からの導入が要る（隔離 userData ではログイン・ネットワークに依存）ため、
        // パートナーのカタログの viewContainerIds と同じ id（Theia の plugin-view-container:<id>）の widget を右へ追加して代替する。
        const ids = [CLAUDE_EXT.viewContainerIds[0], CODEX_EXT.viewContainerIds[0]].map(id => `plugin-view-container:${id}`);
        const labels = [CLAUDE_EXT.name, CODEX_EXT.name];
        await evalOn(cdp(), `(async()=>{const sh=__svc().sh;let p=Object.getPrototypeOf(sh.mainPanel);while(Object.getPrototypeOf(p)!==Object.prototype)p=Object.getPrototypeOf(p);const W=p.constructor;
          const ids=${S(ids)},labels=${S(labels)};
          for(let i=0;i<ids.length;i++){const w=new W();w.id=ids[i];w.title.label=labels[i];w.title.caption=labels[i];w.title.closable=true;w.title.iconClass='codicon codicon-extensions';w.addClass('akari-l1-extension-standin');
            w.node.textContent='(L1 stand-in) '+ids[i];await sh.addWidget(w,{area:'right',rank:Number.MAX_SAFE_INTEGER});}
          await new Promise(r=>setTimeout(r,1500));return true})()`);
        const state = await evalOn(cdp(), '__state()');
        await shot(cdp(), 'c-extension-views.png');
        const groups = Object.fromEntries(ids.map(id => [id, railTab(state, id)?.group ?? null]));
        const above = ids.every(id => railTab(state, id) && railTab(state, id).group === 'agent' && railTab(state, id).rect.y + railTab(state, id).rect.h <= state.separatorY);
        check(above, `extension views are not above the line: ${S(railLine(state))}`);
        return { substitute: true, ids, groups, above, railIds: state.railIds, rail: railLine(state), railState: state.rail_state };
    });

    // ---- (d) アイコンを別のアイコンの上へ ----
    await step('(d) レールのアイコン（カット）を別のアイコン（台本）の上寄りへドラッグ', async () => {
        const state = await evalOn(cdp(), '__state()');
        const moved = await dragTo(cdp(), center(railTab(state, ID.cuts).rect), beforeOf(railTab(state, ID.daihon).rect), { midShot: 'd-drag-cuts-onto-daihon.png', label: 'cuts→before daihon' });
        const before = state.railIds, afterIds = moved.after.railIds;
        const reordered = afterIds.indexOf(ID.cuts) === afterIds.indexOf(ID.daihon) - 1;
        check(reordered, `cuts was not placed before daihon: ${S(afterIds)}`);
        check(moved.during.marker, `insert marker not visible during the drag: ${S(moved.during)}`);
        await shot(cdp(), 'd-after-drop.png');
        return { before, after: afterIds, reordered, during: moved.during, rail: railLine(moved.after), railState: moved.after.rail_state };
    });

    if (AFTER) {
        await step('(e) 線の上どうしの入れ替え: Codex CLI を Claude Code CLI の前へ', async () => {
            const state = await evalOn(cdp(), '__state()');
            const moved = await dragTo(cdp(), center(railTab(state, a.codexId).rect), beforeOf(railTab(state, a.claudeId).rect), { midShot: 'e-drag-agent-agent.png', label: 'codex→before claude' });
            const ids = moved.after.railIds;
            assert(ids.indexOf(a.codexId) === ids.indexOf(a.claudeId) - 1, `codex not before claude: ${S(ids)}`);
            assert(railTab(moved.after, a.codexId).group === 'agent', 'codex left the agent section');
            assert(moved.during.marker, 'insert marker not visible');
            await shot(cdp(), 'e-after.png');
            return { before: state.railIds, after: ids, marker: moved.during.marker, railState: moved.after.rail_state };
        });
        await step('(f) 線の下どうしの入れ替え: インスペクターを台本の前へ', async () => {
            const state = await evalOn(cdp(), '__state()');
            const moved = await dragTo(cdp(), center(railTab(state, ID.inspector).rect), beforeOf(railTab(state, ID.daihon).rect), { midShot: 'f-drag-lower-lower.png', label: 'inspector→before daihon' });
            const ids = moved.after.railIds;
            assert(ids.indexOf(ID.inspector) === ids.indexOf(ID.daihon) - 1, `inspector not before daihon: ${S(ids)}`);
            assert(railTab(moved.after, ID.inspector).group === 'lower', 'inspector left the lower section');
            assert(moved.during.marker, 'insert marker not visible');
            await shot(cdp(), 'f-after.png');
            return { before: state.railIds, after: ids, marker: moved.during.marker, railState: moved.after.rail_state };
        });
        await step('(g) 線をまたぐ移動: 注釈（線の下）を Claude Code CLI の後ろ（線の上）へ → 所属も上に', async () => {
            const state = await evalOn(cdp(), '__state()');
            const moved = await dragTo(cdp(), center(railTab(state, ID.review).rect), afterOf(railTab(state, a.claudeId).rect), { midShot: 'g-drag-across-line.png', label: 'review→after claude' });
            const ids = moved.after.railIds;
            assert(ids.indexOf(ID.review) === ids.indexOf(a.claudeId) + 1, `review not right after claude: ${S(ids)}`);
            const review = railTab(moved.after, ID.review);
            assert(review.group === 'agent' && review.rect.y + review.rect.h <= moved.after.separatorY, `review is not above the line: ${S(railLine(moved.after))}`);
            assert(moved.during.marker, 'insert marker not visible');
            // 戻り: 線の上の台本を線の下（音声メーターの後ろ）へ
            const back = await dragTo(cdp(), center(railTab(moved.after, ID.daihon).rect), afterOf(railTab(moved.after, ID.meter).rect), { label: 'daihon→after meter' });
            await shot(cdp(), 'g-after.png');
            return { before: state.railIds, after: ids, rail: railLine(moved.after), afterDaihonToEnd: railLine(back.after), railState: back.after.rail_state };
        });
    }

    // ---- (b) 再起動（レイアウト復元）・端末の連番 id に残った所属 ----
    const b = await step(`(b) Claude Code CLI を線の下へ置いて再起動 → 復元後のレール → Codex CLI・Claude Code CLI を接続し直す${AFTER ? '（(h) 並べ替えた順が再起動後も同じ）' : ''}`, async () => {
        let state = await evalOn(cdp(), '__state()');
        const claude = railTab(state, a.claudeId);
        const lowerEnd = { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h - 24 };
        const moved = await dragTo(cdp(), center(claude.rect), lowerEnd, { label: 'claude→lower end' });
        const movedGroup = railTab(moved.after, a.claudeId)?.group ?? null;
        await shot(cdp(), 'b0-claude-moved-below.png');
        const beforeRestart = moved.after;
        const stored = await evalOn(cdp(), storeLayout);
        assert(stored.layout, 'layout was not stored');
        await stop(session);
        session = await launch('2');
        await sleep(8000);
        const restored = await evalOn(cdp(), '__state()');
        await shot(cdp(), 'b1-after-restart.png');
        await evalOn(cdp(), cmd('akari.inspector.open'));
        await evalOn(cdp(), cmd('akari.preview.openAudioMeter'));
        const codexId = await connectCli(cdp(), CODEX_CLI);
        const claudeId = await connectCli(cdp(), CLAUDE_CLI);
        await sleep(2500);
        state = await evalOn(cdp(), '__state()');
        await shot(cdp(), 'b2-reconnected.png');
        const codex = railTab(state, codexId);
        const codexAbove = check(codex.group === 'agent' && codex.rect.y + codex.rect.h <= state.separatorY, `Codex CLI (${codexId}) reconnected below the line: ${S(railLine(state))}`);
        // 端末の id は起動ごとに振り直される。固定の住人の並び（利用者が並べ替えたもの）が再起動で変わらないこと。
        const fixedOnly = ids => ids.filter(id => Object.values(ID).includes(id));
        if (AFTER) assert(S(fixedOnly(restored.railIds)) === S(fixedOnly(beforeRestart.railIds)), `order changed after restart: ${S(fixedOnly(beforeRestart.railIds))} → ${S(fixedOnly(restored.railIds))}`);
        return { claudeMovedGroup: movedGroup, savedRail: stored.layout?.rightPanel?.akariRail ?? null,
            beforeRestart: railLine(beforeRestart), afterRestart: railLine(restored), restoredRailState: restored.rail_state,
            reconnected: { codexId, claudeId, codexGroup: codex.group, claudeGroup: railTab(state, claudeId).group, codexAbove }, rail: railLine(state), railState: state.rail_state };
    });


    if (AFTER) {
        await step('(i) 既存の置き場所: カットをメインへ置く → 線の下へ戻す / 音声メーターを右の下の段に分ける', async () => {
            let state = await evalOn(cdp(), '__state()');
            const mainRect = await evalOn(cdp(), `__rect(document.getElementById('theia-main-content-panel'))`);
            const toMain = await dragTo(cdp(), center(railTab(state, ID.cuts).rect), { x: mainRect.x + mainRect.w / 2, y: mainRect.y + mainRect.h / 2 }, { midShot: 'i1-drag-cuts-to-main.png', label: 'cuts→main' });
            assert(toMain.during.zones.some(zone => zone.zone === 'main' && zone.hot), `main zone not hot: ${S(toMain.during.zones)}`);
            assert(toMain.after.main.includes(ID.cuts) && !railTab(toMain.after, ID.cuts), 'cuts did not move to main');
            await shot(cdp(), 'i1-cuts-in-main.png');
            const mainTab = await evalOn(cdp(), `__rect(document.querySelector('#theia-main-content-panel #shell-tab-${ID.cuts}'))`);
            state = toMain.after;
            const lowerEnd = { x: state.railRect.x + state.railRect.w / 2, y: state.railRect.y + state.railRect.h - 30 };
            const back = await dragTo(cdp(), center(mainTab), lowerEnd, { label: 'cuts main→rail lower' });
            assert(railTab(back.after, ID.cuts)?.group === 'lower', `cuts not back below the line: ${S(railLine(back.after))}`);
            const dockRect = await evalOn(cdp(), `__rect(document.getElementById('theia-right-side-panel'))`);
            await evalOn(cdp(), `(async()=>{await __svc().sh.activateWidget(${S(ID.partner)});await new Promise(r=>setTimeout(r,900));return 1})()`);
            const split = await dragTo(cdp(), center(railTab(back.after, ID.meter).rect), { x: dockRect.x + dockRect.w / 2, y: dockRect.y + dockRect.h * 0.75 }, { midShot: 'i2-drag-meter-rbottom.png', label: 'meter→rbottom' });
            assert(split.after.rail_state.split && split.after.rail_state.bottom === ID.meter, `not split with meter at the bottom: ${S(split.after.rail_state)}`);
            assert(split.after.panes.length === 2, `panes ${S(split.after.panes)}`);
            await shot(cdp(), 'i2-two-panes.png');
            // クリックで開く / 畳む（1 面へ戻してから）
            await evalOn(cdp(), `(()=>{__svc().sh.rightPanelHandler.closePane('bottom');return 1})()`);
            await sleep(900);
            let s2 = await evalOn(cdp(), '__state()');
            const target = railTab(s2, ID.daihon);
            const clickAt = async rect => { const p = center(rect); await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(40); await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(1000); return evalOn(cdp(), '__state()'); };
            s2 = await clickAt(target.rect);
            assert(s2.current === ID.daihon && s2.dockShown, `click did not open daihon: ${s2.current}`);
            s2 = await clickAt(railTab(s2, ID.daihon).rect);
            assert(!s2.dockShown || s2.current === null, 'second click did not collapse');
            return { mainZones: toMain.during.zones.map(zone => zone.zone), backRail: railLine(back.after), split: split.after.rail_state, clickOpenCollapse: true };
        });
        await step('(j) 並びのフィールドだけ壊した保存データで起動 → 既定の並び・エラーなし', async () => {
            const stored = await evalOn(cdp(), storeLayout);
            const key = stored.keys[0];
            const layout = stored.layout;
            const railSaved = layout.rightPanel.akariRail;
            const orderKeys = Object.keys(railSaved).filter(name => !['version', 'groups', 'split', 'top', 'bottom', 'focus', 'ratio', 'displaced'].includes(name));
            assert(orderKeys.length > 0, `no order field in the saved rail: ${S(Object.keys(railSaved))}`);
            for (const name of orderKeys) railSaved[name] = { broken: true, value: 42 };
            // 終了時の storeLayout が注入を上書きしないよう、注入直前にそのインスタンスの storeLayout を止めてから普通に終了する
            // （SIGKILL だと localStorage の書き込みがディスクへ出る前に落ちることがある）。
            await evalOn(cdp(), `(()=>{window.__svc().lr.storeLayout=async()=>{};__writeLayout(${S(key)},${S(layout)});return true})()`);
            const injected = await evalOn(cdp(), `__readLayout(${S(key)}).rightPanel.akariRail`);
            assert(S(injected[orderKeys[0]]) === S({ broken: true, value: 42 }), 'broken field was not written');
            await writeFile(path.join(ROOT, 'fixture', 'broken-order.json'), `${JSON.stringify(JSON.parse(sanitize(JSON.stringify(railSaved))), null, 2)}\n`);
            await stop(session);
            session = undefined;
            session = await launch('3-broken');
            await sleep(6000);
            const state = await evalOn(cdp(), '__state()');
            await shot(cdp(), 'j-broken-order-default.png');
            const errors = [...session.consoleErrors, ...await evalOn(cdp(), 'window.__errors')].filter(text => /rail|right|order|akari-shell-strip/i.test(text));
            assert(state.rail.length > 0, 'rail is empty');
            const fixed = ['akari-partner-onboarding', ID.daihon, ID.cuts, ID.review, ID.inspector, ID.meter];
            const lowerFixed = state.railIds.filter(id => fixed.includes(id) && railTab(state, id).group === 'lower');
            assert(S(lowerFixed) === S(fixed.filter(id => lowerFixed.includes(id))), `fixed residents are not in the default order: ${S(lowerFixed)}`);
            assert(errors.length === 0, `errors: ${S(errors)}`);
            assert(S(state.rail_state.order ?? []) === '[]' && S(state.rail_state.groups) === '{}', `rail state is not the default: ${S(state.rail_state)}`);
            return { brokenFields: orderKeys, rail: railLine(state), railState: state.rail_state, relatedErrors: errors };
        });
    }
    out.status = 'pass';
} catch (error) {
    out.status = 'fail';
    out.error = sanitize(error);
    console.error(out.error);
} finally {
    out.finishedAt = new Date().toISOString();
    await save();
    await stop(session);
}
process.exitCode = out.status === 'pass' ? 0 : 1;
