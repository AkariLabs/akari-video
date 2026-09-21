#!/usr/bin/env node
// Run by the wrapper on a GUI-capable host, after rebuilding apps/shell.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, listTargets, evalOn, realClick, screenshot } from './cdp-lib.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ISO = await mkdtemp(path.join(tmpdir(), 'akari-retry-final-'));
const PROJECT = path.join(ISO, 'project');
const PORT = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 22224);
const ELECTRON = process.env.AKARI_L1_ELECTRON ?? path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = { status: 'running', steps: [], screenshots: [], measurements: {} };
const S = JSON.stringify;
const clean = text => String(text).replaceAll(REPO, '<WORKTREE>').replaceAll(ISO, '<TMP>').replaceAll(process.env.HOME ?? '/nonexistent-home', '<HOME>');
const save = () => writeFile(path.join(ROOT, 'results.json'), clean(JSON.stringify(results, null, 2)) + '\n');
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
});
let cdp, child, launchError;
const wait = async (operation, label, timeout = 60_000) => {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) {
    if (launchError) throw launchError;
    try { const value = await operation(); if (value) return value; } catch (error) { last = error; }
    await sleep(150);
  }
  throw new Error(`${label}: timeout ${last?.message ?? ''}`);
};
const waitDom = (expression, label, timeout) => wait(() => evalOn(cdp, expression), label, timeout);
const command = id => evalOn(cdp, `(async()=>{
 const container=window.theia.container;
 const key=[...container._bindingDictionary._map.keys()].find(key=>typeof key==='function'&&typeof key.prototype?.executeCommand==='function');
 await container.get(key).executeCommand(${S(id)}); return true;
})()`);
const click = async selector => {
  await evalOn(cdp, `document.querySelector(${S(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await waitDom(`(()=>{
    const e=document.querySelector(${S(selector)});if(!e||e.disabled)return null;
    const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    return r.width>0&&r.height>0&&e.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`, `clickable ${selector}`);
  await realClick(cdp, point.x, point.y);
};
const shot = async name => { await screenshot(cdp, path.join(ROOT, name)); results.screenshots.push(name); await save(); };
const step = async (name, operation) => {
  const row = { name, pass: false }; results.steps.push(row);
  try { row.detail = await operation(); row.pass = true; await save(); } catch (error) { row.error = clean(error.stack); await save(); throw error; }
};
const invocations = async () => {
  const text = await readFile(path.join(PROJECT, 'fake-invocations.jsonl'), 'utf8').catch(error => { if(error.code === 'ENOENT') return ''; throw error; });
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
};
const itemInvocations = (calls, itemId) => calls.filter(call => call.args[call.args.indexOf('--item') + 1] === itemId);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const approvalDialogs = `([...document.querySelectorAll('.dialogBlock')].filter(d=>d.textContent.includes('費用承認')))`;
const clickApproval = async label => {
  await evalOn(cdp, `(()=>{
    const dialogs=${approvalDialogs};if(dialogs.length!==1)throw new Error('Expected exactly one approval dialog');
    const button=[...dialogs[0].querySelectorAll('button')].find(b=>b.textContent.trim()===${S(label)});
    if(!button)throw new Error('Approval button missing');button.setAttribute('data-akari-generation-dialog-action','');
  })()`);
  await click('[data-akari-generation-dialog-action]');
};
const clip = '[data-akari-ui="timeline:cut:0"]';
const retry = `${clip} .akari-generation-action`;
const checkbox = '[data-akari-generation-field="generation-cheap-draft"] input[type="checkbox"]';
const resolution = '[data-akari-field="generation-resolution"] select';
const estimate = () => evalOn(cdp, `(()=>{const t=document.querySelector('.akari-inspector-generation-estimate')?.textContent;const m=t?.match(/\\$([0-9.]+)/);return m?Number(m[1]):null})()`);
async function measureChip() {
  return evalOn(cdp, `(()=>{
    const chip=document.querySelector(${S(clip)}),button=chip?.querySelector('.akari-generation-action');
    if(!button)throw new Error('retry missing');
    const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const badge=chip.querySelector('[data-akari-generation-badge]'),time=chip.querySelector('.akari-annotations-strip-clip-header-duration');
    const name=chip.querySelector('.akari-annotations-strip-clip-header-label');
    const rectangles={chip:rect(chip),button:rect(button),badge:rect(badge),name:rect(name),time:rect(time)};
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const style=getComputedStyle(button);
    const pairs=[['button','badge'],['button','name'],['button','time'],['badge','name'],['badge','time'],['name','time']];
    const intersections=Object.fromEntries(pairs.map(([a,b])=>[a+b[0].toUpperCase()+b.slice(1),intersects(rectangles[a],rectangles[b])]));
    return {rectangles,intersections,nameText:name.textContent,
      style:{background:style.backgroundColor,borderWidth:style.borderTopWidth,borderStyle:style.borderTopStyle,borderColor:style.borderTopColor,pointerEvents:style.pointerEvents},text:button.textContent};
  })()`);
}
function assertChip(measured) {
  assert.equal(measured.text, 'もう一度');
  assert.equal(Object.keys(measured.intersections).length, 6);
  assert.ok(Object.values(measured.intersections).every(value => value === false));
  const { rectangles: r, style } = measured;
  for (const box of [r.button,r.badge,r.name,r.time]) {
    assert.ok(box.width>0&&box.height>0); assert.ok(box.left>=r.chip.left&&box.right<=r.chip.right);
  }
  const transparent = color => ['transparent','rgba(0, 0, 0, 0)'].includes(color);
  assert.ok(!transparent(style.background)||(parseFloat(style.borderWidth)>0&&!['none','hidden'].includes(style.borderStyle)&&!transparent(style.borderColor)));
  assert.equal(style.pointerEvents, 'auto');
}
try {
  results.fixture = JSON.parse(await run(process.execPath, [path.join(ROOT, 'scripts/gen-fixture.mjs')], { ...process.env, AKARI_GENERATION_PROJECT: PROJECT }));
  for (const dir of ['akari-home','user-data','theia-config']) await mkdir(path.join(ISO,dir), { recursive: true });
  child = spawn(ELECTRON, [SHELL, PROJECT, `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ISO,'user-data')}`, '--no-sandbox'], {
    cwd: REPO, env: { ...process.env, AKARI_HOME: path.join(ISO,'akari-home'), THEIA_CONFIG_DIR: path.join(ISO,'theia-config'), AKARI_GENERATE_CLI: path.join(ROOT,'scripts/fake-generate.mjs') }, stdio: ['ignore','pipe','pipe']
  });
  child.once('error', error => { launchError = error; });
  const logs = []; child.stdout.on('data', chunk => logs.push(clean(chunk))); child.stderr.on('data', chunk => logs.push(clean(chunk)));
  const target = await wait(async () => (await listTargets(PORT)).find(target => target.type === 'page'), 'CDP target', 120_000);
  cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  await waitDom(`Boolean(window.theia?.container&&document.getElementById('theia-app-shell'))`, 'Theia ready', 600_000);
  await waitDom(`(()=>{const e=document.querySelector('.theia-preload');return !e||getComputedStyle(e).display==='none'||getComputedStyle(e).pointerEvents==='none'})()`, 'preload gone', 600_000);
  if (!await waitDom(`Boolean(document.querySelector(${S(clip)}))`, 'restored timeline', 30_000).catch(() => false)) await command('akari.annotations.open');
  await waitDom(`Boolean(document.querySelector(${S(retry)}))`, 'failed retry chip', 120_000);
  const originalEdit = await readFile(path.join(PROJECT,'edit.json'),'utf8');
  await step('1. 失敗チップのもう一度・札・名前・時刻の6組の非交差と背景/枠線、狭いクリップの非表示', async () => {
    const measured=await measureChip(); results.measurements.before=measured; assertChip(measured);
    const narrow=await evalOn(cdp, `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"]');return {width:e.getBoundingClientRect().width,retry:!!e.querySelector('.akari-generation-action'),title:e.title}})()`);
    assert.ok(narrow.width<200); assert.equal(narrow.retry,false); assert.match(narrow.title,/もう一度/);
    await shot('01-failed-timeline.png'); return { measured,narrow };
  });
  await step('2. チップのもう一度をCDP実クリック → 生成タブ → 費用承認、未承認0件', async () => {
    assert.equal((await invocations()).length,0);
    await click(retry);
    await waitDom(`document.querySelector('[data-akari-ui="tab:inspector-generation"]')?.classList.contains('is-active')`, 'generation tab');
    await waitDom(`(()=>{const ds=[...document.querySelectorAll('.dialogBlock')].filter(d=>d.textContent.includes('費用承認'));return ds.length===1&&ds[0].textContent.includes('as_of')})()`, 'cost approval');
    assert.equal((await invocations()).length,0);
    await shot('02-generation-approval.png'); return { activeTab:'generation',invocationsBeforeApproval:0 };
  });
  await step('3. 費用承認を実クリック → 偽 CLI 起動記録ちょうど1件', async () => {
    await evalOn(cdp, `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(d=>d.textContent.includes('費用承認'));const b=[...d.querySelectorAll('button')].find(b=>b.textContent.includes('費用承認する'));b.setAttribute('data-akari-generation-approve','')})()`);
    await click('[data-akari-generation-approve]');
    const calls=await wait(async()=>{const calls=await invocations();return calls.length?calls:null;},'fake CLI invocation'); assert.equal(calls.length,1);
    await waitDom(`Boolean(document.querySelector('[data-akari-generation-action="retry"]'))`, 'failed retry returns');
    await wait(async()=>{const meta=JSON.parse(await readFile(path.join(PROJECT,'assets/generated/gen-clip-a.mp4.meta.json'),'utf8'));return meta.status==='failed'&&meta.job?.request_id==='fake-clip-a';},'fake failure');
    await click('[data-akari-ui="tab:inspector-generation"]');
    await shot('03-failed-after-retry.png'); return calls;
  });
  await step('4. 下書きONは解像度固定・見積低下、OFFで解像度と見積復元', async () => {
    await waitDom(`Boolean(document.querySelector(${S(checkbox)}))`, 'draft checkbox');
    const before={estimate:await estimate(),resolution:await evalOn(cdp,`document.querySelector(${S(resolution)}).value`)};
    assert.ok(before.estimate>0); assert.equal(before.resolution,'768P');
    await click(checkbox);
    await waitDom(`document.querySelector(${S(checkbox)})?.checked&&document.querySelector(${S(resolution)})?.disabled&&document.querySelector(${S(resolution)})?.value==='480P'`, 'draft on');
    const lower=await wait(async()=>{const value=await estimate();return value!==null&&value<before.estimate?value:null;},'estimate lower');
    await wait(async()=>JSON.parse(await readFile(path.join(PROJECT,'assets/stills/a.png.meta.json'),'utf8')).next.output.resolution==='480P','draft persisted');
    await shot('04-draft-on.png'); await click(checkbox);
    await waitDom(`!document.querySelector(${S(checkbox)})?.checked&&!document.querySelector(${S(resolution)})?.disabled&&document.querySelector(${S(resolution)})?.value===${S(before.resolution)}`, 'draft off');
    await wait(async()=>await estimate()===before.estimate,'estimate restored');
    await wait(async()=>JSON.parse(await readFile(path.join(PROJECT,'assets/stills/a.png.meta.json'),'utf8')).next.output.resolution===before.resolution,'restored persisted');
    await shot('05-draft-off.png'); assert.equal((await invocations()).length,1);
    assert.equal(await readFile(path.join(PROJECT,'edit.json'),'utf8'),originalEdit);
    const measured=await measureChip(); results.measurements.after=measured; assertChip(measured);
    return {before,on:{estimate:lower,resolution:'480P'},off:{estimate:await estimate(),resolution:before.resolution},invocations:1,editUnchanged:true};
  });
  const final = results.fixture.finalQuality;
  const finalClip = `[data-akari-ui="timeline:cut:${results.fixture.clips.indexOf(final.itemId)}"]`;
  const finalAction = '[data-akari-generation-action="final-quality"]';
  const generateAction = '[data-akari-generation-action="generate"]';
  const originalMetaPath = path.join(PROJECT, `${final.originalPath}.meta.json`);
  const videoMetaPath = path.join(PROJECT, `${final.sourcePath}.meta.json`);
  const originalBytes = await readFile(originalMetaPath);
  const callsBeforeFinal = (await invocations()).length;
  const catalog = JSON.parse(await readFile(path.join(REPO, 'packages/schemas/gen-models.json'), 'utf8'));
  const row = catalog.models.find(row => row.id === final.modelId);
  const prices = row.price.by_resolution;
  const finalMeasurement = results.measurements.finalQuality = {
    itemId: final.itemId, draftResolution: final.draftResolution,
    originalMetaSha256: { before: sha256(originalBytes) }, invocationsBefore: callsBeforeFinal
  };
  await step('5. done 下書きのクリップを実クリック → 本番の画質にする…と注記', async () => {
    assert.equal(itemInvocations(await invocations(), final.itemId).length, 0);
    const meta = JSON.parse(await readFile(videoMetaPath, 'utf8'));
    assert.equal(meta.kind, 'video'); assert.equal(meta.status, 'done');
    assert.equal(meta.output.resolution, final.draftResolution);
    assert.equal(prices[final.draftResolution], Math.min(...Object.values(prices)));
    await click(finalClip);
    await click('[data-akari-ui="tab:inspector-generation"]');
    await waitDom(`document.querySelector(${S(finalAction)})?.textContent==='本番の画質にする…'`, 'final-quality action');
    const note = await waitDom(`(()=>{const e=document.querySelector('[data-akari-field="generation-final-note"]');return e?.textContent.includes('絵は変わることがあります')?e.textContent:null})()`, 'final-quality note');
    assert.match(note, /同じ入力でもう一度、高い画質で生成します/);
    await evalOn(cdp, `document.querySelector(${S(finalAction)}).scrollIntoView({block:'center'})`);
    await shot('06-final-quality-note.png');
    return { itemId: final.itemId, note, invocations: 0 };
  });
  await step('6. 本番画質の初期解像度・見積 → 費用承認1つ → キャンセルで起動0件', async () => {
    await click(finalAction);
    const initialResolution = await waitDom(`document.querySelector(${S(resolution)})?.value`, 'final resolution');
    finalMeasurement.initialResolution = initialResolution;
    assert.equal(initialResolution, final.selectedResolution);
    assert.ok(prices[initialResolution] > prices[final.draftResolution], 'initial resolution must be above draft');
    const expectedEstimate = prices[initialResolution] * 5;
    const finalEstimate = await wait(async () => {
      const value = await estimate(); return value === expectedEstimate ? value : null;
    }, 'final estimate');
    finalMeasurement.estimate = finalEstimate;
    finalMeasurement.selectedResolution = initialResolution;
    await click(generateAction);
    await waitDom(`${approvalDialogs}.length===1&&${approvalDialogs}[0].textContent.includes('as_of')`, 'final approval');
    finalMeasurement.cancelDialogCount = await evalOn(cdp, `${approvalDialogs}.length`);
    assert.equal(finalMeasurement.cancelDialogCount, 1);
    const dialogText = await evalOn(cdp, `${approvalDialogs}[0].textContent`);
    assert.ok(dialogText.includes(`$${finalEstimate.toFixed(2)}`));
    assert.equal((await invocations()).length, callsBeforeFinal);
    await shot('07-final-quality-approval.png');
    await clickApproval('キャンセル');
    await waitDom(`${approvalDialogs}.length===0`, 'approval cancelled');
    // Allow a wrongly started asynchronous CLI to reach its invocation log before asserting zero.
    await sleep(1500);
    const calls = await invocations();
    finalMeasurement.invocationsAfterCancel = itemInvocations(calls, final.itemId).length;
    finalMeasurement.totalInvocationsAfterCancel = calls.length;
    assert.equal(calls.length, callsBeforeFinal);
    assert.equal(finalMeasurement.invocationsAfterCancel, 0);
    finalMeasurement.originalMetaSha256.afterCancel = sha256(await readFile(originalMetaPath));
    assert.equal(finalMeasurement.originalMetaSha256.afterCancel, finalMeasurement.originalMetaSha256.before);
    return { initialResolution, selectedResolution: initialResolution, estimate: finalEstimate,
      dialogCount: finalMeasurement.cancelDialogCount, invocationsAfterCancel: 0, originalMetaSha256: finalMeasurement.originalMetaSha256.afterCancel };
  });
  await step('7. 本番画質を再度承認 → 対象itemの偽CLI1件・mp4 next・元静止画metaのバイト列不変', async () => {
    await click(generateAction);
    await waitDom(`${approvalDialogs}.length===1`, 'final approval again');
    finalMeasurement.approveDialogCount = await evalOn(cdp, `${approvalDialogs}.length`);
    assert.equal(finalMeasurement.approveDialogCount, 1);
    assert.equal((await invocations()).length, callsBeforeFinal);
    await clickApproval('費用承認する');
    await wait(async () => itemInvocations(await invocations(), final.itemId).length > 0, 'final fake CLI invocation');
    await waitDom(`${approvalDialogs}.length===0&&document.querySelector(${S(generateAction)})?.disabled===false`, 'final request returned');
    await sleep(500);
    const calls = await invocations();
    const finalCalls = itemInvocations(calls, final.itemId);
    finalMeasurement.invocationsAfterApproval = finalCalls.length;
    finalMeasurement.calls = finalCalls;
    assert.equal(calls.length, callsBeforeFinal + 1);
    assert.equal(finalCalls.length, 1);
    assert.equal(finalCalls[0].args[finalCalls[0].args.indexOf('--item') + 1], final.itemId);
    assert.equal(finalCalls[0].next.output.resolution, finalMeasurement.selectedResolution);
    const meta = JSON.parse(await readFile(videoMetaPath, 'utf8'));
    finalMeasurement.mp4NextResolution = meta.next.output.resolution;
    assert.equal(meta.next.output.resolution, finalMeasurement.selectedResolution);
    const afterBytes = await readFile(originalMetaPath);
    finalMeasurement.originalMetaSha256.afterApproval = sha256(afterBytes);
    finalMeasurement.originalMetaBytesUnchanged = originalBytes.equals(afterBytes);
    assert.equal(finalMeasurement.originalMetaSha256.afterApproval, finalMeasurement.originalMetaSha256.before);
    assert.equal(finalMeasurement.originalMetaBytesUnchanged, true);
    assert.equal(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'), originalEdit);
    finalMeasurement.fakeCliMode = 'record-only';
    await shot('08-final-quality-after.png');
    return finalMeasurement;
  });
  await writeFile(path.join(ROOT,'electron.log'), logs.join(''));
  results.status='pass';
} catch(error) {
  results.status='fail'; results.error=clean(error.stack); process.exitCode=1;
  if(cdp) results.debugChip=await evalOn(cdp,`(()=>{const e=document.querySelector(${S(clip)});return e?{html:e.outerHTML.slice(0,3000),rect:e.getBoundingClientRect().width,styleWidth:e.style.width}:null})()`).catch(e=>String(e));
  if(cdp) await shot('99-failure.png').catch(()=>{});
} finally {
  cdp?.close();
  if(child?.pid) {
    child.kill('SIGTERM');
    await wait(async()=>child.exitCode!==null||child.signalCode!==null,'Electron stopped',5000).catch(async()=>{child.kill('SIGKILL');await wait(async()=>child.exitCode!==null||child.signalCode!==null,'Electron killed',5000);});
  }
  results.cleanup={electronStopped:!child||child.exitCode!==null||child.signalCode!==null,temporaryHome:true,temporaryUserData:true};
  await rm(ISO,{recursive:true,force:true}); await save();
}
