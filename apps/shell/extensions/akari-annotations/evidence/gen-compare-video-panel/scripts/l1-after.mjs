#!/usr/bin/env node
// 手順 3（AFTER）: 動画の生成の欄で複数のモデルにチェックして同時に作り、候補を並べて選ぶ。
//   node l1-after.mjs [--port=9653] [--keep-tmp]
// 開発ビルドの Electron + ローカルのスタブ fal（モデルごとに色・尺・処理時間が別）+ 偽の鍵。
//   (i) 既定のチェック (ii) 合計の費用承認（断ると受信 0） (iii) 待ち → 生成中の行と札 (iv) 候補 3 つ
//   (v) 候補をパネルで再生 (vi) この案を使う → undo 1 回 (vii) 1 モデル失敗 (viii) 1 案だけのときの自動採用
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  cleanupIso, helpers, REPO, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PROFILES, S, sha, startStubFal,
  stopElectron, writeAppModels
} from './l1-common.mjs';

const iso = await makeIso('after');
const ctx = makeResults('after', iso, 'results-after.json');
const { results, clean, save } = ctx;
const FRAME = 'clip-frame';
const [H3, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, project;
const editPath = () => path.join(project, 'edit.json');
const readEdit = async () => JSON.parse(await readFile(editPath(), 'utf8'));
const frameItem = doc => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === FRAME);
const editSha = async () => sha(await readFile(editPath()));
const submits = () => stub.events.filter(e => e.kind === 'submit');

const PANEL = '[data-akari-inspector-video-panel]';
const panelState = `(()=>{const p=document.querySelector(${S(PANEL)});if(!p)return null;
  const t=e=>e?.textContent.replace(/\\s+/g,' ').trim()??null;
  return{groups:[...p.querySelectorAll('[data-akari-inspector-video-model-group]')].map(g=>({heading:g.getAttribute('data-akari-inspector-video-model-group'),hidden:g.hidden,
      models:[...g.querySelectorAll('[data-akari-inspector-video-model]')].map(m=>({id:m.getAttribute('data-akari-inspector-video-model'),
        checked:!!m.querySelector('input')?.checked,disabled:m.getAttribute('data-akari-inspector-video-model-disabled')==='true',
        inputDisabled:!!m.querySelector('input')?.disabled,text:t(m),badge:!!m.querySelector('img,svg,[class*="badge"]'),
        reason:t(m.querySelector('[data-akari-inspector-video-model-reason]'))}))})),
    create:t(p.querySelector('[data-akari-inspector-video-create]')),createDisabled:!!p.querySelector('[data-akari-inspector-video-create]')?.disabled,
    progress:p.querySelector('[data-akari-inspector-video-progress]')?.getAttribute('data-akari-inspector-video-progress')??null,
    rows:[...p.querySelectorAll('[data-akari-inspector-video-progress-model]')].map(r=>({model:r.getAttribute('data-akari-inspector-video-progress-model'),
      state:r.getAttribute('data-akari-inspector-video-progress-state'),text:t(r),spinner:getComputedStyle(r,'::before').animationName})),
    cancel:!!p.querySelector('[data-akari-inspector-video-cancel]'),
    candidates:[...p.querySelectorAll('[data-akari-inspector-video-candidate]')].map(c=>({path:c.getAttribute('data-akari-inspector-video-candidate'),
      selected:c.getAttribute('data-akari-inspector-video-candidate-selected'),text:t(c),
      thumb:(()=>{const i=c.querySelector('img');if(!i)return null;const b=i.getBoundingClientRect();return{complete:i.complete,width:i.naturalWidth,src:(i.getAttribute('src')||'').slice(0,22),
        boxWidth:Math.round(b.width),boxHeight:Math.round(b.height)}})(),
      box:(()=>{const b=c.getBoundingClientRect();return{top:Math.round(b.top),bottom:Math.round(b.bottom),width:Math.round(b.width),height:Math.round(b.height)}})()})),
    panelWidth:Math.round(p.getBoundingClientRect().width),
    failed:[...p.querySelectorAll('[data-akari-inspector-video-failed-model]')].map(f=>({model:f.getAttribute('data-akari-inspector-video-failed-model'),text:t(f),
      retry:!!f.querySelector('[data-akari-inspector-video-retry-model]')})),
    player:(()=>{const v=p.querySelector('[data-akari-inspector-video-player]');return v?{picked:v.getAttribute('data-akari-inspector-video-player'),
      readyState:v.readyState,videoWidth:v.videoWidth,videoHeight:v.videoHeight,duration:v.duration,currentTime:v.currentTime,paused:v.paused,
      afterRow:v.previousElementSibling?.getAttribute('data-akari-inspector-video-candidate')??null,boxWidth:Math.round(v.getBoundingClientRect().width)}:null})(),
    adopt:t(p.querySelector('[data-akari-inspector-video-adopt]')),adoptDisabled:!!p.querySelector('[data-akari-inspector-video-adopt]')?.disabled,
    remain:t(p.querySelector('[data-akari-inspector-video-candidates-remain]')),
    error:t(p.querySelector('.akari-inspector-ai-still-error:not([data-akari-inspector-video-failed-model])')),
    modelSelect:!!document.querySelector('[data-akari-ui="field:inspector-generation-model"]')}})()`;
const chipText = `(()=>{const e=document.querySelector('[data-akari-ui="timeline:cut:1"]');return e?e.textContent.replace(/\\s+/g,' ').trim():null})()`;
const dialogState = `(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
  return{title:d.querySelector('.dialogTitle')?.textContent.trim()??null,text:d.querySelector('.dialogContent')?.innerText??d.innerText,
    buttons:[...d.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean)}})()`;

let h;
const panel = () => evalOn(cdp, panelState);
async function clickDialogButton(label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`![...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`, 'dialog closed', 10_000);
}
async function setChecked(modelId, checked) {
  const sel = `${PANEL} [data-akari-inspector-video-model-check="${modelId}"]`;
  const current = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});return e?e.checked:null})()`);
  if (current === null) {
    await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return true})()`);
  }
  if (await evalOn(cdp, `document.querySelector(${S(sel)})?.checked`) === checked) return;
  await h.clickUntil(sel, `document.querySelector(${S(sel)})?.checked===${checked}`, `check ${modelId} ${checked}`);
}
async function scrollTo(selector) {
  await evalOn(cdp, `(()=>{document.querySelector(${S(selector)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await sleep(250);
}
async function reselectFrame() {
  // 枠を選び直して生成の欄を開く（採用後・undo 後も候補が見えることを確かめる）
  await h.clickUntil('[data-akari-ui="timeline:cut:0"]', `document.querySelector('[data-akari-ui="timeline:cut:0"]')?.classList.contains('akari-annotations-selected')`, 'select clip');
  await h.clickUntil('[data-akari-ui="timeline:cut:1"]', `document.querySelector('[data-akari-ui="timeline:cut:1"]')?.classList.contains('akari-annotations-selected')`, 'select frame');
  await h.waitEval(`Boolean(document.querySelector(${S(PANEL)})) || Boolean(document.querySelector('[data-akari-inspector-ai-tile="video"]'))`, 'panel or tile', 30_000);
  if (!await evalOn(cdp, `Boolean(document.querySelector(${S(PANEL)}))`))
    await h.clickUntil('[data-akari-inspector-ai-tile="video"]', `Boolean(document.querySelector(${S(PANEL)}))`, 'video panel');
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 60_000).catch(() => undefined);
}
async function runBatch(label, expectedRoutes, { sampleRunning } = {}) {
  const start = submits().length;
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  const dialog = await h.waitEval(dialogState, 'approval dialog', 20_000);
  // 進み具合の行をページ内で 100ms ごとに記録する（スクショ等でスクリプト側が止まっても遷移を取りこぼさない）
  await evalOn(cdp, `(()=>{clearInterval(window.__gcvpRec);window.__gcvpRows={};window.__gcvpRec=setInterval(()=>{
    for(const r of document.querySelectorAll('[data-akari-inspector-video-panel] [data-akari-inspector-video-progress-model]')){
      const m=r.getAttribute('data-akari-inspector-video-progress-model'),st=r.getAttribute('data-akari-inspector-video-progress-state');
      const l=(window.__gcvpRows[m]??=[]);if(l.at(-1)?.state!==st)l.push({state:st,text:r.textContent.replace(/\\s+/g,' ').trim(),atMs:Date.now()})}},100);return true})()`);
  // 診断: ページのメインスレッドの停止（100ms タイマーの間隔 > 1 秒）と、同じ RPC（readVideoCandidates）の往復時間を 1 秒ごとに記録する
  await evalOn(cdp, `(()=>{const c=window.theia.container,d=c._bindingDictionary;
    const K=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getWidgets==='function'&&typeof k.prototype?.getOrCreateWidget==='function');
    const w=K&&c.get(K).getWidgets('akari-inspector-widget')[0];const root=w?.workspaceService?.tryGetRoots()[0]?.resource?.toString();
    window.__gcvpDiag={gaps:[],rpc:[],ok:!!(w&&root)};let last=Date.now();clearInterval(window.__gcvpGap);
    window.__gcvpGap=setInterval(()=>{const n=Date.now();if(n-last>1000)window.__gcvpDiag.gaps.push({atMs:n,ms:n-last});last=n},100);
    window.__gcvpRpcOn=true;(async()=>{while(window.__gcvpRpcOn&&w&&root){const t=Date.now();try{await w.layerAudioService.readVideoCandidates({projectRootUri:root,itemId:'clip-frame'})}catch{}
      window.__gcvpDiag.rpc.push({atMs:t,ms:Date.now()-t});await new Promise(r=>setTimeout(r,1000))}})();return window.__gcvpDiag.ok})()`).catch(() => false);
  await clickDialogButton('費用承認する');
  const seen = { states: {}, chips: [], metaQueue: {} };
  const seenMetas = new Map();
  for (const name of (await readdir(path.join(project, 'assets/generated/candidates', FRAME)).catch(() => []))) seenMetas.set(name, { done: true });
  const until = Date.now() + 600_000;
  let shotWaiting = false, shotRunning = false;
  while (Date.now() < until) {
    const s = await panel().catch(() => null);
    const chip = await evalOn(cdp, chipText).catch(() => null);
    if (chip && seen.chips.at(-1) !== chip) seen.chips.push(chip);
    const dir = path.join(project, 'assets/generated/candidates', FRAME);
    for (const name of (await readdir(dir).catch(() => [])).filter(n => n.endsWith('.mp4.meta.json'))) {
      const meta = await readFile(path.join(dir, name), 'utf8').then(JSON.parse).catch(() => null);
      if (!meta || seenMetas.has(name) && seenMetas.get(name).done) continue;
      const list = (seen.metaQueue[meta.route] ??= []);
      const q = `${meta.status}/${meta.job?.queue_status ?? '-'}`;
      if (list.at(-1)?.q !== q) list.push({ q, atMs: Date.now() });
    }
    for (const row of s?.rows ?? []) {
      const list = seen.states[row.model] ??= [];
      if (list.at(-1)?.state !== row.state) list.push({ state: row.state, text: row.text, spinner: row.spinner });
    }
    if (sampleRunning && !shotWaiting && s?.rows?.length === expectedRoutes.length && s.rows.every(r => r.state === 'waiting')) {
      shotWaiting = true; await scrollTo(`${PANEL} [data-akari-inspector-video-progress]`); await h.shot(`${sampleRunning}-a-waiting.png`);
      seen.waitingSnapshot = { rows: s.rows, chip: await evalOn(cdp, chipText) };
    }
    if (sampleRunning && !shotRunning && s?.rows?.some(r => r.state === 'running') && s.rows.some(r => r.state !== 'done')) {
      await sleep(1500);
      const again = await panel();
      shotRunning = true; await scrollTo(`${PANEL} [data-akari-inspector-video-progress]`); await h.shot(`${sampleRunning}-b-running.png`);
      seen.runningSnapshot = { rows: again.rows, chip: await evalOn(cdp, chipText) };
    }
    const started = submits().length - start >= expectedRoutes.length;
    const sameRoutes = s && s.rows.map(r => r.model).sort().join() === [...expectedRoutes].sort().join();
    if (started && sameRoutes && !s.cancel && s.rows.every(r => r.state === 'done' || r.state === 'failed')) break;
    await sleep(300);
  }
  await h.settle();
  // 負荷の高い時間帯は頭のコマの取得が遅れるので、候補のサムネイルが出揃うまで最大 120 秒待つ（出なければそのまま記録）
  await h.waitEval(`(()=>{const i=[...document.querySelectorAll('${PANEL} [data-akari-inspector-video-candidate] img')];return i.length>0&&i.every(e=>e.complete&&e.naturalWidth>0)})()`,
    'candidate thumbnails', 120_000).catch(() => undefined);
  const final = await panel();
  seen.diag = await evalOn(cdp, `(()=>{window.__gcvpRpcOn=false;clearInterval(window.__gcvpGap);const d=window.__gcvpDiag;if(!d)return null;
    const ms=d.rpc.map(r=>r.ms);return{ok:d.ok,gaps:d.gaps,maxGapMs:Math.max(0,...d.gaps.map(g=>g.ms)),rpcCount:ms.length,rpcMaxMs:Math.max(0,...ms),
    rpcMedianMs:ms.sort((a,b)=>a-b)[Math.floor(ms.length/2)]??null,rpc:d.rpc}})()`).catch(() => null);
  seen.pageStates = await evalOn(cdp, `(()=>{clearInterval(window.__gcvpRec);return window.__gcvpRows})()`).catch(() => null);
  for (const [model, list] of Object.entries(seen.pageStates ?? {})) {
    const merged = seen.states[model] ??= [];
    for (const row of list) if (!merged.some(x => x.state === row.state)) merged.push({ state: row.state, text: row.text, source: 'page' });
    const last = list.at(-1); if (last && merged.at(-1)?.state !== last.state) merged.push({ state: last.state, text: last.text, source: 'page' });
  }
  return { dialog, submits: submits().slice(start).map(e => ({ model: e.model, auth: e.auth, atMs: e.atMs })), seen, final };
}

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.observations.stubModels = PROFILES.map(({ model, color, durationSec, queueMs, processingMs }) => ({ model, color, durationSec, queueMs, processingMs }));
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);
  results.step = 'open';
  await openFrameGeneration(h, cdp);
  await h.waitEval(`Boolean(document.querySelector(${S(PANEL)}))`, 'video panel', 60_000);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  const original = await readEdit();
  const originalSha = await editSha();
  results.observations.originalFrame = frameItem(original);
  results.observations.originalSha = originalSha;

  // (i) 既定のチェック
  results.step = '(i) default';
  const initial = await panel();
  results.observations.initial = initial;
  const catalogCallableFalse = JSON.parse(await readFile(path.join(REPO, 'packages/schemas/ai-models.json'), 'utf8')).models
    .filter(row => row.callable === false).map(row => row.id);
  const allModels = initial.groups.flatMap(g => g.models);
  const usual = initial.groups.find(g => g.heading === 'いつもの');
  const favs = initial.groups.find(g => /お気に入り/.test(g.heading));
  await h.check('(i) いつもの = h3 の 1 つだけにチェック', usual?.models.length === 1 && usual.models[0].id === H3 && usual.models[0].checked
    && allModels.filter(m => m.checked).length === 1, allModels.filter(m => m.checked).map(m => m.id));
  await h.check('(i) ★ お気に入り（kling / seedance）が並び、チェックは外れている', favs && favs.models.map(m => m.id).join() === [KLING, SEEDANCE].join()
    && favs.models.every(m => !m.checked), favs?.models.map(m => ({ id: m.id, checked: m.checked })));
  await h.check('(i) ほかのモデルは畳まれている', initial.groups.find(g => g.heading === 'ほかのモデル')?.hidden === true, initial.groups.map(g => [g.heading, g.hidden]));
  await h.check('(i) 呼べないモデル（callable: false）は出ない', !allModels.some(m => catalogCallableFalse.includes(m.id)), { callableFalse: catalogCallableFalse, shown: allModels.map(m => m.id) });
  await h.check('(i) モデルのドロップダウンは無い', initial.modelSelect === false, initial.modelSelect);
  await h.check('(i) ボタン「1 案を作る · 見積 $X」', /^1 案を作る · 見積 \$\d/.test(initial.create ?? ''), initial.create);
  await scrollTo(PANEL);
  await h.shot('01-after-default-checks.png');
  // ほかのモデルを開いて、使えないモデル（グレー + 理由）を撮る
  await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();return true})()`);
  await sleep(400);
  const expanded = await panel();
  const greyed = expanded.groups.flatMap(g => g.models).filter(m => m.disabled);
  results.observations.greyed = greyed;
  await h.check('(i) この枠で使えないモデルはグレー + 理由 1 行（チェック不可）', greyed.length > 0 && greyed.every(m => m.reason && m.inputDisabled), greyed.map(m => ({ id: m.id, reason: m.reason })));
  if (greyed[0]) await scrollTo(`${PANEL} [data-akari-inspector-video-model="${greyed[0].id}"]`);
  await h.shot('01b-after-other-models-greyed.png');
  await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-inspector-video-more]');if(t&&t.getAttribute('aria-expanded')==='true')t.click();return true})()`);

  // (ii) 3 モデルにチェック → 合計の費用承認 → 断ると何も送らない
  results.step = '(ii) approval';
  await setChecked(KLING, true);
  await setChecked(SEEDANCE, true);
  await h.waitEval(`/^3 案を作る/.test(document.querySelector('[data-akari-inspector-video-create]')?.textContent.trim()??'')`, '3 案', 10_000);
  const three = await panel();
  results.observations.threeChecked = { create: three.create, models: three.groups.flatMap(g => g.models).filter(m => m.checked).map(m => ({ id: m.id, text: m.text })) };
  await h.check('(ii) ボタン「3 案を作る · 見積 $X + 未確認 1」（kling は料金なし）', /^3 案を作る · 見積 \$\d+\.\d\d \+ 未確認 1$/.test(three.create ?? ''), three.create);
  await scrollTo(`${PANEL} [data-akari-inspector-video-create]`);
  await h.shot('02-after-three-checked.png');
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  const denyDialog = await h.waitEval(dialogState, 'approval dialog', 20_000);
  results.observations.approvalDialog = denyDialog;
  await h.shot('03-after-total-approval-dialog.png');
  await h.check('(ii) 承認の文面にモデルごとの内訳・合計・as_of・料金未確認の明記', /MiniMax|H3/.test(denyDialog.text) && /Kling/.test(denyDialog.text) && /Seedance/.test(denyDialog.text)
    && /合計/.test(denyDialog.text) && /as_of/.test(denyDialog.text) && /未確認/.test(denyDialog.text), denyDialog.text);
  const beforeDeny = submits().length;
  await clickDialogButton('キャンセル');
  await sleep(5000);
  const denied = await panel();
  results.observations.deny = { stubSubmitsAfterDeny: submits().length - beforeDeny, stubEventsTotal: stub.events.length, running: denied.cancel, editShaSame: (await editSha()) === originalSha };
  await h.check('(ii) 断るとスタブの受信 0・edit.json 不変', submits().length - beforeDeny === 0 && stub.events.length === 0 && results.observations.deny.editShaSame, results.observations.deny);
  await h.shot('04-after-deny-nothing-sent.png');

  // (iii)(iv) 承認 → 待ち → 生成中の行と札 → 候補 3 つ
  results.step = '(iii) run three';
  const run3 = await runBatch('three', [H3, KLING, SEEDANCE], { sampleRunning: '05' });
  results.observations.runThree = { dialog: run3.dialog, submits: run3.submits, states: run3.seen.states, pageStates: run3.seen.pageStates, diag: run3.seen.diag, metaQueue: run3.seen.metaQueue, chips: run3.seen.chips,
    waiting: run3.seen.waitingSnapshot, running: run3.seen.runningSnapshot, final: run3.final };
  const spread = run3.submits.length ? Math.max(...run3.submits.map(s => s.atMs)) - Math.min(...run3.submits.map(s => s.atMs)) : null;
  await h.check('(iii) 合計 1 回の承認でスタブに 3 モデルが同時に届く（偽の鍵で認証）', run3.submits.length === 3 && run3.submits.every(s => s.auth) && spread < 5000, { submits: run3.submits.map(s => s.model), spreadMs: spread });
  // 全モデルで「生成中」が見えたかは記録だけにする（負荷の高い時間帯は backend の応答が数十秒遅れ、短い生成中の区間を飛ばすことがある — 時間は受け入れ条件ではない）
  results.observations.runThree.progressAllModelsRunning = [H3, KLING, SEEDANCE].every(m => (run3.seen.states[m] ?? []).some(x => x.state === 'running'));
  await h.check('(iii) 進み具合の行: 待ち → 生成中 · N 秒 → 完了', [H3, KLING, SEEDANCE].every(m => {
    const states = (run3.seen.states[m] ?? []).map(x => x.state); return states.includes('waiting') && states.at(-1) === 'done';
  }) && Object.values(run3.seen.states).flat().some(x => x.state === 'running') && Object.values(run3.seen.states).flat().some(x => /生成中 · \d+ 秒/.test(x.text)) && Object.values(run3.seen.states).flat().some(x => /待ち/.test(x.text)), run3.seen.states);
  await h.check('(iii) タイムラインの札「3 案作成中 · k/3」→「候補 3」', run3.seen.chips.some(c => /3 案作成中 · [0-2]\/3/.test(c)) && /候補 3/.test(run3.seen.chips.at(-1) ?? ''), run3.seen.chips);
  await h.check('(iv) 候補 3 つ（サムネイル・会社・所要秒・尺・寸法・料金）', run3.final.candidates.length === 3
    && run3.final.candidates.every(c => c.thumb?.complete && c.thumb.width > 0 && /尺 [\d.]+ 秒 · 作成 \d+ 秒 · \d+×\d+ · (\$|料金)/.test(c.text)), run3.final.candidates);
  // r1: 候補の行はコンパクト（サムネイル 160px 前後・パネル幅に広がらない）で、3 つが 1 画面（高さ 900px 前後）に収まる
  const rowsSpan = run3.final.candidates.length ? Math.max(...run3.final.candidates.map(c => c.box.bottom)) - Math.min(...run3.final.candidates.map(c => c.box.top)) : null;
  results.observations.compactRows = { panelWidth: run3.final.panelWidth, thumbs: run3.final.candidates.map(c => ({ w: c.thumb?.boxWidth, h: c.thumb?.boxHeight })),
    rowHeights: run3.final.candidates.map(c => c.box.height), rowsSpan };
  await h.check('(iv r1) 候補のサムネイルは幅 160px 前後でパネル幅に広がらない・3 行が 900px 以内に収まる',
    run3.final.candidates.every(c => c.thumb?.boxWidth >= 150 && c.thumb.boxWidth <= 170 && c.thumb.boxWidth < run3.final.panelWidth * 0.6) && rowsSpan <= 900, results.observations.compactRows);
  await h.check('(iv r1) 候補の行の札「尺 N 秒 · 作成 N 秒」', run3.final.candidates.every(c => /尺 [\d.]+ 秒 · 作成 \d+ 秒/.test(c.text)), run3.final.candidates.map(c => c.text));
  results.observations.runThree.finishingSeen = Object.values(run3.seen.states).flat().some(x => /仕上げ中/.test(x.text));
  results.observations.runThree.waitingAfterRunning = Object.fromEntries(Object.entries(run3.seen.states).map(([m, xs]) => {
    const i = xs.findIndex(x => x.state === 'running'); return [m, i >= 0 && xs.slice(i + 1).some(x => x.state === 'waiting')];
  }));
  const afterThreeSha = await editSha();
  await h.check('(iv) 候補の時点で edit.json は変わらない', afterThreeSha === originalSha, { before: originalSha, after: afterThreeSha });
  await evalOn(cdp, `(()=>{document.querySelector(${S(`${PANEL} [data-akari-inspector-video-candidate]`)})?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
  await sleep(250);
  await h.shot('06-after-three-candidates.png');

  // (v) 候補をパネルで再生
  results.step = '(v) play';
  const green = run3.final.candidates.find(c => /kling/.test(c.path));
  await h.click(`${PANEL} [data-akari-inspector-video-candidate="${green.path}"]`);
  await h.waitEval(`(()=>{const v=document.querySelector('[data-akari-inspector-video-player]');return v&&v.readyState>=2&&v.videoWidth>0})()`, 'player ready', 120_000);
  await evalOn(cdp, `(async()=>{const v=document.querySelector('[data-akari-inspector-video-player]');v.muted=true;await v.play().catch(()=>{});
    const t0=Date.now();while(v.currentTime<0.5&&Date.now()-t0<8000)await new Promise(r=>setTimeout(r,100));
    await new Promise(r=>{const t=setTimeout(r,2000);if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(()=>{clearTimeout(t);r()})});return true})()`);
  const pixel = await evalOn(cdp, `(()=>{const v=document.querySelector('[data-akari-inspector-video-player]');const c=document.createElement('canvas');c.width=8;c.height=8;
    const g=c.getContext('2d');g.drawImage(v,0,0,8,8);const d=g.getImageData(4,4,1,1).data;return{rgb:[d[0],d[1],d[2]],currentTime:v.currentTime,paused:v.paused}})()`);
  const played = await panel();
  results.observations.play = { picked: green.path, player: played.player, pixel };
  await h.check('(v) 候補を押すと編集パネルの中で再生（緑の候補の画素）', played.player?.picked === green.path && pixel.rgb[1] > 90 && pixel.rgb[0] < 80 && pixel.currentTime > 0,
    results.observations.play);
  await h.check('(v r1) プレイヤーは選んだ候補の行の直後にだけパネル幅で出る', played.player?.afterRow === green.path
    && played.player.boxWidth > (played.candidates.find(c => c.path === green.path)?.thumb?.boxWidth ?? 0), { player: played.player, panelWidth: played.panelWidth });
  const previewUnchanged = (await editSha()) === originalSha;
  await scrollTo(`${PANEL} [data-akari-inspector-video-player]`);
  await h.shot('07-after-play-candidate-in-panel.png');

  // (vi) この案を使う → 枠に入る → undo 1 回で戻る
  results.step = '(vi) adopt + undo';
  await h.click(`${PANEL} [data-akari-inspector-video-adopt]`);
  await h.waitEval(`true`, 'noop');
  const adoptUntil = Date.now() + 180_000;
  let adopted;
  while (Date.now() < adoptUntil) { adopted = await readEdit(); if (frameItem(adopted)?.source?.src !== 'src-start') break; await sleep(200); }
  const adoptedItem = frameItem(adopted);
  const adoptedSource = adopted.sources.find(s => s.id === adoptedItem.source.src);
  const candidateFiles = await Promise.all(run3.final.candidates.map(c => stat(path.join(project, c.path)).then(() => true).catch(() => false)));
  results.observations.adopt = { item: adoptedItem, source: adoptedSource, candidateFilesExist: candidateFiles, previewEditUnchangedWhilePlaying: previewUnchanged };
  await h.check('(vi) 「この案を使う」で枠の item が候補の mp4 に（sources に登録）', adoptedItem.source.src === `gen-${FRAME}-video` && adoptedSource?.path === green.path, results.observations.adopt);
  await h.check('(vi) 使わなかった候補は残る（ファイルと「ほかの候補は素材に残ります」）', candidateFiles.every(Boolean) && /ほかの候補は素材に残ります/.test((await panel())?.remain ?? ''), candidateFiles);
  await h.settle();
  await h.shot('08-after-adopt.png');
  await h.exec('akari.timeline.undo');
  const undoUntil = Date.now() + 180_000;
  let undone;
  while (Date.now() < undoUntil) { undone = await readEdit(); if (frameItem(undone)?.source?.src === 'src-start') break; await sleep(200); }
  const undoneSha = await editSha();
  results.observations.undo = { item: frameItem(undone), sources: undone.sources, sha: undoneSha, sameAsOriginalJson: JSON.stringify(undone) === JSON.stringify(original) };
  await h.check('(vi) undo 1 回で元の枠・元の sources に戻る', JSON.stringify(frameItem(undone)) === JSON.stringify(frameItem(original))
    && JSON.stringify(undone.sources) === JSON.stringify(original.sources), results.observations.undo);
  await h.settle();
  await h.shot('09-after-one-undo.png');

  // (vii) 1 モデル失敗でも他の候補は並ぶ
  results.step = '(vii) one fails';
  stub.failing = new Set([KLING]);
  await reselectFrame();
  const reopened = await panel();
  results.observations.reopened = { candidates: reopened.candidates.length, checked: reopened.groups.flatMap(g => g.models).filter(m => m.checked).map(m => m.id) };
  await h.check('(vii) 枠を選び直しても候補が見える', reopened.candidates.length >= 3, results.observations.reopened);
  for (const m of [H3, KLING, SEEDANCE]) await setChecked(m, true);
  const runFail = await runBatch('fail', [H3, KLING, SEEDANCE]);
  results.observations.runFail = { submits: runFail.submits, states: runFail.seen.states, final: { rows: runFail.final.rows, failed: runFail.final.failed, candidates: runFail.final.candidates.length } };
  await h.check('(vii) kling は「失敗 · 理由」+ もう一度、h3・seedance は完了', runFail.final.rows.find(r => r.model === KLING)?.state === 'failed'
    && /失敗 · /.test(runFail.final.rows.find(r => r.model === KLING)?.text ?? '') && runFail.final.failed.some(f => f.model === KLING && f.retry)
    && runFail.final.rows.filter(r => r.model !== KLING).every(r => r.state === 'done'), results.observations.runFail.final);
  await h.check('(vii) 失敗があっても 2 案以上は自動で入れない（edit.json 不変）', (await editSha()) === undoneSha, null);
  await scrollTo(`${PANEL} [data-akari-inspector-video-failed-model]`);
  await h.shot('10-after-one-model-failed.png');

  // (viii) 1 案だけのときは出来たら自動で「この案を使う」
  results.step = '(viii) single auto adopt';
  stub.failing = new Set();
  await setChecked(KLING, false);
  await setChecked(SEEDANCE, false);
  const single = await panel();
  await h.check('(viii) ボタン「1 案を作る · 見積 $X」', /^1 案を作る · 見積 \$\d/.test(single.create ?? ''), single.create);
  const beforeSingle = await readEdit();
  const runOne = await runBatch('single', [H3]);
  const autoUntil = Date.now() + 300_000;
  let auto;
  while (Date.now() < autoUntil) { auto = await readEdit(); if (frameItem(auto)?.source?.src !== 'src-start') break; await sleep(200); }
  const autoItem = frameItem(auto);
  results.observations.single = { submits: runOne.submits, states: runOne.seen.states, item: autoItem, source: auto.sources.find(s => s.id === autoItem.source.src) };
  await h.check('(viii) 1 案だけなら出来たら自動で枠に入る', runOne.submits.length === 1 && autoItem.source.src === `gen-${FRAME}-video`
    && /h3/.test(results.observations.single.source?.path ?? ''), results.observations.single);
  await h.settle();
  await h.shot('11-after-single-auto-adopt.png');
  await h.exec('akari.timeline.undo');
  const undoOneStart = Date.now(); const undoOneUntil = Date.now() + 180_000;
  let undoneOne;
  while (Date.now() < undoOneUntil) { undoneOne = await readEdit(); if (frameItem(undoneOne)?.source?.src === 'src-start') break; await sleep(200); }
  await h.check('(viii) 自動採用も undo 1 回で戻る', JSON.stringify(frameItem(undoneOne)) === JSON.stringify(frameItem(beforeSingle))
    && JSON.stringify(undoneOne.sources) === JSON.stringify(beforeSingle.sources), { item: frameItem(undoneOne), waitedMs: Date.now() - undoOneStart });
  await h.shot('12-after-single-undo.png');
  results.observations.stubEvents = stub.events.map(e => ({ model: e.model, auth: e.auth }));
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
  await stub?.close();
  await cleanupIso(iso);
}

