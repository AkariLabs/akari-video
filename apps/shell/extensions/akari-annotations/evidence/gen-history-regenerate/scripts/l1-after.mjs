#!/usr/bin/env node
// 手順 3（AFTER）: 作った動画の「作り方」を情報のタブで見て、前回の入力から直して作り直す。
//   node l1-after.mjs [--port=9656] [--keep-tmp]
// 開発ビルドの Electron + ローカルのスタブ fal + 偽の鍵。一時プロジェクト + 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData。
//   (i) 作った動画の item の情報のタブに作り方 (ii)「この作り方で作り直す」→ 前回の入力が入った欄
//   (iii) 指示文を直して「1 案を作り直す」→ 新しい候補が並ぶ・今の動画は不変・採用済みの候補の meta も不変
//   (iv)「この案を使う」→ 入れ替わる → undo 1 回で前の動画 (v) 静止画・ナレーションの item の情報のタブ
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  cleanupIso, helpers, REPO, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, S, sha, startStubFal, stopElectron, writeAppModels
} from './l1-common.mjs';

const iso = await makeIso('after');
const ctx = makeResults('after', iso, 'results-after.json');
const { results, clean, save } = ctx;
const FRAME = 'clip-frame';
const STILL = 'still-item';
const NARR = 'narr-frame';
const PANEL = '[data-akari-inspector-video-panel]';
const PROV = '[data-akari-generation-provenance]';
const FIRST_PROMPT = '色の板がゆっくり動く';
const NEW_PROMPT = '色の板がすばやく回る';
const STILL_PROMPT = '夕焼けの庭と木のベンチ';
const NARR_SCRIPT = '今日は庭の話をします。';
let electron, cdp, stub, project, h;
const readEdit = async () => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const editSha = async () => sha(await readFile(path.join(project, 'edit.json')));
const itemOf = (doc, id) => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === id);
const sourcePathOf = (doc, id) => doc.sources.find(s => s.id === itemOf(doc, id)?.source?.src)?.path;
const submits = () => stub.events.filter(e => e.kind === 'submit');
const ffmpeg = args => execFileSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
const PROMPT_SEL = 'textarea,input:not([type]),input[type="text"]';
const t = `e=>e?e.textContent.replace(/\\s+/g,' ').trim():null`;

const provState = `(()=>{const s=document.querySelector(${S(PROV)});if(!s)return null;const t=${t};
  return{kind:s.getAttribute('data-akari-generation-provenance'),title:t(s.querySelector('.akari-inspector-section-header')),
    rows:Object.fromEntries([...s.querySelectorAll('[data-akari-generation-provenance-row]')].map(r=>[r.getAttribute('data-akari-generation-provenance-row'),
      {label:t(r.firstElementChild),value:t(r.lastElementChild),badge:!!r.querySelector('img,svg,[class*="badge"]'),selectable:getComputedStyle(r.lastElementChild).userSelect}])),
    regenerate:t(s.querySelector('[data-akari-generation-provenance-regenerate]'))}})()`;
const panelState = `(()=>{const i=document.querySelector('[data-akari-ui="panel:inspector"]');const p=document.querySelector(${S(PANEL)});const t=${t};
  if(!i)return null;return{
    promptValues:[...i.querySelectorAll(${S(PROMPT_SEL)})].map(x=>x.value),
    current:t(i.querySelector('[data-akari-field="generation-current-video"]')),
    currentAny:(i.textContent.match(/今の動画:?[^候]{0,80}/)||[null])[0],
    camera:t(i.querySelector('[data-akari-ui="field:inspector-generation-camera"] .is-active,[data-akari-ui="field:inspector-generation-camera"] [aria-pressed="true"]')),
    duration:t(i.querySelector('[data-akari-ui="field:inspector-generation-duration"]')),
    create:t(p?.querySelector('[data-akari-inspector-video-create]')),
    checked:[...(p?.querySelectorAll('[data-akari-inspector-video-model]')??[])].filter(m=>m.querySelector('input')?.checked).map(m=>m.getAttribute('data-akari-inspector-video-model')),
    candidates:[...(p?.querySelectorAll('[data-akari-inspector-video-candidate]')??[])].map(c=>({path:c.getAttribute('data-akari-inspector-video-candidate'),
      inUse:!!c.querySelector('[data-akari-inspector-video-in-use]'),text:t(c)})),
    rows:[...(p?.querySelectorAll('[data-akari-inspector-video-progress-model]')??[])].map(r=>({model:r.getAttribute('data-akari-inspector-video-progress-model'),state:r.getAttribute('data-akari-inspector-video-progress-state')})),
    adopt:t(p?.querySelector('[data-akari-inspector-video-adopt]')),
    finalQuality:/本番の画質にする/.test(i.textContent)}})()`;
const chipText = `(()=>{const e=document.querySelector('[data-akari-ui="panel:timeline"] [data-akari-item-id="${FRAME}"]')||document.querySelector('[data-akari-ui="timeline:cut:1"]');return e?e.textContent.replace(/\\s+/g,' ').trim():null})()`;
const dialogOpen = `[...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`;

async function clickDialogButton(label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`!${dialogOpen}`, 'dialog closed', 10_000);
}
// 映像の本線の item は timeline:cut:<n>（data-akari-item-id を持たない）。音声のレーンの item は data-akari-item-id。
const CUT_INDEX = { 'clip-video': 0, 'clip-frame': 1, 'still-item': 2 };
async function selectItem(id) {
  const sel = id in CUT_INDEX ? `[data-akari-ui="timeline:cut:${CUT_INDEX[id]}"]` : `[data-akari-ui="panel:timeline"] [data-akari-item-id="${id}"]`;
  await h.clickUntil(sel, `(()=>{const e=document.querySelector(${S(sel)});return !!e&&(e.classList.contains('akari-annotations-selected')||!!e.closest('.akari-annotations-selected')||e.getAttribute('aria-selected')==='true')})()`, `select ${id}`);
  await h.settle();
}
async function openTab(id) {
  const active = `(()=>{const e=document.querySelector('[data-akari-ui="tab:inspector-${id}"]');return !!e&&e.classList.contains('is-active')})()`;
  if (!await evalOn(cdp, active)) await h.clickUntil(`[data-akari-ui="tab:inspector-${id}"]`, active, `tab ${id}`);
  await h.settle();
}
async function scrollTo(selector, block = 'center') {
  await evalOn(cdp, `(()=>{document.querySelector(${S(selector)})?.scrollIntoView({block:${S(block)},behavior:'instant'});return true})()`);
  await sleep(250);
}
async function waitAdopted(id, predicate, timeout = 180_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const doc = await readEdit().catch(() => null);
    if (doc && predicate(sourcePathOf(doc, id), doc)) return doc;
    await sleep(300);
  }
  throw new Error(`edit.json wait timeout (${id})`);
}
async function runBatch(expectedNew) {
  const start = submits().length;
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await h.waitEval(dialogOpen, 'approval dialog', 20_000);
  await clickDialogButton('費用承認する');
  const chips = [];
  const until = Date.now() + 600_000;
  while (Date.now() < until) {
    const chip = await evalOn(cdp, chipText).catch(() => null);
    if (chip && chips.at(-1) !== chip) chips.push(chip);
    const s = await evalOn(cdp, panelState).catch(() => null);
    if (submits().length - start >= 1 && s && s.rows.length && s.rows.every(r => r.state === 'done' || r.state === 'failed')
      && s.candidates.length >= expectedNew) break;
    await sleep(300);
  }
  await h.settle();
  for (let i = 0; i < 20; i++) { const chip = await evalOn(cdp, chipText).catch(() => null); if (chip && chips.at(-1) !== chip) chips.push(chip); await sleep(250); }
  return { chips, submits: submits().slice(start).map(e => ({ model: e.model, auth: e.auth, prompt: e.prompt })) };
}

/** 静止画（G4 の候補を採用した形）とナレーション（N1 の候補を採用した形）の item を足す。 */
async function addStillAndNarration(root) {
  const { doneStillMeta } = await import(pathToFileURL(path.join(REPO, 'packages/generate/src/cli/meta-still.mjs')).href);
  const now = new Date().toISOString();
  const stillRel = `assets/generated/candidates/${STILL}/codex-image-1790000000000.png`;
  await mkdir(path.join(root, path.dirname(stillRel)), { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=#2a9d8f:s=1280x720', '-frames:v', '1', '-y', path.join(root, stillRel)]);
  const stillBytes = await readFile(path.join(root, stillRel));
  const startBytes = await readFile(path.join(root, 'assets/stills/start.png'));
  const stillMeta = doneStillMeta({ prompt: STILL_PROMPT, duration_s: 2, at: now, asOf: now.slice(0, 10), path: stillRel,
    image: { width: 1280, height: 720, sha256: sha(stillBytes), bytes: stillBytes.length }, elapsed_s: 18,
    references: [{ path: 'assets/stills/start.png', sha256: sha(startBytes) }], aspect: '16:9', candidateOf: STILL });
  stillMeta.output.aspect = '16:9';
  await writeFile(path.join(root, `${stillRel}.meta.json`), `${JSON.stringify(stillMeta, null, 2)}\n`);
  // ナレーション: 候補（meta あり）と、採用で out/narration へ写した同じ中身（meta なし）
  const candRel = `assets/generated/candidates/${NARR}/voicevox-1790000000001.wav`;
  await mkdir(path.join(root, path.dirname(candRel)), { recursive: true });
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=1.5', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-y', path.join(root, candRel)]);
  const narrBytes = await readFile(path.join(root, candRel));
  const narrMeta = { version: 1, kind: 'audio', status: 'done', candidate_of: NARR, route: 'voicevox', voice: '3',
    model: { id: 'voicevox:tts', as_of: now.slice(0, 10) },
    inputs: { prompt: NARR_SCRIPT, negative_prompt: null, first_frame: null, last_frame: null, reference_images: [], reference_videos: [], reference_audios: [],
      source_video: null, mode: null, camera: null, seed: null, extra: {} },
    output: { duration_s: 1.5, resolution: null, aspect: null, audio_out: null },
    cost: { estimate_usd: 0, actual_usd: null, unit: 'usd_per_audio', source: 'estimate' },
    job: { provider: 'local', started_at: now, stale_after_s: 900, elapsed_s: 4 },
    provenance: { created_at: now, tool: 'akari narration', key_source: null },
    result: { path: candRel, sha256: sha(narrBytes), bytes: narrBytes.length, duration_s_actual: 1.5, elapsed_s: 4 } };
  await writeFile(path.join(root, `${candRel}.meta.json`), `${JSON.stringify(narrMeta, null, 2)}\n`);
  await mkdir(path.join(root, 'out/narration'), { recursive: true });
  await copyFile(path.join(root, candRel), path.join(root, 'out/narration/n-0001.wav'));
  const doc = JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
  doc.sources.push({ id: 'still-src-1', path: stillRel }, { id: 'narration-src-1', path: 'out/narration/n-0001.wav' });
  doc.tracks[0].items.push({ id: STILL, at: 210, duration: 60, source: { kind: 'media', src: 'still-src-1', in: 0, out: 2 } });
  doc.tracks.push({ id: 'audio-main', lane: 'audio', items: [
    { id: NARR, at: 0, duration: 45, role: 'narration', source: { kind: 'media', src: 'narration-src-1', in: 0, out: 1.5 } }] });
  await writeFile(path.join(root, 'edit.json'), `${JSON.stringify(doc, null, 2)}\n`);
  // 枠の下書きにカメラの動き（引く）を入れて、作り方の「カメラの動き」を確かめる
  const frameMetaPath = path.join(root, 'assets/stills/start.png.meta.json');
  const frameMeta = JSON.parse(await readFile(frameMetaPath, 'utf8'));
  frameMeta.next.inputs.camera = { notation: 'bracket', value: '[Pull out]', from_annotation: null };
  await writeFile(frameMetaPath, `${JSON.stringify(frameMeta, null, 2)}\n`);
}

async function reloadApp() {
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(3000);
  await h.waitEval(`Boolean(window.theia?.container&&document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline after reload', 600_000);
  await h.waitEval(`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  await h.exec('akari.inspector.open').catch(() => undefined);
  await h.settle();
}

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await addStillAndNarration(project);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);

  // 準備: 空の枠で 1 案を作る → 自動で採用（V2 の既存の流れ）
  results.step = 'first generate';
  await openFrameGeneration(h, cdp);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  const original = await readEdit();
  const first = await runBatch(1);
  const adoptedDoc = await waitAdopted(FRAME, p => /candidates\//.test(p ?? ''));
  const adoptedPath = sourcePathOf(adoptedDoc, FRAME);
  const adoptedMetaPath = path.join(project, `${adoptedPath}.meta.json`);
  await sleep(1500);
  const adoptedMetaSha0 = sha(await readFile(adoptedMetaPath));
  const adoptedMeta = JSON.parse(await readFile(adoptedMetaPath, 'utf8'));
  const adoptedEdit = await readEdit();
  const adoptedEditSha = await editSha();
  results.observations.first = { submits: first.submits, chips: first.chips, adoptedPath, adoptedMetaSha256: adoptedMetaSha0,
    meta: { prompt: adoptedMeta.inputs?.prompt, camera: adoptedMeta.inputs?.camera, output: adoptedMeta.output, model: adoptedMeta.model, cost: adoptedMeta.cost } };
  await h.check('準備: 1 案を作って自動で採用（枠 = 候補の mp4）', /candidates\/clip-frame\/fal-h3-i2v-/.test(adoptedPath ?? '')
    && first.submits.length === 1 && first.submits[0].prompt?.endsWith(FIRST_PROMPT), { adoptedPath, submits: first.submits });

  // (i) 開き直して、作った動画の item の情報のタブ
  results.step = '(i) info tab';
  await reloadApp();
  await selectItem(FRAME);
  await openTab('info');
  await h.waitEval(`Boolean(document.querySelector(${S(PROV)}))`, 'provenance section', 60_000);
  await h.settle();
  const prov = await evalOn(cdp, provState);
  results.observations.videoProvenance = prov;
  await scrollTo(PROV, 'start');
  await h.shot('01-after-info-tab-video-provenance.png');
  const r = prov?.rows ?? {};
  await h.check('(i) 情報のタブに「作り方」（動画）', prov?.kind === 'video' && prov.title === '作り方', { kind: prov?.kind, title: prov?.title });
  await h.check('(i) 指示文（全文・選択できる）', r.prompt?.value === FIRST_PROMPT && r.prompt?.selectable === 'text', r.prompt);
  await h.check('(i) カメラの動き = 引く', r.camera?.value === '引く', r.camera);
  await h.check('(i) 長さ（作った長さ・実尺）', /秒/.test(r.duration?.value ?? '') && /秒/.test(r['actual-duration']?.value ?? ''), { duration: r.duration, actual: r['actual-duration'] });
  await h.check('(i) 手段 = ロゴ + モデル名', /MiniMax H3/.test(r.model?.value ?? '') && r.model?.badge, r.model);
  await h.check('(i) 料金 = 見積 $X · as_of', /^見積 \$\d+\.\d{2} · as_of \d{4}-\d{2}-\d{2}$/.test(r.cost?.value ?? ''), r.cost);
  await h.check('(i) 解像度・音声・作った日時・所要秒・最初の絵', !!r.resolution && !!r['audio-out'] && !!r.created && !!r.elapsed && r.first_frame?.value === 'start.png',
    { resolution: r.resolution, audio: r['audio-out'], created: r.created, elapsed: r.elapsed, first: r.first_frame });
  await h.check('(i) 「この作り方で作り直す」ボタン', prov?.regenerate === 'この作り方で作り直す', prov?.regenerate);

  // (ii)「この作り方で作り直す」→ 前回の入力が入った欄
  results.step = '(ii) regenerate opens fields';
  await h.clickUntil('[data-akari-generation-provenance-regenerate="video"]', `Boolean(document.querySelector(${S(PANEL)}))`, 'regenerate → panel');
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&!/見積もりを確認中/.test(p.textContent)&&/作り直す/.test(p.querySelector('[data-akari-inspector-video-create]')?.textContent??'')})()`, 'regen panel ready', 120_000);
  await h.waitEval(`[...document.querySelectorAll('[data-akari-ui="panel:inspector"] '+${S(PROMPT_SEL)})].some(x=>x.value===${S(FIRST_PROMPT)})`, 'prompt filled', 30_000).catch(() => undefined);
  await h.settle();
  const regen = await evalOn(cdp, panelState);
  results.observations.regenPanel = regen;
  await scrollTo('[data-akari-ui="section:inspector-generation"]', 'start');
  await h.shot('02-after-regenerate-fields-prefilled.png');
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.shot('02b-after-regenerate-button-and-in-use.png');
  await h.check('(ii) 前回の指示文が欄に入っている', regen.promptValues.includes(FIRST_PROMPT), regen.promptValues);
  await h.check('(ii) 欄の上に「今の動画: <モデル名> · <作った日時>」', /今の動画/.test(regen.current ?? regen.currentAny ?? '') && /MiniMax|H3/.test(regen.current ?? regen.currentAny ?? ''),
    { current: regen.current, currentAny: regen.currentAny });
  await h.check('(ii) ボタンは「1 案を作り直す」・前回のモデルにチェック', /^1 案を作り直す/.test(regen.create ?? '') && regen.checked.join() === 'fal:h3-i2v', { create: regen.create, checked: regen.checked });
  await h.check('(ii) 今の動画の候補に「使用中」の札', regen.candidates.some(c => c.path === adoptedPath && c.inUse), regen.candidates);

  // (iii) 指示文を直して「1 案を作り直す」
  results.step = '(iii) edit prompt + regenerate';
  // 指示文の欄は 1 行の input（textarea ではない）。前回の指示文が入っている欄に目印を付けて押す。
  await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('[data-akari-ui="panel:inspector"] '+${S(PROMPT_SEL)})].find(x=>x.value===${S(FIRST_PROMPT)});if(e)e.setAttribute('data-ghr-prompt','1');return !!e})()`);
  const ta = `[data-ghr-prompt]`;
  const taPoint = await h.pointOf(ta);
  await realClick(cdp, taPoint.x, taPoint.y);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
  await cdp.send('Input.insertText', { text: NEW_PROMPT });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  const draftPath = path.join(project, `.akari/generation/${FRAME}.inputs.json`);
  const draftUntil = Date.now() + 30_000;
  let draft;
  while (Date.now() < draftUntil) { draft = await readFile(draftPath, 'utf8').then(JSON.parse).catch(() => null); if (draft?.inputs?.prompt === NEW_PROMPT) break; await sleep(300); }
  results.observations.draftFile = { path: `.akari/generation/${FRAME}.inputs.json`, prompt: draft?.inputs?.prompt ?? null };
  await h.settle();
  const shaAfterEdit = sha(await readFile(adoptedMetaPath));
  await h.check('(iii) 直した指示文は下書きに入り、採用済みの候補の meta は不変', draft?.inputs?.prompt === NEW_PROMPT && shaAfterEdit === adoptedMetaSha0,
    { draftPrompt: draft?.inputs?.prompt, adoptedMetaSha256: shaAfterEdit });
  const second = await runBatch(2);
  await h.waitEval(`(()=>{const i=[...document.querySelectorAll('${PANEL} [data-akari-inspector-video-candidate] img')];return i.length>1&&i.every(e=>e.complete&&e.naturalWidth>0)})()`, 'thumbnails', 120_000).catch(() => undefined);
  const afterRegen = await evalOn(cdp, panelState);
  const editShaAfterRegen = await editSha();
  const adoptedMetaSha1 = sha(await readFile(adoptedMetaPath));
  const candFiles = (await readdir(path.join(project, 'assets/generated/candidates', FRAME))).filter(n => n.endsWith('.mp4')).sort();
  results.observations.regenerate = { submits: second.submits, chips: second.chips, candidates: afterRegen.candidates, candidateFiles: candFiles,
    editSha256: editShaAfterRegen, adoptedEditSha256: adoptedEditSha, adoptedMetaSha256Before: adoptedMetaSha0, adoptedMetaSha256After: adoptedMetaSha1,
    progressFile: await readFile(path.join(project, `.akari/generation/${FRAME}.compare.meta.json`), 'utf8').then(JSON.parse).then(m => ({ status: m.status, job: m.job })).catch(() => null) };
  await scrollTo(`${PANEL} [data-akari-inspector-video-candidate]`, 'start');
  await h.shot('03-after-regenerated-candidate-listed.png');
  const newPath = afterRegen.candidates[0]?.path;
  await h.check('(iii) 直した指示文でスタブへ 1 件（偽の鍵で認証あり）', second.submits.length === 1 && second.submits[0].prompt?.endsWith(NEW_PROMPT) && second.submits[0].auth, second.submits);
  await h.check('(iii) 新しい候補が同じ列の先頭（新しい順）に並び、今の動画は「使用中」', afterRegen.candidates.length === 2 && newPath !== adoptedPath
    && afterRegen.candidates[1]?.path === adoptedPath && afterRegen.candidates[1]?.inUse && !afterRegen.candidates[0]?.inUse, afterRegen.candidates);
  await h.check('(iii) 採用まで今の動画は不変（edit.json の sha が採用直後と同じ）', editShaAfterRegen === adoptedEditSha, { editShaAfterRegen, adoptedEditSha });
  await h.check('(iii) 採用済みの候補の meta は作り直しで書き換わらない（sha256 一致）', adoptedMetaSha1 === adoptedMetaSha0, { before: adoptedMetaSha0, after: adoptedMetaSha1 });
  await h.check('(iii) タイムラインの札（作成中 / 候補 N）が作り直しでも出る', second.chips.some(c => /作成中|生成中/.test(c)) && second.chips.some(c => /候補 2/.test(c)), second.chips);

  // (iv)「この案を使う」→ 入れ替わる → undo 1 回で前の動画
  results.step = '(iv) adopt + undo';
  await h.clickUntil(`${PANEL} [data-akari-inspector-video-candidate="${newPath}"]`, `Boolean(document.querySelector('${PANEL} [data-akari-inspector-video-adopt]'))`, 'pick new candidate');
  await h.click(`${PANEL} [data-akari-inspector-video-adopt]`);
  const swapped = await waitAdopted(FRAME, p => p === newPath);
  await h.settle();
  await h.shot('04-after-adopt-new-candidate.png');
  await h.check('(iv) 「この案を使う」で枠が新しい候補に入れ替わる', sourcePathOf(swapped, FRAME) === newPath, { src: sourcePathOf(swapped, FRAME) });
  // undo = タイムラインの「元に戻す」ボタンを 1 回だけ押す（利用者と同じ操作）
  await h.click('[data-akari-ui="panel:timeline"] button[aria-label="元に戻す"]');
  results.observations.undoClicks = 1;
  const undone = await waitAdopted(FRAME, p => p === adoptedPath);
  await sleep(800);
  const undoneFinal = await readEdit();
  results.observations.undo = { src: sourcePathOf(undoneFinal, FRAME), sameAsAdoptedJson: JSON.stringify(undoneFinal) === JSON.stringify(adoptedEdit),
    shaEqual: (await editSha()) === adoptedEditSha };
  await selectItem(FRAME);
  await h.shot('05-after-one-undo-previous-video.png');
  await h.check('(iv) undo 1 回で前の動画に戻る（edit.json が採用直後と JSON 一致）', results.observations.undo.sameAsAdoptedJson && sourcePathOf(undone, FRAME) === adoptedPath,
    results.observations.undo);
  const candFilesEnd = (await readdir(path.join(project, 'assets/generated/candidates', FRAME))).filter(n => n.endsWith('.mp4')).sort();
  await h.check('(iv) 使わなかった候補は残る', candFilesEnd.length === 2, candFilesEnd);
  await h.check('準備との比較: 元の枠（静止画）は採用前の edit にある', sourcePathOf(original, FRAME) === 'assets/stills/start.png', null);

  // (v) 静止画・ナレーションの item の情報のタブ
  results.step = '(v) still';
  await selectItem(STILL);
  await openTab('info');
  await h.waitEval(`document.querySelector(${S(PROV)})?.getAttribute('data-akari-generation-provenance')==='image'`, 'still provenance', 60_000).catch(() => undefined);
  await h.settle();
  const stillProv = await evalOn(cdp, provState);
  results.observations.stillProvenance = stillProv;
  await scrollTo(PROV, 'start');
  await h.shot('06-after-info-tab-still-provenance.png');
  await h.check('(v) 静止画の item の情報のタブに作り方（手段・指示文・参照）', stillProv?.kind === 'image' && stillProv.rows.prompt?.value === STILL_PROMPT
    && !!stillProv.rows.model && stillProv.rows['reference_images-0']?.value === 'start.png', stillProv);
  await h.check('(v) 静止画: 無い項目の行は出さない（カメラ・音声・最初の絵なし）', stillProv && !stillProv.rows.camera && !stillProv.rows['audio-out'] && !stillProv.rows.first_frame,
    stillProv && Object.keys(stillProv.rows));
  if (stillProv?.regenerate) {
    await h.clickUntil('[data-akari-generation-provenance-regenerate="image"]', `[...document.querySelectorAll('[data-akari-ui="panel:inspector"] '+${S(PROMPT_SEL)})].some(x=>x.value===${S(STILL_PROMPT)})`, 'still regenerate');
    await h.settle();
    const stillPanel = await evalOn(cdp, `(()=>{const i=document.querySelector('[data-akari-ui="panel:inspector"]');return{prompts:[...i.querySelectorAll(${S(PROMPT_SEL)})].map(x=>x.value),
      aspect:(i.querySelector('.akari-inspector-ai-still-panel [aria-pressed="true"],.akari-inspector-ai-still-panel .is-active,.akari-inspector-ai-still-panel select')?.value)??null,
      text:i.textContent.replace(/\\s+/g,' ').trim().slice(0,400)}})()`);
    results.observations.stillRegenerate = stillPanel;
    await h.shot('06b-after-still-regenerate-panel.png');
    await h.check('(v) 静止画「この作り方で作り直す」→ 前回の指示文で静止画のパネル', stillPanel.prompts.includes(STILL_PROMPT), stillPanel);
  }

  results.step = '(v) narration';
  await selectItem(NARR);
  await openTab('info');
  await h.waitEval(`document.querySelector(${S(PROV)})?.getAttribute('data-akari-generation-provenance')==='audio'`, 'narration provenance', 60_000).catch(() => undefined);
  await h.settle();
  const narrProv = await evalOn(cdp, provState);
  results.observations.narrationProvenance = narrProv;
  await scrollTo(PROV, 'start');
  await h.shot('07-after-info-tab-narration-provenance.png');
  await h.check('(v) ナレーションの item（out/narration・meta なし）の情報のタブに作り方（手段・原稿・声）', narrProv?.kind === 'audio'
    && narrProv.rows.prompt?.value === NARR_SCRIPT && narrProv.rows.prompt?.label === '原稿' && !!narrProv.rows.model && !!narrProv.rows.voice, narrProv);
  if (narrProv?.regenerate) {
    await h.clickUntil('[data-akari-generation-provenance-regenerate="audio"]', `[...document.querySelectorAll('[data-akari-ui="panel:inspector"] '+${S(PROMPT_SEL)})].some(x=>x.value===${S(NARR_SCRIPT)})`, 'narration regenerate');
    await h.settle();
    const narrPanel = await evalOn(cdp, `(()=>{const i=document.querySelector('[data-akari-ui="panel:inspector"]');return{prompts:[...i.querySelectorAll(${S(PROMPT_SEL)})].map(x=>x.value),
      checked:[...i.querySelectorAll('input[type="checkbox"]')].filter(x=>x.checked).map(x=>x.closest('label,[data-akari-narration-engine]')?.textContent.replace(/\\s+/g,' ').trim()),
      text:i.textContent.replace(/\\s+/g,' ').trim().slice(0,500)}})()`);
    results.observations.narrationRegenerate = narrPanel;
    await h.shot('07b-after-narration-regenerate-panel.png');
    await h.check('(v) ナレーション「この作り方で作り直す」→ 前回の原稿でナレーションのパネル', narrPanel.prompts.includes(NARR_SCRIPT), narrPanel);
  }

  // meta が無い item（元の動画 clip.mp4）には節が出ない
  results.step = 'no meta';
  await selectItem('clip-video');
  await openTab('info');
  await sleep(1500);
  const plain = await evalOn(cdp, `Boolean(document.querySelector(${S(PROV)}))`);
  await h.shot('08-after-info-tab-plain-video-no-section.png');
  await h.check('meta の無い item（撮った動画）には作り方の節が出ない', plain === false, plain);
  const adoptedMetaShaEnd = sha(await readFile(adoptedMetaPath));
  results.observations.adoptedMetaSha256End = adoptedMetaShaEnd;
  await h.check('最後まで採用済みの候補の meta は不変（sha256）', adoptedMetaShaEnd === adoptedMetaSha0, { start: adoptedMetaSha0, end: adoptedMetaShaEnd });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('zz-after-failure.png').catch(() => undefined);
} finally {
  if (stub) results.observations.stubEvents = stub.events.map(({ kind, endpoint, model, auth, prompt }) => ({ kind, endpoint, model, auth, prompt }));
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
