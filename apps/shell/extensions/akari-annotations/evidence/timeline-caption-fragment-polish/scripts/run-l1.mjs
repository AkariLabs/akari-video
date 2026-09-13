#!/usr/bin/env node
// L1（Electron + CDP、SS 4 枚）— task 2026-09-14-timeline-caption-fragment-polish
// オーナー実プロジェクトは TMP にコピーし、原本を変更しない。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const OWNER = process.env.AKARI_OWNER_PROJECT
  ?? path.join(os.homedir(), 'Akari/channels/my-channel/videos/2026-09-12-new-video');
const PORT = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 22214);
const RESULTS = path.join(ROOT, 'results.json');
const S = JSON.stringify;
const out = { status: 'running', steps: [], screenshots: [], screenshotSha256: {}, cleanup: null };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sanitizeText = value => String(value)
  .replaceAll(REPO, '<WORKTREE>').replaceAll(os.homedir(), '<HOME>')
  .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
  .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
const sanitize = error => sanitizeText(error?.stack || error?.message || error);
const save = async () => {
  const temp = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temp, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temp, RESULTS);
};

async function waitEval(cdp, expression, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { last = error; }
    await sleep(180);
  }
  throw new Error(`${label} not reached${last ? `: ${sanitize(last)}` : ''}`);
}
async function waitEvalWithState(cdp, expression, stateExpression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs; let lastError;
  while (Date.now() < deadline) {
    try { const value = await evalOn(cdp, expression); if (value) return value; } catch (error) { lastError = error; }
    await sleep(180);
  }
  const state = await evalOn(cdp, stateExpression).catch(error => ({ diagnosticError: sanitize(error) }));
  throw new Error(`${label} not reached; last state=${S(state)}${lastError ? `; last error=${sanitize(lastError)}` : ''}`);
}
async function step(name, operation) {
  const record = { name, pass: false }; out.steps.push(record);
  try { record.detail = await operation(); record.pass = true; await save(); return record.detail; }
  catch (error) { record.error = sanitize(error); await save(); throw error; }
}
async function shot(cdp, number, label) {
  const name = `${String(number).padStart(2, '0')}-${label}.png`;
  const target = path.join(ROOT, name);
  await screenshot(cdp, target);
  out.screenshots.push(name);
  out.screenshotSha256[name] = createHash('sha256').update(await readFile(target)).digest('hex');
  await save();
}
async function clickCenter(cdp, selector) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await evalOn(cdp, `(()=>{const node=document.querySelector(${S(selector)});if(!node)return{ok:false,reason:'missing'};const r=node.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const inViewport=Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight;const hit=inViewport?document.elementFromPoint(x,y):null;const ok=inViewport&&Boolean(hit)&&(hit===node||node.contains(hit));const describe=value=>value?{tag:value.tagName,id:value.id||null,className:typeof value.className==='string'?value.className:null,toggle:value.dataset?.akariToggle??null,ariaPressed:value.getAttribute?.('aria-pressed')??null}:null;return{ok,reason:ok?'ok':inViewport?'hit-mismatch':'outside-viewport',point:{x,y},viewport:{width:innerWidth,height:innerHeight},button:describe(node),hit:describe(hit)}})()`);
    if (last?.ok) {
      const point = last.point;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
      return last;
    }
    await sleep(180);
  }
  throw new Error(`${selector} did not expose a clickable center; hit=${S(last)}`);
}

const command = id => `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');if(!C)throw new Error('CommandService unavailable');return window.theia.container.get(C).executeCommand(${S(id)})})()`;
const TIMELINE = `(()=>[...document.querySelectorAll('[data-akari-item-kind="caption"]')].map(row=>{const fragments=[...row.querySelectorAll('[data-akari-caption-fragment]')];return{id:row.dataset.akariItemId,visualBlocks:Math.max(1,fragments.length),fragmentCount:fragments.length,ticks:row.querySelectorAll('[data-akari-caption-fragment-tick]').length,label:row.textContent?.trim()??'',fragmentWidths:fragments.map(node=>node.getBoundingClientRect().width)}}))()`;

const work = await mkdtemp(path.join(os.tmpdir(), 'akari-caption-fragment-polish-l1-'));
const project = path.join(work, 'project');
const profile = path.join(work, 'profile');
const captionsPath = path.join(project, 'captions.json');
const projectUri = pathToFileURL(project).toString();
const captionsUri = pathToFileURL(captionsPath).toString();
const editUri = pathToFileURL(path.join(project, 'edit.json')).toString();
let child; let cdp;
try {
  await cp(OWNER, project, { recursive: true });
  await mkdir(profile, { recursive: true });
  const original = JSON.parse(await readFile(captionsPath, 'utf8'));
  assert(original.display_policy?.max_line_units === 10, 'owner fixture must start at max_line_units=10');

  child = spawn(ELECTRON, [SHELL, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    cwd: REPO,
    env: { ...process.env, HOME: profile, AKARI_HOME: path.join(profile, 'akari-home'), THEIA_CONFIG_DIR: path.join(profile, 'theia') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = []; child.stdout.on('data', chunk => logs.push(String(chunk))); child.stderr.on('data', chunk => logs.push(String(chunk)));
  let target;
  for (let attempt = 0; attempt < 600 && !target; attempt += 1) {
    target = await listTargets(PORT).then(items => items.find(item => item.type === 'page')).catch(() => undefined);
    if (!target) await sleep(300);
  }
  assert(target, `CDP target unavailable: ${sanitize(logs.join('').slice(-3000))}`);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await waitEval(cdp, `Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia workbench', 180_000);
  await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');b?.click();return true})()`).catch(() => {});
  await evalOn(cdp, command('akari.annotations.open')).catch(() => {});
  await waitEval(cdp, `document.querySelectorAll('[data-akari-item-kind="caption"]').length===8`, 'caption timeline rows', 180_000);

  const resolveRpc = `(async()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='symbol'&&k.description==='AkariPreviewService');if(!K)throw new Error('AkariPreviewService unavailable');return window.theia.container.get(K).resolveCaptionDisplay({captionsUri:${S(captionsUri)},editUri:${S(editUri)},workspaceRoots:[${S(projectUri)}]})})()`;
  await step('1. ヘッダボタンで区切り表示を同じ描画内に切り替える', async () => {
    const selector = '[data-akari-toggle="fragment-breaks"]';
    const state = `(()=>{const rows=${TIMELINE};const button=document.querySelector(${S(selector)});const r=button?.getBoundingClientRect();const x=r?r.left+r.width/2:null,y=r?r.top+r.height/2:null;const hit=x!==null&&y!==null?document.elementFromPoint(x,y):null;return{rows,stored:localStorage.getItem('akari.captions.fragmentBreaks.visible'),pressed:button?.getAttribute('aria-pressed')??null,hit:hit?{tag:hit.tagName,id:hit.id||null,className:typeof hit.className==='string'?hit.className:null,toggle:hit.dataset?.akariToggle??null}:null}})()`;
    const ready = await waitEval(cdp, `(()=>{const rows=${TIMELINE};const button=document.querySelector(${S(selector)});return rows.length===8&&rows.reduce((sum,row)=>sum+row.visualBlocks,0)===12&&rows.find(row=>row.id==='c-0002')?.fragmentCount===2&&button?.getAttribute('aria-pressed')==='true'?{rows,pressed:button.getAttribute('aria-pressed')}:null})()`, 'resolved fragments and toggle on');
    const offClick = await clickCenter(cdp, selector);
    const off = await waitEvalWithState(cdp, `(()=>{const rows=${TIMELINE};const button=document.querySelector(${S(selector)});return rows.length===8&&rows.every(row=>row.visualBlocks===1&&row.fragmentCount===0&&row.ticks===0)&&localStorage.getItem('akari.captions.fragmentBreaks.visible')==='false'&&button?.getAttribute('aria-pressed')==='false'?{rows,stored:localStorage.getItem('akari.captions.fragmentBreaks.visible'),pressed:button.getAttribute('aria-pressed')}:null})()`, state, 'fragment breaks off');
    await shot(cdp, 1, 'fragment-breaks-off');
    const onClick = await clickCenter(cdp, selector);
    const on = await waitEvalWithState(cdp, `(()=>{const rows=${TIMELINE};const button=document.querySelector(${S(selector)});return rows.length===8&&rows.reduce((sum,row)=>sum+row.visualBlocks,0)===12&&rows.every(row=>row.fragmentWidths.every(width=>width>0))&&localStorage.getItem('akari.captions.fragmentBreaks.visible')==='true'&&button?.getAttribute('aria-pressed')==='true'?{rows,stored:localStorage.getItem('akari.captions.fragmentBreaks.visible'),pressed:button.getAttribute('aria-pressed')}:null})()`, state, 'fragment breaks on');
    await shot(cdp, 2, 'fragment-breaks-on');
    const hashes = [out.screenshotSha256['01-fragment-breaks-off.png'], out.screenshotSha256['02-fragment-breaks-on.png']];
    assert(hashes[0] !== hashes[1], 'off/on screenshots have identical sha256');
    return { ready, offClick, off, onClick, on, screenshotSha256: hashes };
  });

  await step('2. lines=2 / wrap=fold で c-0002 が 1 cue と ⏎ 表示になる', async () => {
    const foldedSource = JSON.parse(await readFile(captionsPath, 'utf8'));
    Object.assign(foldedSource.display_policy, { lines: 2, wrap: 'fold' });
    await writeFile(captionsPath, `${JSON.stringify(foldedSource, null, 2)}\n`);
    const observed = await waitEval(cdp, `(async()=>{const row=${TIMELINE}.find(item=>item.id==='c-0002');if(!row||row.fragmentCount!==0||!row.label.endsWith('⏎'))return null;const rpc=await ${resolveRpc};const cues=rpc.captions.filter(cue=>cue.source_cue_id==='c-0002');return cues.length===1&&cues[0].display_lines?.length===2?{row,cueCount:cues.length,displayLines:cues[0].display_lines}:null})()`, 'folded caption', 120_000);
    await shot(cdp, 3, 'folded-caption-return-mark');
    return observed;
  });

  let failedOpen;
  await step('3. INVALID_POLICY は 1 回警告して全行を fail-open する', async () => {
    await evalOn(cdp, `(()=>{window.__akariCaptionWarns=[];const original=console.warn.bind(console);console.warn=(...args)=>{if(args.map(String).join(' ').includes('failed to resolve caption display'))window.__akariCaptionWarns.push(args.map(String).join(' '));return original(...args)};return true})()`);
    const invalid = JSON.parse(await readFile(captionsPath, 'utf8'));
    invalid.display_policy.max_line_units = 0;
    await writeFile(captionsPath, `${JSON.stringify(invalid, null, 2)}\n`);
    failedOpen = await waitEval(cdp, `(()=>{const rows=${TIMELINE};const notices=[...document.querySelectorAll('.theia-notification-message,[data-akari-timeline-notice]')].filter(node=>/INVALID_POLICY|max_line_units/.test(node.textContent??''));return rows.length===8&&rows.every(row=>row.fragmentCount===0)&&window.__akariCaptionWarns?.length===1&&notices.length===0?{rows,warns:window.__akariCaptionWarns.length,notices:notices.length}:null})()`, 'invalid policy fail-open', 120_000);
    return failedOpen;
  });

  await step('4. 復旧時は帯を RPC 応答とサブブロックより先に描く', async () => {
    const rpcHookInstalled = await evalOn(cdp, `(()=>{window.__akariOrder=[];window.__akariRpc={sends:[]};const strip=document.querySelector('.akari-annotations-strip');if(!strip)return false;window.__akariOrderObserver?.disconnect();window.__akariOrderObserver=new MutationObserver(records=>{for(const record of records){const target=record.target.nodeType===1?record.target:record.target.parentElement;const band=target?.matches?.('[data-akari-item-kind="caption"]')?target:target?.closest?.('[data-akari-item-kind="caption"]');const added=[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('[data-akari-item-kind="caption"]')||node.querySelector?.('[data-akari-item-kind="caption"]')));if((band&&record.type==='attributes')||added)window.__akariOrder.push({kind:'band',t:performance.now(),fragmentCount:document.querySelectorAll('[data-akari-caption-fragment]').length});const fragmentAdded=[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches?.('[data-akari-caption-fragment]')||node.querySelector?.('[data-akari-caption-fragment]')));if(fragmentAdded)window.__akariOrder.push({kind:'fragment',t:performance.now(),fragmentCount:document.querySelectorAll('[data-akari-caption-fragment]').length});}});window.__akariOrderObserver.observe(strip,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});if(window.__akariOriginalWebSocketSend)return true;const original=WebSocket.prototype.send;window.__akariOriginalWebSocketSend=original;WebSocket.prototype.send=function(payload){try{let text='';if(typeof payload==='string')text=payload;else if(payload instanceof ArrayBuffer)text=new TextDecoder('utf-8',{fatal:false}).decode(new Uint8Array(payload));else if(ArrayBuffer.isView(payload))text=new TextDecoder('utf-8',{fatal:false}).decode(new Uint8Array(payload.buffer,payload.byteOffset,payload.byteLength));if(text.includes('resolveCaptionDisplay'))window.__akariRpc.sends.push(performance.now())}catch{}return original.apply(this,arguments)};return true})()`);
    let order;
    try {
      const restored = JSON.parse(await readFile(captionsPath, 'utf8'));
      restored.display_policy.max_line_units = 10;
      delete restored.display_policy.lines;
      delete restored.display_policy.wrap;
      await writeFile(captionsPath, `${JSON.stringify(restored, null, 2)}\n`);
      order = await waitEval(cdp, `(()=>{const rows=${TIMELINE};if(rows.reduce((sum,row)=>sum+row.visualBlocks,0)!==12)return null;const events=window.__akariOrder??[];const firstBand=events.find(event=>event.kind==='band');const firstFragment=events.find(event=>event.kind==='fragment');if(!firstBand||!firstFragment)return null;const sends=window.__akariRpc?.sends??[];return{firstBand,firstFragment,deltaMs:firstFragment.t-firstBand.t,rpcHookInstalled:${rpcHookInstalled},rpcInstrumented:sends.length>0,resolveCaptionDisplaySend:sends[0]??null,rpc:{sends},events}})()`, 'restored fragment order', 120_000);
      assert(order.firstBand.t <= order.firstFragment.t, `band was not observed before fragments: ${S(order)}`);
      assert(order.firstBand.fragmentCount === 0, `fragments existed at first band render: ${S(order.firstBand)}`);
      if (order.rpcInstrumented) {
        assert(order.firstBand.t < order.resolveCaptionDisplaySend,
          `caption band was not rendered before resolveCaptionDisplay send: ${S(order)}`);
      }
    } finally {
      await evalOn(cdp, `(()=>{window.__akariOrderObserver?.disconnect();if(window.__akariOriginalWebSocketSend){WebSocket.prototype.send=window.__akariOriginalWebSocketSend;delete window.__akariOriginalWebSocketSend}return true})()`).catch(() => {});
    }
    await shot(cdp, 4, 'invalid-policy-recovered');
    return { failedOpen, order };
  });

  out.status = 'pass'; await save();
} catch (error) {
  out.status = 'fail'; out.error = sanitize(error);
  try { if (cdp) { await screenshot(cdp, path.join(ROOT, '99-failure.png')); out.screenshots.push('99-failure.png'); } } catch {}
  await save(); process.exitCode = 1;
} finally {
  cdp?.close();
  const pid = child?.pid;
  if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} await sleep(2500); try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {} }
  const countSurvivors = async () => {
    const processList = await new Promise(resolve => {
      const probe = spawn('ps', ['-eo', 'pid,ppid,args']); let stdout = '';
      probe.stdout.on('data', chunk => { stdout += chunk; }); probe.once('close', () => resolve(stdout));
    });
    return String(processList).split('\n').filter(line => line.includes(work) && !line.includes('ps -eo')).length;
  };
  let survivors = await countSurvivors();
  for (let attempt = 0; attempt < 20 && survivors !== 0; attempt += 1) { await sleep(500); survivors = await countSurvivors(); }
  await rm(work, { recursive: true, force: true });
  out.cleanup = { killedPid: pid ?? null, survivingIsolatedProcesses: survivors, temporaryProjectRemoved: true };
  if (survivors !== 0) { out.status = 'fail'; out.cleanupError = `${survivors} isolated Electron process(es) survived`; process.exitCode = 1; }
  await save();
}
