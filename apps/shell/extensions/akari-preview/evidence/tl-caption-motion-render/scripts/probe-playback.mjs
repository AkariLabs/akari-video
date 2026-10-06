#!/usr/bin/env node
// Observe the output-preview webview during normal playback. The caller supplies a dedicated fixture.
import { realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets } from '../../preview-caption-textanim/scripts/cdp-lib.mjs';
import { launch, sleep, waitEval } from '../../preview-caption-textanim/scripts/l1-lib.mjs';
import { recordsDir } from './records.mjs';
import { stopOwnedElectron } from './stop-owned-electron.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const shell = path.join(repo, 'apps/shell');
const project = await realpath(path.join(path.resolve(process.argv[2] || ''), 'project'));
if (!process.argv[2] || !project.includes('tl-caption-motion-render')) throw new Error('dedicated project required');
const isoDir = path.join(path.dirname(project), 'tl-caption-motion-render-isolation');
const editUri = `file://${path.join(project, 'edit.json')}`;
const port = 9475;
let session, webview, webviewContext;
const command = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${JSON.stringify(id)},${JSON.stringify(arg)});return true})()`;
async function attach() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    for (const target of (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
      const c = new CDP(target.webSocketDebuggerUrl);
      try {
        await c.connect();
        const contexts = []; c.on('Runtime.executionContextCreated', event => contexts.push(event.context));
        await c.send('Runtime.enable'); await sleep(300);
        for (const context of [undefined, ...contexts.map(item => item.id)]) {
          try {
            if (await evalOn(c, `Boolean(document.querySelector('#preview-stage'))`, context)) {
              webviewContext = context; return c;
            }
          } catch {}
        }
      } catch {}
      c.close();
    }
    await sleep(500);
  }
  throw new Error('preview webview unavailable');
}
const state = `(()=>{const rows=[...document.querySelectorAll('.caption-row-plate')];const row=rows.find(e=>e.id.startsWith('caption-plate-c-0-0'))||rows[0];const plate=row?.querySelector('.akari-caption__plate');const css=plate&&getComputedStyle(plate);return{visibility:document.visibilityState,videoTime:document.querySelector('video')?.currentTime??null,outputTime:window.akari?.preview?.outputTime??null,canvas:!!document.querySelector('#preview-stage canvas'),row:!!row,rowIds:rows.map(e=>e.id).slice(0,4),animation:css?.animationName,opacity:css?.opacity,transform:css?.transform,clipPath:css?.clipPath,animations:row?.getAnimations({subtree:true}).map(a=>({name:a.animationName,time:a.currentTime,state:a.playState}))}})()`;
try {
  session = await launch({ shellDir: shell, electron: path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), project, port, isoDir });
  await evalOn(session.cdp, `(()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.findProjectLocation==='function');void window.theia.container.get(K).open(${JSON.stringify(editUri)});return true})()`);
  await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget, .akari-annotations'))||document.querySelectorAll('[class*="akari-timeline"]').length>0`, { timeoutMs: 120000 });
  for (let i = 0; i < 20; i++) { await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: .3 })); await sleep(2000); if ((await listTargets(port)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break; }
  webview = await attach();
  if (!process.argv.includes('--keep-hidden')) {
    await session.cdp.send('Page.bringToFront').catch(() => {});
    await session.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    await session.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await webview.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: 0 }));
  await sleep(1200);
  const before = await evalOn(webview, state, webviewContext);
  await evalOn(webview, `(()=>{window.__captionMotionSamples=[];window.__captionMotionTimerSamples=[];window.__captionMotionSampling=true;const sample=()=>{if(!window.__captionMotionSampling)return;window.__captionMotionSamples.push({now:performance.now(),state:${state}});requestAnimationFrame(sample)};requestAnimationFrame(sample);window.__captionMotionTimer=setInterval(()=>{if(window.__captionMotionSampling)window.__captionMotionTimerSamples.push({now:performance.now(),state:${state}})},100);return true})()`, webviewContext);
  const playAccepted = await evalOn(session.cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return await window.theia.container.get(C).executeCommand('akari.preview.play',${JSON.stringify({ editUri })})})()`);
  await sleep(5000);
  await evalOn(session.cdp, command('akari.preview.pause', { editUri }));
  await evalOn(webview, `(()=>{window.__captionMotionSampling=false;clearInterval(window.__captionMotionTimer);return true})()`, webviewContext);
  const samples = await evalOn(webview, `window.__captionMotionSamples`, webviewContext);
  const timerSamples = await evalOn(webview, `window.__captionMotionTimerSamples`, webviewContext);
  const capture = async (time, name) => {
    if (Number.isFinite(time)) {
      await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time }));
      await sleep(700);
    }
    const rect = await evalOn(webview, `(()=>{const r=document.querySelector('#preview-stage')?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`, webviewContext);
    if (!rect) throw new Error('preview stage missing');
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return r&&{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    if (!frame) throw new Error('preview frame missing');
    const sx = frame.width / rect.viewportWidth, sy = frame.height / rect.viewportHeight;
    const clip = { x: frame.x + rect.x * sx, y: frame.y + rect.y * sy, width: rect.width * sx, height: rect.height * sy, scale: 1 };
    const shot = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip });
    await writeFile(path.join(recordsDir, name), Buffer.from(shot.data, 'base64'));
    return await evalOn(webview, state, webviewContext);
  };
  await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: .2 }));
  await sleep(700);
  await evalOn(session.cdp, command('akari.preview.play', { editUri }));
  await sleep(30);
  const playingBefore = await evalOn(webview, state, webviewContext);
  const playingCapture = await capture(null, 'owner-glitch-playing-10.png');
  await evalOn(session.cdp, command('akari.preview.pause', { editUri }));
  const owner = { playingBefore, playingCapture, animated: await capture(.3, 'owner-glitch-10.png'), control: await capture(3.3, 'owner-glitch-control-10.png'), typewriter: await capture(6.7, 'typewriter-preview-50.png') };
  const out = { before, playAccepted, samples, timerSamples, owner };
  await writeFile(path.join(recordsDir, 'playback-probe.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ before, playAccepted, sampleCount: samples.length, timerSampleCount: timerSamples.length, distinctTimes: [...new Set([...samples, ...timerSamples].map(item => item.state?.animations?.[0]?.time))].length, samples: [...samples, ...timerSamples].slice(0, 5) }));
} finally {
  webview?.close();
  await stopOwnedElectron(session, { project, isoDir, repo });
}
