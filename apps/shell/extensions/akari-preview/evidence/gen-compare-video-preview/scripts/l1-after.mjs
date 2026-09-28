#!/usr/bin/env node
// 手順 3（AFTER）: 動画の候補を押すと、出力プレビューのその枠に候補が仮に入って見える（音も出る）。edit.json・undo 履歴は変わらない。
//   node l1-after.mjs [--port=9658] [--keep-tmp]
// 開発ビルドの Electron + ローカルのスタブ fal（h3 = 赤・440Hz・2 秒 / kling = 緑・660Hz・3 秒 / seedance = 青・880Hz・6 秒）+ 偽の鍵。
// 枠 clip-frame は 3〜7 秒（4 秒）。前のクリップ clip-video は 0〜3 秒（testsrc2）。
//   (i) 候補 A（kling）→ 枠が緑で再生 (ii) 候補 B（seedance）→ 青に入れ替わる (iii) 前のクリップとまたいで再生・シーク
//   (iv) 音（sidecar の audio が鳴る・音量） (v) もう一度押す / 枠の選択を外す → 空の枠 (vi) この案を使う → undo 1 回で空の枠
//   (vii) 仮表示の間 edit.json のハッシュと undo 履歴の長さが不変。短い候補（h3・2 秒）は最後のコマで止まる
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn } from './cdp-lib.mjs';
import { cleanupIso, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PROFILES, S, sha, startStubFal, stopElectron, writeAppModels } from './l1-common.mjs';
import { candidateRows, FRAME, hue, makeThreeCandidates, openPreview, PANEL, previewColor, probeExpression } from './l1-flow.mjs';

const iso = await makeIso('after');
const ctx = makeResults('after', iso, 'results-after.json');
const { results, clean, save } = ctx;
const [H3, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, preview, project, h;
const editPath = () => path.join(project, 'edit.json');
const editSha = async () => sha(await readFile(editPath()));
const readEdit = async () => JSON.parse(await readFile(editPath(), 'utf8'));
const frameItem = doc => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === FRAME);
const history = () => evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
  const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getWidgets==='function'&&typeof k.prototype?.getOrCreateWidget==='function');
  const w=K&&c.get(K).getWidgets('akari-inspector-widget')[0];const s=w?.history;return s?{past:s.past?.length??null,future:s.future?.length??null,canUndo:s.canUndo}:null})()`);

// webview の中の候補の仮表示（video + sidecar の audio）
const candidateState = `(()=>{const tail=s=>String(s||'').replace(/^.*\\//,'').slice(-72);const root=document.documentElement.dataset;
  const v=document.querySelector('video[data-akari-video-candidate-preview]');const a=document.querySelector('audio[data-akari-video-candidate-sidecar]');
  const vis=e=>{if(!e)return false;const cs=getComputedStyle(e),r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&r.width>0&&r.height>0};
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
  const orig=document.getElementById('preview-video');const still=[...document.querySelectorAll('img')].filter(vis).sort((x,y)=>y.width*y.height-x.width*x.height)[0];
  return{marker:root.akariVideoCandidatePreview??null,relativePath:root.akariVideoCandidateRelativePath??null,
    video:v?{item:v.dataset.akariVideoCandidatePreview,path:v.dataset.akariVideoCandidateRelativePath,src:tail(v.currentSrc),currentTime:Number(v.currentTime.toFixed(3)),
      paused:v.paused,muted:v.muted,readyState:v.readyState,w:v.videoWidth,h:v.videoHeight,duration:v.duration,visible:vis(v),box:box(v)}:null,
    audio:a?{src:tail(a.currentSrc),currentTime:Number(a.currentTime.toFixed(3)),paused:a.paused,muted:a.muted,volume:a.volume,readyState:a.readyState,
      decodedBytes:a.webkitAudioDecodedByteCount??null,duration:a.duration}:null,
    stageBox:box(document.getElementById('overlay-stage')),stillBox:box(still),originalBox:vis(orig)?box(orig):null,
    overlayText:[...document.querySelectorAll('body *')].filter(e=>e.children.length===0&&/動画予定/.test(e.textContent||'')&&vis(e)).map(e=>e.textContent.trim())}})()`;
// sidecar の audio の実際の音量（captureStream → AnalyserNode。出力の経路は変えない）
const audioLevel = `(async()=>{const a=document.querySelector('audio[data-akari-video-candidate-sidecar]');if(!a)return{error:'no audio'};
  try{const s=a.captureStream?a.captureStream():a.mozCaptureStream();const ctx=new AudioContext();await ctx.resume();const src=ctx.createMediaStreamSource(s);const an=ctx.createAnalyser();an.fftSize=2048;src.connect(an);
    const buf=new Float32Array(an.fftSize);const freq=new Float32Array(an.frequencyBinCount);let peak=0,sum=0,n=0,bestBin=0,best=-Infinity;
    for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,60));an.getFloatTimeDomainData(buf);for(const x of buf){peak=Math.max(peak,Math.abs(x));sum+=x*x;n++}
      an.getFloatFrequencyData(freq);for(let b=1;b<freq.length;b++)if(freq[b]>best){best=freq[b];bestBin=b}}
    const hz=Math.round(bestBin*ctx.sampleRate/an.fftSize);src.disconnect();await ctx.close();
    return{peak:Number(peak.toFixed(4)),rms:Number(Math.sqrt(sum/n).toFixed(4)),dominantHz:hz,tracks:s.getAudioTracks().length}}catch(e){return{error:String(e)}}})()`;

async function waitCandidate(pathPart, name) {
  const until = Date.now() + 120_000;
  let last;
  while (Date.now() < until) {
    last = await preview.pv(candidateState).catch(() => null);
    if (pathPart === null ? last && !last.marker && !last.video : last?.marker === FRAME && last.video?.path?.includes(pathPart) && last.video.readyState >= 2) return last;
    await sleep(300);
  }
  throw new Error(`Timed out: ${name} ${JSON.stringify(last)}`);
}
async function colorAt(time) {
  await preview.pause().catch(() => undefined);
  await preview.seek(time);
  await sleep(900);
  const color = await previewColor(cdp, preview, iso);
  return { time, color, hue: hue(color), state: await preview.pv(candidateState) };
}
async function playFor(ms, from) {
  if (from !== undefined) { await preview.seek(from); await sleep(700); }
  await preview.play();
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(350);
    const color = await previewColor(cdp, preview, iso).catch(() => [0, 0, 0]);
    samples.push({ atMs: Date.now() - t0, hue: hue(color), color, state: await preview.pv(candidateState) });
  }
  return samples;
}
async function pick(row) {
  await h.click(`${PANEL} [data-akari-inspector-video-candidate="${row.path}"]`);
  await sleep(400);
}
const selectedFrame = `document.querySelector('[data-akari-ui="timeline:cut:1"]')?.classList.contains('akari-annotations-selected')`;

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.observations.stubModels = PROFILES.map(({ model, color, toneHz, durationSec }) => ({ model, color, toneHz, durationSec }));
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);
  results.step = 'generate three';
  await openFrameGeneration(h, cdp);
  const originalSha = await editSha();
  const original = await readEdit();
  const candidates = await makeThreeCandidates(h, cdp, [KLING, SEEDANCE]);
  results.observations.candidates = candidates;
  const byModel = m => candidates.find(c => c.path.includes(m.replace(/^fal:/u, '').replace(/\./gu, '-')));
  const [red, green, blue] = [byModel(H3), byModel(KLING), byModel(SEEDANCE)];
  await h.check('3 案ができた（候補の時点で edit.json 不変）', candidates.length === 3 && red && green && blue && (await editSha()) === originalSha, candidates.map(c => c.path));
  preview = await openPreview(h, cdp, project);
  const shaTrail = [];
  const historyTrail = [];
  const mark = async label => { shaTrail.push({ label, same: (await editSha()) === originalSha }); historyTrail.push({ label, ...(await history()) }); await save(); };
  await mark('start');
  const empty = await colorAt(4.5);
  results.observations.emptyFrame = empty;
  await h.shot('00-after-empty-frame-before-pick.png');

  // (i) 候補 A = kling（緑）
  results.step = '(i) pick A';
  await pick(green);
  const a = await waitCandidate('kling', 'candidate A in preview');
  const aStill = await colorAt(4.5);
  const aPlay = await playFor(1800, 3.2);
  await preview.pause();
  const aTimes = aPlay.map(s => s.state?.video?.currentTime ?? null);
  results.observations.pickA = { state: a, still: aStill, play: aPlay };
  await mark('picked A');
  await h.check('(i) 候補 A（kling）を押すと出力プレビューの枠が緑（止めて 4.5 秒）', aStill.hue === 'green' && aStill.state.marker === FRAME && !aStill.state.overlayText.length,
    { color: aStill.color, marker: aStill.state.marker, relativePath: aStill.state.relativePath, overlayText: aStill.state.overlayText, currentTime: aStill.state.video?.currentTime });
  await h.check('(i) 再生すると候補の currentTime が進み、枠は緑のまま', aPlay.filter(s => s.hue === 'green').length >= 2 && Math.max(...aTimes.filter(Number.isFinite)) - Math.min(...aTimes.filter(Number.isFinite)) > 0.5,
    aPlay.map(s => ({ atMs: s.atMs, hue: s.hue, t: s.state?.video?.currentTime, paused: s.state?.video?.paused })));
  await h.check('(i) 候補の映像は枠の位置・大きさ（元の要素と同じ矩形）', aStill.state.video?.visible && aStill.state.video.box && aStill.state.stageBox
    && aStill.state.video.box.w > 0 && (!aStill.state.stillBox || Math.abs(aStill.state.video.box.w - aStill.state.stillBox.w) <= 4), { video: aStill.state.video?.box, still: aStill.state.stillBox, stage: aStill.state.stageBox });
  await colorAt(4.5);
  await h.shot('01-after-pick-A-green-in-preview.png');

  // (ii) 候補 B = seedance（青・6 秒 = 枠より長い → 頭の 4 秒）
  results.step = '(ii) pick B';
  await pick(blue);
  const b = await waitCandidate('seedance', 'candidate B in preview');
  const bStill = await colorAt(6.5);
  results.observations.pickB = { state: b, still: bStill };
  await mark('picked B');
  await h.check('(ii) 候補 B（seedance）を押すと青に入れ替わる（緑の候補の video は残らない）', bStill.hue === 'blue' && bStill.state.relativePath === blue.path,
    { color: bStill.color, relativePath: bStill.state.relativePath, videoPath: bStill.state.video?.path });
  await h.check('(ii) 長い候補は枠の中の時刻どおり（6.5 秒 = 枠内 3.5 秒）', Math.abs((bStill.state.video?.currentTime ?? -1) - 3.5) < 0.1, bStill.state.video);
  await h.shot('02-after-pick-B-blue-in-preview.png');

  // (iii)(iv) 前のクリップからまたいで再生 → 枠で候補の音が鳴る → 途中へシーク
  results.step = '(iii) cross play';
  // ページ内で 100ms ごとに記録する（スクリーンショットの採色は負荷の高い時間帯に 1 回数秒かかり、またぎを取りこぼすため）
  await preview.seek(1.0); await sleep(700);
  await preview.pv(`(()=>{clearInterval(window.__gcvpRec);window.__gcvpLog=[];const t0=performance.now();window.__gcvpRec=setInterval(()=>{
    const v=document.querySelector('video[data-akari-video-candidate-preview]');const a=document.querySelector('audio[data-akari-video-candidate-sidecar]');const o=document.getElementById('preview-video');
    const vis=e=>{if(!e)return false;const cs=getComputedStyle(e),r=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0};
    window.__gcvpLog.push({ms:Math.round(performance.now()-t0),candVisible:vis(v),candT:v?Number(v.currentTime.toFixed(3)):null,candPaused:v?.paused??null,
      audioT:a?Number(a.currentTime.toFixed(3)):null,audioPaused:a?.paused??null,audioMuted:a?.muted??null,mainVisible:vis(o),mainT:o?Number(o.currentTime.toFixed(3)):null,mainPaused:o?.paused??null,
      otherPlaying:[...document.querySelectorAll('video')].filter(x=>!x.dataset.akariVideoCandidatePreview&&!x.paused).map(x=>({id:x.id||x.dataset.akariLayerId||null,t:Number(x.currentTime.toFixed(3))}))})},100);return true})()`);
  const cross = await playFor(3500);
  const crossLog = await preview.pv(`(()=>{clearInterval(window.__gcvpRec);return window.__gcvpLog})()`);
  const levelWhilePlaying = await preview.pv(audioLevel).catch(error => ({ error: String(error) }));
  const inFrame = await preview.pv(candidateState);
  await preview.pause();
  results.observations.crossLog = crossLog;
  results.observations.cross = { samples: cross.map(s => ({ atMs: s.atMs, hue: s.hue, color: s.color, video: s.state?.video && { t: s.state.video.currentTime, paused: s.state.video.paused, visible: s.state.video.visible },
    audio: s.state?.audio && { t: s.state.audio.currentTime, paused: s.state.audio.paused, muted: s.state.audio.muted } })), inFrame, level: levelWhilePlaying };
  const enter = crossLog.findIndex(r => r.candVisible);
  const before = crossLog.slice(0, Math.max(enter, 0));
  const after = enter >= 0 ? crossLog.slice(enter) : [];
  const crossSummary = { entries: crossLog.length, enterAtMs: crossLog[enter]?.ms ?? null,
    beforeFrame: { n: before.length, candVisible: before.filter(r => r.candVisible).length, mainT: [before[0]?.mainT, before.at(-1)?.mainT], otherPlaying: before.filter(r => r.otherPlaying?.length).length },
    inFrame: { n: after.length, candT: [after[0]?.candT, after.at(-1)?.candT], candPlaying: after.filter(r => r.candPaused === false).length, audioPlaying: after.filter(r => r.audioPaused === false && r.audioMuted === false).length },
    lastColor: cross.at(-1)?.color };
  results.observations.crossSummary = crossSummary;
  await h.check('(iii) 前のクリップ（1.0 秒〜）から再生すると、前のクリップの間は候補を出さず、3 秒で枠に入ると候補（青）が頭から再生される',
    // 1.0 秒から再生して 3.0 秒で枠に入る = 再生の時計が前のクリップを約 2 秒進んでから候補が出る
    before.length >= 5 && before.every(r => !r.candVisible) && crossLog[enter].ms >= 1500 && crossLog[enter].ms <= 2800
    && after.length >= 5 && (after[0].candT ?? 9) < 0.4 && (after.at(-1).candT ?? 0) - (after[0].candT ?? 0) > 0.5 && cross.at(-1)?.hue === 'blue', crossSummary);
  const audioOk = inFrame.audio && !inFrame.audio.paused && !inFrame.audio.muted && inFrame.audio.currentTime > 0.3 && inFrame.audio.readyState >= 2;
  await h.check('(iv) 枠の中で候補の音（FLAC sidecar の audio）が鳴っている: paused=false・muted=false・currentTime が映像と揃う',
    audioOk && Math.abs(inFrame.audio.currentTime - inFrame.video.currentTime) < 0.25, { audio: inFrame.audio, video: inFrame.video && { t: inFrame.video.currentTime, paused: inFrame.video.paused } });
  await h.check('(iv) 音量: 実際に音が出ている（peak > 0.01）・主な周波数が seedance の 880Hz 付近', levelWhilePlaying.peak > 0.01 && Math.abs(levelWhilePlaying.dominantHz - 880) < 60, levelWhilePlaying);
  const seekBack = await colorAt(1.0);
  const seekInto = await colorAt(5.0);
  results.observations.seek = { back: seekBack, into: seekInto };
  await h.check('(iii) シーク: 前のクリップ（1.0 秒）では候補を出さず、枠の途中（5.0 秒）では青・候補の時刻 2.0 秒', seekBack.hue !== 'blue' && !seekBack.state.video?.visible
    && seekInto.hue === 'blue' && Math.abs((seekInto.state.video?.currentTime ?? -1) - 2.0) < 0.1, { back: { color: seekBack.color, visible: seekBack.state.video?.visible }, into: { color: seekInto.color, t: seekInto.state.video?.currentTime } });
  await h.shot('03-after-cross-play-seek-into-frame.png');
  await mark('played B');

  // 短い候補 = h3（赤・2 秒）→ 枠の後半は最後のコマで止まる
  results.step = 'short candidate';
  await pick(red);
  await waitCandidate('h3', 'candidate C in preview');
  const shortEarly = await colorAt(3.8);
  const shortLate = await colorAt(6.5);
  results.observations.short = { early: shortEarly, late: shortLate };
  await h.check('短い候補（h3・2 秒）: 枠の後半（6.5 秒）も赤のまま・候補は最後のコマ（< 2 秒）で止まる', shortEarly.hue === 'red' && shortLate.hue === 'red'
    && shortLate.state.video.currentTime > 1.8 && shortLate.state.video.currentTime < 2.0, { early: shortEarly.state.video?.currentTime, late: shortLate.state.video?.currentTime, colors: [shortEarly.color, shortLate.color] });
  await h.shot('04-after-short-candidate-freeze-last-frame.png');
  await mark('picked short');

  // (v) もう一度押す → 空の枠 / 押し直して枠の選択を外す → 空の枠
  results.step = '(v) clear';
  await pick(red);
  const clearedByRepick = await waitCandidate(null, 'cleared by repick');
  const repickColor = await colorAt(4.5);
  results.observations.clearRepick = { state: clearedByRepick, color: repickColor.color, rows: await evalOn(cdp, candidateRows) };
  await h.check('(v) 同じ候補をもう一度押すと仮表示が終わり空の枠（オーロラ・「動画予定」の札）に戻る', !repickColor.state.marker && !repickColor.state.video && repickColor.hue === empty.hue
    && repickColor.state.overlayText.length > 0, { color: repickColor.color, emptyColor: empty.color, overlayText: repickColor.state.overlayText });
  await h.shot('05-after-repick-back-to-empty-frame.png');
  await pick(green);
  await waitCandidate('kling', 'candidate A again');
  await h.clickUntil('[data-akari-ui="timeline:cut:0"]', `document.querySelector('[data-akari-ui="timeline:cut:0"]')?.classList.contains('akari-annotations-selected')`, 'select other clip');
  const clearedBySelection = await waitCandidate(null, 'cleared by selection change');
  const selColor = await colorAt(4.5);
  results.observations.clearSelection = { state: clearedBySelection, color: selColor.color };
  await h.check('(v) 枠の選択を外す（前のクリップを選ぶ）と空の枠に戻る', !selColor.state.marker && selColor.hue === empty.hue && selColor.state.overlayText.length > 0, { color: selColor.color, overlayText: selColor.state.overlayText });
  await h.shot('06-after-deselect-back-to-empty-frame.png');
  await mark('cleared');
  await h.check('(vii) 仮表示の間（押す・入れ替え・再生・シーク・解除）edit.json のハッシュが不変', shaTrail.every(r => r.same), shaTrail);
  await h.check('(vii) 仮表示の間 undo 履歴の長さが不変', historyTrail.every(r => r.past === historyTrail[0].past && r.future === historyTrail[0].future) && historyTrail[0].past !== null, historyTrail);

  // (vi) この案を使う → 確定後もプレビューが正しい → undo 1 回で空の枠
  results.step = '(vi) adopt';
  await h.clickUntil('[data-akari-ui="timeline:cut:1"]', selectedFrame, 'select frame');
  if (!await evalOn(cdp, `Boolean(document.querySelector(${S(PANEL)}))`)) {
    await h.waitEval(`Boolean(document.querySelector('[data-akari-inspector-ai-tile="video"]'))`, 'video tile', 60_000);
    await h.clickUntil('[data-akari-inspector-ai-tile="video"]', `Boolean(document.querySelector(${S(PANEL)}))`, 'video panel');
  }
  await h.waitEval(`document.querySelectorAll('${PANEL} [data-akari-inspector-video-candidate]').length>=3`, 'candidates after reselect', 60_000);
  await pick(green);
  await waitCandidate('kling', 'candidate A before adopt');
  const beforeAdoptHistory = await history();
  await h.click(`${PANEL} [data-akari-inspector-video-adopt]`);
  const adoptUntil = Date.now() + 120_000;
  let adopted;
  while (Date.now() < adoptUntil) { adopted = await readEdit(); if (frameItem(adopted)?.source?.src !== 'src-start') break; await sleep(250); }
  const afterAdoptProbe = await waitCandidate(null, 'preview candidate cleared after adopt');
  // 確定した edit でプレビューが組み直されるのを待ってから色を見る
  let adoptColor;
  for (let i = 0; i < 40; i++) { adoptColor = await colorAt(4.5); if (adoptColor.hue === 'green') break; await sleep(500); }
  const adoptProbe = await preview.pv(probeExpression);
  results.observations.adopt = { item: frameItem(adopted), color: adoptColor.color, candidateState: afterAdoptProbe, probe: adoptProbe, historyBefore: beforeAdoptHistory, historyAfter: await history() };
  await h.check('(vi) 「この案を使う」で枠が候補に確定し、仮表示は終わり、プレビューは確定した素材で緑', frameItem(adopted)?.source?.src === `gen-${FRAME}-video`
    && !afterAdoptProbe.marker && adoptColor.hue === 'green', { src: frameItem(adopted)?.source, color: adoptColor.color });
  await h.check('(vi) 採用は undo 履歴 1 手', results.observations.adopt.historyAfter.past === beforeAdoptHistory.past + 1, { before: beforeAdoptHistory, after: results.observations.adopt.historyAfter });
  await h.shot('07-after-adopt-green-committed.png');
  await h.exec('akari.timeline.undo');
  const undoUntil = Date.now() + 120_000;
  let undone;
  while (Date.now() < undoUntil) { undone = await readEdit(); if (frameItem(undone)?.source?.src === 'src-start') break; await sleep(250); }
  let undoColor;
  for (let i = 0; i < 40; i++) { undoColor = await colorAt(4.5); if (undoColor.hue === empty.hue && undoColor.state.overlayText.length) break; await sleep(500); }
  results.observations.undo = { item: frameItem(undone), sameAsOriginalJson: JSON.stringify(undone) === JSON.stringify(original), sha: await editSha(), color: undoColor.color, overlayText: undoColor.state.overlayText };
  await h.check('(vi) undo 1 回で edit.json が元と完全一致・プレビューは空の枠', results.observations.undo.sameAsOriginalJson && undoColor.hue === empty.hue && undoColor.state.overlayText.length > 0,
    results.observations.undo);
  await h.shot('08-after-one-undo-empty-frame.png');

  results.observations.shaTrail = shaTrail;
  results.observations.historyTrail = historyTrail;
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('zz-after-failure.png').catch(() => undefined);
} finally {
  if (stub) results.observations.stubEvents = stub.events.map(e => ({ kind: e.kind, model: e.model, auth: e.auth }));
  await save();
  preview?.close();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
