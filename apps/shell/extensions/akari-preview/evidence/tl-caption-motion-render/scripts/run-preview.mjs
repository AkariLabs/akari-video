#!/usr/bin/env node
// Seek the output preview to each animated/still pair and compare actual stage pixels.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, listTargets } from '../../preview-caption-textanim/scripts/cdp-lib.mjs';
import { launch, sleep, waitEval } from '../../preview-caption-textanim/scripts/l1-lib.mjs';
import { recordsDir } from './records.mjs';
import { stopOwnedElectron } from './stop-owned-electron.mjs';
import { neutralCheck, neutralPass } from './neutral-checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const root = path.resolve(process.argv[2] || '');
const variant = process.argv[3];
if (!process.argv[2] || !root.includes('tl-caption-motion-render') || !['legacy', 'policy'].includes(variant)) throw new Error('usage: run-preview.mjs <dedicated fixture> legacy|policy');
const sourceProject = await realpath(path.join(root, variant, 'project'));
const previewProject = path.join(root, `tl-caption-motion-render-preview-input-${variant}`);
await rm(previewProject, { recursive: true, force: true });
await mkdir(path.join(previewProject, 'assets'), { recursive: true });
await mkdir(path.join(previewProject, '.akari'), { recursive: true });
for (const name of ['edit.json', 'captions.json']) await copyFile(path.join(sourceProject, name), path.join(previewProject, name));
await copyFile(path.join(sourceProject, 'assets/base.mp4'), path.join(previewProject, 'assets/base.mp4'));
const project = await realpath(previewProject);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')));
const resultName = `preview-${variant}-${manifest.label ? `${manifest.label}-` : ''}${manifest.chunkStart ?? 0}.json`;
const editUri = `file://${path.join(project, 'edit.json')}`;
const isoDir = path.join(root, `tl-caption-motion-render-preview-${variant}`);
const port = 9475;
const safe = message => String(message || '').replace(/\/(?:Users|private|var|tmp)\/[^\s)'"`]+/gu, '<machine-path>');
let session, view, context;
const command = (id, arg) => `(()=>{const d=window.theia.container._bindingDictionary;const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function');void window.theia.container.get(C).executeCommand(${JSON.stringify(id)},${JSON.stringify(arg)});return true})()`;
async function attach() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    for (const target of (await listTargets(port)).filter(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) {
      const client = new CDP(target.webSocketDebuggerUrl);
      try {
        await client.connect(); const contexts = [];
        client.on('Runtime.executionContextCreated', event => contexts.push(event.context));
        await client.send('Runtime.enable'); await sleep(300);
        for (const candidate of [undefined, ...contexts.map(item => item.id)]) {
          try { if (await evalOn(client, `Boolean(document.querySelector('#preview-stage'))`, candidate)) { context = candidate; return client; } } catch {}
        }
      } catch {}
      client.close();
    }
    await sleep(400);
  }
  throw new Error('output preview webview unavailable');
}
const raw = png => {
  const result = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 320 * 180 * 3 + 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
};
const compare = (a, b) => {
  let sum = 0, changed = 0;
  const baseA = a.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
  const baseB = b.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
  for (let i = 320 * 90 * 3; i < a.length; i += 3) {
    const d = Math.max(Math.abs((a[i] - baseA[0]) - (b[i] - baseB[0])),
      Math.abs((a[i + 1] - baseA[1]) - (b[i + 1] - baseB[1])),
      Math.abs((a[i + 2] - baseA[2]) - (b[i + 2] - baseB[2])));
    sum += d; if (d > 12) changed++;
  }
  return { mean: sum / (320 * 90), changed };
};
const inkPixels = rgb => {
  const base = rgb.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
  let count = 0;
  for (let i = 320 * 90 * 3; i < rgb.length; i += 3) {
    if (Math.max(Math.abs(rgb[i] - base[0]), Math.abs(rgb[i + 1] - base[1]),
      Math.abs(rgb[i + 2] - base[2])) > 35) count++;
  }
  return count;
};
const result = { variant, rows: [], launchError: null };
try {
  const shell = path.join(repo, 'apps/shell');
  session = await launch({ shellDir: shell, electron: path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), project, port, isoDir });
  await evalOn(session.cdp, `(()=>{const d=window.theia.container._bindingDictionary;const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.findProjectLocation==='function');void window.theia.container.get(K).open(${JSON.stringify(editUri)});return true})()`);
  await waitEval(session.cdp, `Boolean(document.querySelector('.akari-annotations-widget'))`, { timeoutMs: 180000, label: 'timeline' });
  for (let i = 0; i < 25; i++) { await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time: .3 })); await sleep(1000); if ((await listTargets(port)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break; }
  view = await attach();
  await session.cdp.send('Page.bringToFront').catch(() => {});
  await session.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await session.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await view.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const capture = async (time, name, rowId) => {
    await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time }));
    const deadline = Date.now() + 30000;
    let lastSeek = Date.now();
    let found = false;
    while (Date.now() < deadline) {
      const ready = await evalOn(view, `(()=>{const row=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(${JSON.stringify(`caption-plate-${rowId}`)}));return !!row&&getComputedStyle(row).display!=='none'})()`, context).catch(() => false);
      if (ready) { found = true; break; }
      if (Date.now() - lastSeek > 1000) {
        await evalOn(session.cdp, command('akari.preview.seekOutput', { editUri, time })).catch(() => {});
        lastSeek = Date.now();
      }
      await sleep(200);
    }
    if (!found) throw new Error(`caption ${rowId} at ${time}s not visible`);
    await sleep(200);
    const box = await evalOn(view, `(()=>{const r=document.querySelector('#preview-stage')?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`, context);
    if (!box) throw new Error('stage missing');
    const frame = await evalOn(session.cdp, `(()=>{const r=[...document.querySelectorAll('iframe')].map(e=>e.getBoundingClientRect()).sort((a,b)=>b.width*b.height-a.width*a.height)[0];return r&&{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    if (!frame) throw new Error('preview frame missing');
    const sx = frame.width / box.viewportWidth, sy = frame.height / box.viewportHeight;
    const clip = { x: frame.x + box.x * sx, y: frame.y + box.y * sy, width: box.width * sx, height: box.height * sy, scale: 1 };
    const { data } = await session.cdp.send('Page.captureScreenshot', { format: 'png', clip });
    const png = Buffer.from(data, 'base64');
    if (name) await writeFile(path.join(recordsDir, name), png);
    return raw(png);
  };
  for (const [index, row] of manifest.rows.entries()) {
    const checks = [];
    for (const slot of Object.keys(row.animation)) {
      const offset = { in: .3, loop: 1.5, out: 2.7 }[slot];
      try {
        const animated = await capture(index * 6 + offset, manifest.chunkStart === 0 && index === 0 ? 'owner-glitch-10.png' : undefined, `c-${index}-0`);
        const control = await capture(index * 6 + 3 + offset, manifest.chunkStart === 0 && index === 0 ? 'owner-glitch-control-10.png' : undefined, `c-${index}-1`);
        const pixels = compare(animated, control);
        checks.push({ slot, offset, ...pixels, pass: pixels.changed > 20 && pixels.mean > .08 });
      } catch (error) {
        checks.push({ slot, offset, pass: false, reason: safe(error?.message || error) });
      }
    }
    const neutral = neutralCheck(row);
    let neutralResult = neutral;
    let richHalf;
    let neutralDom;
    try {
      if (row.key === 'rich:typewriter') {
        const half = await capture(index * 6 + .7, `rich-typewriter-preview-${variant}-50.png`, `c-${index}-0`);
        const dom = await evalOn(view, `(()=>{const row=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(${JSON.stringify(`caption-plate-c-${index}-0`)}));const chars=[...row.querySelectorAll('.akari-caption__type-char')];return{total:chars.length,visible:chars.filter(e=>Number(getComputedStyle(e).opacity)>.95).length,layers:chars.map(e=>({shadow:e.querySelectorAll('.akari-caption__rich-shadow').length,stroke:e.querySelectorAll('.akari-caption__rich-stroke').length,fill:e.querySelectorAll('.akari-caption__rich-fill').length}))}})()`, context);
        const full = await capture(index * 6 + 1.5, `rich-typewriter-preview-${variant}-final.png`, `c-${index}-0`);
        const still = await capture(index * 6 + 4.5, `rich-typewriter-preview-${variant}-control-final.png`, `c-${index}-1`);
        const halfInk = inkPixels(half), fullInk = inkPixels(full);
        const ratio = fullInk ? halfInk / fullInk : null;
        richHalf = { ...dom, halfInk, fullInk, ratio,
          pass: dom.total > 0 && Math.abs(dom.visible - dom.total / 2) <= 1
            && dom.layers.every(layer => layer.shadow === 1 && layer.stroke === 2 && layer.fill === 1)
            && ratio !== null && ratio >= .3 && ratio <= .7 };
        neutralResult = { ...neutral, ...compare(full, still) };
      } else if (neutral.included) {
        const final = await capture(index * 6 + neutral.offset,
          row.key === 'combo:typewriter' ? `combo-typewriter-preview-${variant}-final.png` : undefined, `c-${index}-0`);
        if (row.key === 'combo:typewriter') neutralDom = await evalOn(view, `(()=>{const row=[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(${JSON.stringify(`caption-plate-c-${index}-0`)}));const plate=row?.querySelector('.akari-caption__plate');const chars=[...plate.querySelectorAll('.akari-caption__type-char')];return{plateAnimation:plate.style.animation,plateOpacity:getComputedStyle(plate).opacity,chars:chars.map(e=>getComputedStyle(e).opacity),animations:row.getAnimations({subtree:true}).map(a=>({name:a.animationName,time:a.currentTime}))}})()`, context);
        const still = await capture(index * 6 + 3 + neutral.offset,
          row.key === 'combo:typewriter' ? `combo-typewriter-preview-${variant}-control-final.png` : undefined, `c-${index}-1`);
        neutralResult = { ...neutral, ...compare(final, still) };
      }
      if (neutralResult.included) neutralResult.pass = neutralPass(neutralResult);
    } catch (error) {
      neutralResult = { ...neutral, pass: false, reason: safe(error?.message || error) };
    }
    const item = { key: row.key, checks, neutral: neutralResult,
      ...(richHalf ? { richHalf } : {}),
      ...(neutralDom ? { neutralDom } : {}),
      pass: checks.every(check => check.pass) && (!neutralResult.included || neutralResult.pass)
        && (!richHalf || richHalf.pass) };
    result.rows.push(item);
    await writeFile(path.join(recordsDir, resultName), JSON.stringify(result, null, 2) + '\n');
  }
  if (manifest.chunkStart === 0 && manifest.rows[1]?.key === 'owner:typewriter') {
    if (variant === 'legacy') await capture(6.7, 'typewriter-preview-50.png', 'c-1-0');
    const final = await capture(7.7, variant === 'legacy' ? 'typewriter-preview-final.png' : undefined, 'c-1-0');
    const control = await capture(10.7, variant === 'legacy' ? 'typewriter-preview-control-final.png' : undefined, 'c-1-1');
    const delta = compare(final, control);
    result.typewriterFinal = { ...delta, pass: delta.changed <= 30 && delta.mean <= .7 };
    if (!result.typewriterFinal.pass) process.exitCode = 1;
  }
} catch (error) {
  result.launchError = safe(error?.message || error);
  process.exitCode = 1;
} finally {
  view?.close();
  await stopOwnedElectron(session, { project, isoDir, repo });
  await writeFile(path.join(recordsDir, resultName), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ variant, rows: result.rows.length, passes: result.rows.filter(row => row.pass).length, error: result.launchError }));
}
if (result.rows.some(row => !row.pass)) process.exitCode = 1;
