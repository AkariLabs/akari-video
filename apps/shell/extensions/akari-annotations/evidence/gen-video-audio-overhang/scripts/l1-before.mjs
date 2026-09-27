#!/usr/bin/env node
// 手順 0（BEFORE）: 0.8 秒の枠から 3 案を同時に作り（スタブ fal は 5 秒・音声付き）、1 案を採用する。
//   node l1-before.mjs [--port=9655] [--keep-tmp]
// 記録: 手段の行（「N 秒で作ります」が無い）・音声の注記・生成中の札の推移・採用した item の mute・タイムラインの点線の有無・プレビューの音声メーター。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  chipText, cleanupIso, FRAME, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PANEL, PROFILES, probePreviewAudio,
  S, startChipRecorder, startStubFal, stopChipRecorder, stopElectron, timelineState, writeAppModels
} from './l1-common.mjs';

const iso = await makeIso('before');
const ctx = makeResults('before', iso, 'results-before.json');
const { results, clean, save } = ctx;
const [H3, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, project, h;
const readEdit = async () => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const itemOf = (doc, id) => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === id);
const panelText = `(()=>{const p=document.querySelector(${S(PANEL)});if(!p)return null;const t=e=>e?.textContent.replace(/\\s+/g,' ').trim()??null;
  return{models:[...p.querySelectorAll('[data-akari-inspector-video-model]')].map(m=>({id:m.getAttribute('data-akari-inspector-video-model'),checked:!!m.querySelector('input')?.checked,text:t(m)})),
    create:t(p.querySelector('[data-akari-inspector-video-create]')),
    candidates:[...p.querySelectorAll('[data-akari-inspector-video-candidate]')].map(c=>({path:c.getAttribute('data-akari-inspector-video-candidate'),text:t(c)})),
    running:!!p.querySelector('[data-akari-inspector-video-cancel]'),text:t(p).slice(0,1500)}})()`;
const sectionText = `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-generation"]');return s?s.textContent.replace(/\\s+/g,' ').trim().slice(0,2000):null})()`;

async function setChecked(modelId, checked) {
  const sel = `${PANEL} [data-akari-inspector-video-model-check="${modelId}"]`;
  if (await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});return e?e.checked:null})()`) === null)
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return true})()`);
  if (await evalOn(cdp, `document.querySelector(${S(sel)})?.checked`) === checked) return;
  await h.clickUntil(sel, `document.querySelector(${S(sel)})?.checked===${checked}`, `check ${modelId} ${checked}`);
}
async function clickDialogButton(label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`, 20_000);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`![...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`, 'dialog closed', 10_000);
}
async function scrollTo(selector) {
  await evalOn(cdp, `(()=>{document.querySelector(${S(selector)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(250);
}

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.observations.stubModels = PROFILES.map(({ model, durationSec, queueMs, processingMs }) => ({ model, durationSec, audio: 'aac 440Hz', queueMs, processingMs }));
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);
  results.step = 'open';
  await openFrameGeneration(h, cdp);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  results.observations.originalFrame = itemOf(await readEdit(), FRAME);

  // 作る前: 手段の行・注記・タイムライン
  results.step = 'before generate';
  await setChecked(KLING, true); await setChecked(SEEDANCE, true);
  await h.settle();
  results.observations.panelBeforeGenerate = await evalOn(cdp, panelText);
  results.observations.sectionBeforeGenerate = await evalOn(cdp, sectionText);
  results.observations.timelineBeforeGenerate = await evalOn(cdp, timelineState);
  await scrollTo(PANEL);
  await h.shot('00-before-panel-three-checked.png');
  const rows = results.observations.panelBeforeGenerate.models.filter(m => m.checked);
  await h.check('BEFORE: チェックした手段の行に「N 秒で作ります」が無い', rows.length === 3 && rows.every(m => !/秒で作ります/.test(m.text)), rows.map(m => m.text));
  await h.check('BEFORE: 作る前のタイムラインに枠の右の点線が無い', results.observations.timelineBeforeGenerate.overhang.length === 0, results.observations.timelineBeforeGenerate.overhang);

  // 3 案同時: 札の推移
  results.step = 'generate three';
  await evalOn(cdp, startChipRecorder);
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await clickDialogButton('費用承認する');
  let shotRunning = false;
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    const s = await evalOn(cdp, panelText).catch(() => null);
    const chip = await evalOn(cdp, chipText).catch(() => null);
    if (!shotRunning && /生成中|作成中/.test(chip ?? '') && stub.events.length >= 3) {
      await sleep(4000);
      shotRunning = true;
      results.observations.timelineWhileGenerating = await evalOn(cdp, timelineState);
      await h.shot('01-before-chip-while-generating.png');
    }
    if (s && s.candidates.length >= 3 && !s.running) break;
    await sleep(300);
  }
  await sleep(1500);
  results.observations.chipSequence = await evalOn(cdp, stopChipRecorder);
  results.observations.submits = stub.events.filter(e => e.kind === 'submit').map(e => ({ model: e.model, auth: e.auth }));
  const chips = results.observations.chipSequence.map(c => c.text);
  await h.check('BEFORE: 同時生成の札が k/3（k>0）に進まない（「生成中 · N 秒」に隠れる）', !chips.some(t => /3 案作成中 · [12]\/3/.test(t ?? '')), chips);

  // 採用
  results.step = 'adopt';
  const first = (await evalOn(cdp, panelText)).candidates.find(c => c.path.includes('h3')) ?? (await evalOn(cdp, panelText)).candidates[0];
  await h.clickUntil(`${PANEL} [data-akari-inspector-video-candidate=${S(first.path)}]`,
    `document.querySelector(${S(`${PANEL} [data-akari-inspector-video-candidate=${JSON.stringify(first.path)}]`)})?.getAttribute('data-akari-inspector-video-candidate-selected')==='true'`, 'pick candidate');
  await h.click(`${PANEL} [data-akari-inspector-video-adopt]`);
  const adoptedUntil = Date.now() + 60_000;
  let adopted;
  while (Date.now() < adoptedUntil) {
    adopted = itemOf(await readEdit(), FRAME);
    if (adopted?.source?.src === `gen-${FRAME}-video`) break;
    await sleep(300);
  }
  await h.settle(); await sleep(1500);
  const doc = await readEdit();
  results.observations.adoptedFrame = itemOf(doc, FRAME);
  results.observations.nextItem = itemOf(doc, 'clip-next');
  results.observations.adoptedSource = doc.sources.find(s => s.id === `gen-${FRAME}-video`);
  results.observations.timelineAfterAdopt = await evalOn(cdp, timelineState);
  await h.shot('02-before-adopted-timeline.png');
  await h.check('BEFORE: 採用した item が mute: true（音が鳴らない）', results.observations.adoptedFrame?.source?.mute === true, results.observations.adoptedFrame?.source);
  await h.check('BEFORE: 採用後もタイムラインに本当の長さ（5 秒）の点線が無い', results.observations.timelineAfterAdopt.overhang.length === 0, results.observations.timelineAfterAdopt.overhang);

  // プレビューの音
  results.step = 'preview audio';
  results.observations.previewAudio = await probePreviewAudio(h, cdp, project);
  await h.shot('03-before-preview-after-play.png');
  await h.check('BEFORE: プレビューで枠の区間（3.0〜3.8 秒）の音声メーターが 0（消音）', results.observations.previewAudio.inWindowFrames > 0 && results.observations.previewAudio.inWindowMaxPeak < 0.01,
    { frames: results.observations.previewAudio.inWindowFrames, maxPeak: results.observations.previewAudio.inWindowMaxPeak });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('zz-before-failure.png').catch(() => undefined);
} finally {
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
