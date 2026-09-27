#!/usr/bin/env node
// 手順 3（AFTER）: 0.8 秒の枠から 3 案を同時に作り、点線・札・採用後の音声を記録する。
//   node l1-after.mjs [--port=9655] [--keep-tmp]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  chipText, cleanupIso, FRAME, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PANEL, PROFILES, probePreviewAudio,
  S, startChipRecorder, startStubFal, stopChipRecorder, stopElectron, timelineState, writeAppModels
} from './l1-common.mjs';

const iso = await makeIso('after');
const ctx = makeResults('after', iso, 'results-after.json');
const { results, clean, save } = ctx;
const [H3, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, project, h;
const readEdit = async () => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const itemOf = (doc, id) => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === id);
const panelText = `(()=>{const p=document.querySelector(${S(PANEL)});if(!p)return null;const t=e=>e?.textContent.replace(/\\s+/g,' ').trim()??null;
  return{models:[...p.querySelectorAll('[data-akari-inspector-video-model]')].map(m=>({id:m.getAttribute('data-akari-inspector-video-model'),checked:!!m.querySelector('input')?.checked,text:t(m),
      duration:t(m.querySelector('[data-akari-inspector-video-model-duration]')),durationAttr:m.querySelector('[data-akari-inspector-video-model-duration]')?.getAttribute('data-akari-inspector-video-model-duration')})),
    durationNote:t(p.querySelector('[data-akari-inspector-video-duration-note]')),
    create:t(p.querySelector('[data-akari-inspector-video-create]')),
    candidates:[...p.querySelectorAll('[data-akari-inspector-video-candidate]')].map(c=>({path:c.getAttribute('data-akari-inspector-video-candidate'),text:t(c)})),
    running:!!p.querySelector('[data-akari-inspector-video-cancel]'),text:t(p).slice(0,1500)}})()`;
const sectionText = `(()=>{const s=document.querySelector('[data-akari-ui="section:inspector-generation"]');return s?s.textContent.replace(/\\s+/g,' ').trim().slice(0,2000):null})()`;
const runtimeTimeline = `(()=>{const c=window.theia?.container,d=c?._bindingDictionary;
  const K=d&&[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getWidgets==='function'&&typeof k.prototype?.revealWidget==='function');
  const shell=K&&c.get(K),w=['bottom','main'].flatMap(area=>shell?.getWidgets(area)??[]).find(x=>typeof x.reloadGenerationSidecars==='function');
  if(!w)return null;const i=w.cutItemIds?.indexOf('clip-frame')??-1,cut=w.cuts?.[i],source=cut&&w.sourceMap?.get(cut.src);
  const entry=source&&w.generationSidecars?.get(source.path),job=entry?.meta?.job;
  const chosen=source&&w.generationForPath?.(source.path);
  return{drag:!!w.dragState,renderPending:!!w.renderStripPending,cutIndex:i,cutSrc:cut?.src??null,
    sourcePath:source?.path??null,metaStatus:entry?.meta?.status??null,metaKind:entry?.meta?.kind??null,
    jobProvider:job?.provider??null,jobCompleted:job?.completed??null,jobCandidates:job?.candidates??null,
    selectedState:chosen?.state??null,selectedProvider:chosen?.meta?.job?.provider??null,
    frameCount:document.querySelectorAll('[data-akari-ui="timeline:cut:1"]').length}})()`;

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

  // (i) 作る前: 手段の行・注意・タイムラインの点線
  results.step = 'before generate';
  await setChecked(KLING, true); await setChecked(SEEDANCE, true);
  await h.settle();
  results.observations.panelBeforeGenerate = await evalOn(cdp, panelText);
  results.observations.sectionBeforeGenerate = await evalOn(cdp, sectionText);
  results.observations.timelineBeforeGenerate = await evalOn(cdp, timelineState);
  results.observations.runtimeBeforeGenerate = await evalOn(cdp, runtimeTimeline);
  await scrollTo(PANEL);
  await h.shot('00-after-panel-three-checked.png');
  const rows = results.observations.panelBeforeGenerate.models.filter(m => m.checked);
  await h.check('AFTER (i): 手段の行にモデル別の「N 秒で作ります」', rows.length === 3
    && rows.every(m => m.durationAttr === m.id && /\d+(?:\.\d+)? 秒で作ります/.test(m.duration)), rows);
  await h.check('AFTER (i): 枠 0.8 秒から最長 5 秒の注意がボタンの上にある',
    /枠 0\.8 秒 → 5 秒の動画を作ります.*残りはタイムラインに点線で出ます/.test(results.observations.panelBeforeGenerate.durationNote ?? ''),
    results.observations.panelBeforeGenerate.durationNote);
  const before = results.observations.timelineBeforeGenerate;
  await h.check('AFTER (i): 作る前の点線は枠の右から次の item に重なり、表示専用',
    before.overhang.some(o => o.attr === 'true' && o.rect.left >= before.frame.right - 2
      && o.rect.right > before.next.left && /5 秒で作ります/.test(o.text)
      && o.pointerEvents === 'none' && /dashed|dotted/.test(o.border)), before);

  // (ii) 3 案同時: 札の 0/3 → 1/3 → 2/3 → 候補 3 を連続記録
  results.step = 'generate three';
  await evalOn(cdp, startChipRecorder);
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await clickDialogButton('費用承認する');
  const seen = new Set();
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    const s = await evalOn(cdp, panelText).catch(() => null);
    const chip = await evalOn(cdp, chipText).catch(() => null);
    for (const [label, filename] of [
      ['3 案作成中 · 0/3', '01-after-chip-0-of-3.png'],
      ['3 案作成中 · 1/3', '02-after-chip-1-of-3.png'],
      ['3 案作成中 · 2/3', '03-after-chip-2-of-3.png']
    ]) if (chip === label && !seen.has(label)) {
      seen.add(label);
      results.observations[`timeline${seen.size}Of3`] = await evalOn(cdp, timelineState);
      results.observations[`runtime${seen.size}Of3`] = await evalOn(cdp, runtimeTimeline);
      await h.shot(filename);
    }
    if (s && s.candidates.length >= 3 && !s.running) break;
    await sleep(300);
  }
  await sleep(1500);
  results.observations.chipSequence = await evalOn(cdp, stopChipRecorder);
  results.observations.submits = stub.events.filter(e => e.kind === 'submit').map(e => ({ model: e.model, auth: e.auth }));
  results.observations.timelineCandidatesComplete = await evalOn(cdp, timelineState);
  results.observations.runtimeCandidatesComplete = await evalOn(cdp, runtimeTimeline);
  await h.shot('04-after-candidates-complete.png');
  const chips = results.observations.chipSequence.map(c => c.text);
  const sequence = ['3 案作成中 · 0/3', '3 案作成中 · 1/3', '3 案作成中 · 2/3', '候補 3'];
  let position = -1;
  const ordered = sequence.every(label => (position = chips.findIndex((chip, index) => index > position && chip === label)) >= 0);
  await h.check('AFTER (ii): 同時生成の札が 0/3 → 1/3 → 2/3 → 候補 3', ordered, chips);
  await h.check('AFTER (ii): 生成中に秒数の札へ戻らない',
    !chips.some(chip => /^生成中(?: · \d+ 秒| \d+%)/.test(chip ?? '')), chips);
  await h.check('AFTER (ii): 3 段階のスクリーンショットとスタブ受信',
    seen.size === 3 && stub.events.filter(e => e.kind === 'submit').length === 3
      && stub.events.filter(e => e.kind === 'submit').every(e => e.auth),
    { seen: [...seen], submits: results.observations.submits });
  const during = [1, 2, 3].map(index => results.observations[`timeline${index}Of3`]);
  await h.check('AFTER (i)(ii): 生成中も 5 秒の点線を維持', during.every(t =>
    t?.overhang.some(o => o.attr === 'true' && /5 秒で作ります/.test(o.text) && o.pointerEvents === 'none')),
  during);
  results.observations.frameBeforeAdopt = itemOf(await readEdit(), FRAME);
  await h.check('AFTER (ii): 生成中も枠の edit.json は不変',
    JSON.stringify(results.observations.frameBeforeAdopt) === JSON.stringify(results.observations.originalFrame),
    results.observations.frameBeforeAdopt);

  // (iii)(iv) 採用後の実尺と音声
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
  // 負荷の高い時間帯は edit.json の再読込がタイムラインへ届くまで遅れるので、cut:1 が生成の動画になるまで最大 120 秒待ち、待った時間を記録する
  const reflectStart = Date.now();
  await h.waitEval(`[...document.querySelectorAll('[data-akari-generation-overhang]')].some(e=>/動画は/.test(e.textContent))`,
    'timeline reflects adoption', 120_000).catch(() => undefined);
  results.observations.adoptReflectMs = Date.now() - reflectStart;
  await h.settle();
  const doc = await readEdit();
  results.observations.adoptedFrame = itemOf(doc, FRAME);
  results.observations.nextItem = itemOf(doc, 'clip-next');
  results.observations.adoptedSource = doc.sources.find(s => s.id === `gen-${FRAME}-video`);
  results.observations.timelineAfterAdopt = await evalOn(cdp, timelineState);
  results.observations.runtimeAfterAdopt = await evalOn(cdp, runtimeTimeline);
  await h.shot('05-after-adopted-timeline.png');
  const after = results.observations.timelineAfterAdopt;
  await h.check('AFTER (iii): 採用後は実尺 5 秒の点線が次の item に重なる',
    after.overhang.some(o => o.attr === 'true' && /動画は 5 秒/.test(o.text)
      && o.rect.left >= after.frame.right - 2 && o.rect.right > after.next.left && o.pointerEvents === 'none'), after);
  await h.check('AFTER (iii): 枠と次の item の edit.json は不変',
    results.observations.adoptedFrame?.at === results.observations.originalFrame?.at
      && results.observations.adoptedFrame?.duration === results.observations.originalFrame?.duration
      && results.observations.adoptedFrame?.source?.out === 0.8
      && results.observations.nextItem?.at === 114, {
        frame: results.observations.adoptedFrame, next: results.observations.nextItem });
  await h.check('AFTER (iv): 採用した item は消音ではない',
    results.observations.adoptedFrame?.source?.mute !== true, results.observations.adoptedFrame?.source);

  // プレビューの音
  results.step = 'preview audio';
  results.observations.previewAudio = await probePreviewAudio(h, cdp, project);
  await h.shot('06-after-preview-after-play.png');
  await h.check('AFTER (iv): プレビューで枠の区間（3.0〜3.8 秒）の音声メーターが正', results.observations.previewAudio.inWindowFrames > 0 && results.observations.previewAudio.inWindowMaxPeak > 0.01,
    { frames: results.observations.previewAudio.inWindowFrames, maxPeak: results.observations.previewAudio.inWindowMaxPeak });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('zz-after-failure.png').catch(() => undefined);
} finally {
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
