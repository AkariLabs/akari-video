#!/usr/bin/env node
// Observe all fourteen speech-derived cues across one uninterrupted output-preview play.
import { readFile, realpath, writeFile } from 'node:fs/promises';
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
if (!process.argv[2] || !project.includes('tl-caption-motion-render')) throw new Error('dedicated fixture required');
const isoDir = path.join(path.dirname(project), 'tl-caption-motion-render-owner-isolation');
const editUri = `file://${path.join(project, 'edit.json')}`;
const cues = JSON.parse(await readFile(path.join(project, 'captions.json'))).captions;
const port = 9475;
let session, view, context;
const command = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${JSON.stringify(id)},${JSON.stringify(arg)});return true})()`;
async function attach() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    for (const target of (await listTargets(port)).filter(item => item.type === 'iframe' && /webview\/index\.html/u.test(item.url))) {
      const client = new CDP(target.webSocketDebuggerUrl);
      try {
        await client.connect(); const contexts = [];
        client.on('Runtime.executionContextCreated', event => contexts.push(event.context));
        await client.send('Runtime.enable'); await sleep(250);
        for (const candidate of [undefined, ...contexts.map(item => item.id)]) {
          try { if (await evalOn(client, `Boolean(document.querySelector('#preview-stage'))`, candidate)) {
            context = candidate; return { client, target };
          } } catch {}
        }
      } catch {}
      client.close();
    }
    await sleep(400);
  }
  throw new Error('output preview webview unavailable');
}
try {
  session = await launch({ shellDir: shell,
    electron: path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    project, port, isoDir });
  await evalOn(session.cdp, `(()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.findProjectLocation==='function');void window.theia.container.get(K).open(${JSON.stringify(editUri)});return true})()`);
  await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget'))`, { timeoutMs: 120000, label: 'timeline' });
  for (let i = 0; i < 25; i++) {
    await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: 0 }));
    await sleep(800);
    if ((await listTargets(port)).some(item => item.type === 'iframe' && /webview\/index\.html/u.test(item.url))) break;
  }
  const attached = await attach(); view = attached.client;
  await session.cdp.send('Page.bringToFront').catch(() => {});
  await session.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await session.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await view.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const surface = await evalOn(session.cdp, `({tabs:[...document.querySelectorAll('[class*="tabLabel"],.theia-tabBar-tabLabel')].map(e=>e.textContent?.trim()).filter(Boolean),bodyMentionsOutput:document.body.innerText.includes('出力プレビュー')})`);
  surface.webviewUrlIsOutput = attached.target.url.includes('akari-output-preview');
  for (let i = 0; i < 60; i++) {
    if (await evalOn(view, `([...document.querySelectorAll('.caption-row-plate')].some(e=>e.id.includes('owner-01')))`, context).catch(() => false)) break;
    await sleep(500);
  }
  await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: 0 }));
  await sleep(500);
  await evalOn(view, `(()=>{window.__ownerPlaybackSamples=[];window.__ownerPlaybackActive=true;window.__ownerNodes=new WeakMap();window.__ownerNodeNext=0;const sample=()=>{if(!window.__ownerPlaybackActive)return;const row=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.includes('owner-'));const plate=row?.querySelector('.akari-caption__plate');let node=null;if(row){node=window.__ownerNodes.get(row);if(!node){node=++window.__ownerNodeNext;window.__ownerNodes.set(row,node)}}const animation=plate?.getAnimations({subtree:true}).find(a=>(a.animationName||'').startsWith('akari-anim-')||(a.animationName||'').startsWith('akari-typewriter-char-'));const css=plate&&getComputedStyle(plate);window.__ownerPlaybackSamples.push({now:performance.now(),visibility:document.visibilityState,id:row?.id||null,node,animation:animation?.animationName||null,currentTime:animation?.currentTime??null,opacity:css?.opacity??null,clipPath:css?.clipPath??null,typeChars:plate?.querySelectorAll('.akari-caption__type-char').length??0,karaokeTokens:plate?.querySelectorAll('.akari-caption__tok--karaoke').length??0,htmlLength:plate?.innerHTML.length??0});requestAnimationFrame(sample)};requestAnimationFrame(sample);return true})()`, context);
  const accepted = await evalOn(session.cdp, `(async()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');return await window.theia.container.get(C).executeCommand('akari.preview.play',${JSON.stringify({ editUri })})})()`);
  await sleep(30000);
  await evalOn(session.cdp, command('akari.preview.pause', { editUri }));
  await evalOn(view, `window.__ownerPlaybackActive=false`, context);
  const samples = await evalOn(view, `window.__ownerPlaybackSamples`, context);
  const summary = cues.map(cue => {
    const seen = samples.filter(sample => sample.id?.includes(cue.id));
    const times = seen.map(sample => Number(sample.currentTime)).filter(Number.isFinite);
    return { id: cue.id, expected: cue.text_style?.animation?.in?.id ?? null, words: cue.words.length,
      styled: cue.style === 'karaoke', samples: seen.length, nodes: [...new Set(seen.map(sample => sample.node))],
      animationNames: [...new Set(seen.map(sample => sample.animation).filter(Boolean))],
      firstCurrentTimeMs: times[0] ?? null, maxCurrentTimeMs: times.length ? Math.max(...times) : null,
      karaokeTokenMax: Math.max(0, ...seen.map(sample => sample.karaokeTokens)),
      typeCharMax: Math.max(0, ...seen.map(sample => sample.typeChars)) };
  });
  const result = { accepted, surface, sampleCount: samples.length,
    visibleSamples: samples.filter(sample => sample.visibility === 'visible').length,
    summary, samples };
  await writeFile(path.join(recordsDir, 'owner-playback-14.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ accepted, outputSurface: surface.webviewUrlIsOutput, sampleCount: samples.length,
    seen: summary.filter(item => item.samples > 0).length,
    animated: summary.filter(item => item.expected && item.animationNames.length > 0).length,
    styledAnimated: summary.filter(item => item.expected && item.styled && item.animationNames.length > 0).length,
    firstTimes: summary.map(item => [item.id, item.firstCurrentTimeMs]) }));
} finally {
  view?.close();
  await stopOwnedElectron(session, { project, isoDir, repo });
}
