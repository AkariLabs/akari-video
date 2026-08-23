#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, connectPreview, evalOn } from '../preview-writeback-v2/scripts/lib.mjs';

const [portText, projectDir, referencePath, kind, outputPath] = process.argv.slice(2);
if (!portText || !projectDir || !kind || !outputPath) {
  throw new Error('usage: run-l1.mjs <port> <project> <reference-or-dash> <kind> <result-json>');
}
const port = Number(portText);
const editUri = `file://${path.join(projectDir, 'edit.json')}`;
const fnv = bytes => {
  let value = 0x811c9dc5;
  for (const byte of bytes) { value ^= byte; value = Math.imul(value, 0x01000193); }
  return (value >>> 0).toString(16).padStart(8, '0');
};
const decode = base64 => Buffer.from(base64, 'base64');
const expectedFrame = referencePath && referencePath !== '-' ? (() => {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', referencePath,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
})() : null;

const main = await connectMain(port);
let preview;
try {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (await evalOn(main, '!!(window.theia && window.theia.container)')) break;
    await sleep(500);
  }
  const opened = await evalOn(main, `(() => {
    const bindings = window.theia.container._bindingDictionary;
    const klass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function');
    const commands = window.theia.container.get(klass);
    void commands.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify(editUri)} });
    return true;
  })()`);
  assert.equal(opened, true);
  preview = await connectPreview(port, 30);
  const ev = expression => evalOn(preview.cdp, expression, preview.contextId);
  await evalOn(main, `(() => {
    const bindings = window.theia.container._bindingDictionary;
    const klass = [...bindings._map.keys()].find(key => typeof key === 'function'
      && typeof key.prototype?.executeCommand === 'function');
    const commands = window.theia.container.get(klass);
    void commands.executeCommand('akari.preview.seekOutput', { editUri: ${JSON.stringify(editUri)}, time: 1 });
    return true;
  })()`);
  let state;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    state = await ev(`(() => ({
      t: Number(document.getElementById('seek')?.value || 0),
      rails: window.akari?.videoFx?.inspect?.() || [],
      railCount: document.querySelectorAll('canvas.akari-video-fx-rail').length,
      badge: document.getElementById('indicator-popup')?.textContent || '',
      videoReady: document.getElementById('preview-video')?.readyState || 0
    }))()`);
    const ready = kind === 'inert'
      ? state.videoReady >= 2 && state.railCount === 0
      : state.rails.some(rail => rail.status === 'ready') && Math.abs(state.t - 1) < 0.04;
    if (ready) break;
    await sleep(125);
  }

  const first = await ev(`(() => {
    const width=320,height=180,out=document.createElement('canvas'); out.width=width; out.height=height;
    const ctx=out.getContext('2d',{willReadFrequently:true});
    const baseRail=document.querySelector('canvas[data-akari-video-fx-role="source"]');
    const base=document.getElementById('preview-video');
    if(baseRail) ctx.drawImage(baseRail,0,0,width,height); else if(base.readyState>=2) ctx.drawImage(base,0,0,width,height);
    for(const rail of document.querySelectorAll('canvas[data-akari-video-fx-role^="layer:"]')){
      if(getComputedStyle(rail).display==='none') continue;
      const style=getComputedStyle(rail), w=parseFloat(style.width), h=parseFloat(style.height);
      const left=parseFloat(style.left)-w/2, top=parseFloat(style.top)-h/2;
      ctx.globalAlpha=Number(style.opacity)||1; ctx.drawImage(rail,left,top,w,h); ctx.globalAlpha=1;
    }
    const bytes=ctx.getImageData(0,0,width,height).data;
    let binary=''; for(let i=0;i<bytes.length;i+=0x4000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x4000));
    let hash=0x811c9dc5; for(const byte of bytes){hash^=byte;hash=Math.imul(hash,0x01000193);}
    return {base64:btoa(binary),hash:(hash>>>0).toString(16).padStart(8,'0'),nonTransparent:Array.from(bytes).filter((_,i)=>i%4===3&&bytes[i]>0).length};
  })()`);

  // Seek away and back. Static source frames still exercise rail reconfiguration and external-time determinism.
  await evalOn(main, `(() => {
    const b=window.theia.container._bindingDictionary; const k=[...b._map.keys()].find(x=>typeof x==='function'&&typeof x.prototype?.executeCommand==='function');
    void window.theia.container.get(k).executeCommand('akari.preview.seekOutput',{editUri:${JSON.stringify(editUri)},time:0.25}); return true;
  })()`);
  await sleep(350);
  await evalOn(main, `(() => {
    const b=window.theia.container._bindingDictionary; const k=[...b._map.keys()].find(x=>typeof x==='function'&&typeof x.prototype?.executeCommand==='function');
    void window.theia.container.get(k).executeCommand('akari.preview.seekOutput',{editUri:${JSON.stringify(editUri)},time:1}); return true;
  })()`);
  await sleep(500);
  const returnedHash = await ev(`(() => {
    const rail=document.querySelector('canvas[data-akari-video-fx-role="source"]')
      || document.querySelector('canvas[data-akari-video-fx-role^="layer:"]');
    if(!rail) return null; const c=document.createElement('canvas');c.width=rail.width;c.height=rail.height;
    const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(rail,0,0);const d=x.getImageData(0,0,c.width,c.height).data;
    let h=0x811c9dc5;for(const b of d){h^=b;h=Math.imul(h,0x01000193);}return(h>>>0).toString(16).padStart(8,'0');
  })()`);

  let mad = null;
  const actual = decode(first.base64);
  if (expectedFrame) {
    assert.equal(actual.length, expectedFrame.length);
    let absolute = 0;
    for (let i = 0; i < actual.length; i += 4) {
      absolute += Math.abs(actual[i] - expectedFrame[i]);
      absolute += Math.abs(actual[i + 1] - expectedFrame[i + 1]);
      absolute += Math.abs(actual[i + 2] - expectedFrame[i + 2]);
    }
    mad = absolute / ((actual.length / 4) * 3 * 255);
  }
  const result = {
    status: kind === 'inert' ? (state.railCount === 0 ? 'PASS' : 'FAIL') : (mad !== null && mad <= 0.01 ? 'PASS' : 'FAIL'),
    kind,
    mad,
    previewFnv: first.hash,
    exportFnv: expectedFrame ? fnv(expectedFrame) : null,
    returnedRailFnv: returnedHash,
    railCount: state.railCount,
    rails: state.rails,
    badge: state.badge,
    nonTransparent: first.nonTransparent
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
} finally {
  preview?.cdp.close();
  main.close();
}
