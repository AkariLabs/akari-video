#!/usr/bin/env node
// 手順 0（BEFORE）: スタブ fal で動画を 1 案作って採用 → 情報のタブに作り方が無い・「動画にする」が「生成済み」だけ、を記録する。
//   node l1-before.mjs [--port=9656] [--keep-tmp]
// 開発ビルドの Electron + ローカルのスタブ fal + 偽の鍵。一時プロジェクト + 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData。
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn, realClick } from './cdp-lib.mjs';
import {
  cleanupIso, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, S, sha, startStubFal, stopElectron, writeAppModels
} from './l1-common.mjs';

const iso = await makeIso('before');
const ctx = makeResults('before', iso, 'results-before.json');
const { results, clean, save } = ctx;
const FRAME = 'clip-frame';
const PANEL = '[data-akari-inspector-video-panel]';
const SECTION = '[data-akari-ui="section:inspector-generation"]';
let electron, cdp, stub, project, h;
const readEdit = async () => JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
const frameItem = doc => doc.tracks.flatMap(t => t.items ?? []).find(row => row.id === FRAME);
const text = selector => `(()=>{const e=document.querySelector(${S(selector)});return e?e.textContent.replace(/\\s+/g,' ').trim():null})()`;
const dialogOpen = `[...document.querySelectorAll('.dialogBlock')].some(e=>e.offsetParent!==null)`;

async function clickDialogButton(label) {
  const point = await h.waitEval(`(()=>{const d=[...document.querySelectorAll('.dialogBlock')].find(e=>e.offsetParent!==null);if(!d)return null;
    const b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()===${S(label)});if(!b)return null;const r=b.getBoundingClientRect();
    return r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`, `dialog button ${label}`);
  await realClick(cdp, point.x, point.y);
  await h.waitEval(`!${dialogOpen}`, 'dialog closed', 10_000);
}
async function reselectFrame() {
  await h.clickUntil('[data-akari-ui="timeline:cut:0"]', `document.querySelector('[data-akari-ui="timeline:cut:0"]')?.classList.contains('akari-annotations-selected')`, 'select clip');
  await h.clickUntil('[data-akari-ui="timeline:cut:1"]', `document.querySelector('[data-akari-ui="timeline:cut:1"]')?.classList.contains('akari-annotations-selected')`, 'select frame');
  await h.settle();
}
async function openTab(id) {
  const active = `(()=>{const t=document.querySelector('[data-akari-ui="tab:inspector-${id}"]');return !!t&&t.classList.contains('is-active')})()`;
  if (!await evalOn(cdp, active)) await h.clickUntil(`[data-akari-ui="tab:inspector-${id}"]`, active, `tab ${id}`);
  await h.settle();
}
const inspectorText = () => evalOn(cdp, text('[data-akari-ui="panel:inspector"]'));

try {
  results.step = 'fixture';
  project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  h = helpers(cdp, ctx);
  results.step = 'open';
  await openFrameGeneration(h, cdp);
  await h.waitEval(`(()=>{const p=document.querySelector(${S(PANEL)});return p&&p.querySelectorAll('[data-akari-inspector-video-model]').length>0&&!/見積もりを確認中/.test(p.textContent)})()`, 'estimates', 120_000);
  results.observations.beforeGenerate = await evalOn(cdp, text(SECTION));
  await h.shot('00-before-a-empty-frame-panel.png');

  results.step = 'generate one';
  await evalOn(cdp, `(()=>{document.querySelector(${S(`${PANEL} [data-akari-inspector-video-create]`)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  results.observations.createLabel = await evalOn(cdp, text(`${PANEL} [data-akari-inspector-video-create]`));
  await h.click(`${PANEL} [data-akari-inspector-video-create]`);
  await h.waitEval(dialogOpen, 'approval dialog', 20_000);
  await clickDialogButton('費用承認する');
  // 1 案だけなら出来たら自動で採用される（V2）
  const until = Date.now() + 600_000;
  let adopted;
  while (Date.now() < until) {
    const item = frameItem(await readEdit().catch(() => ({ tracks: [] })));
    const doc = await readEdit().catch(() => null);
    const src = doc?.sources?.find(s => s.id === item?.source?.src);
    if (src && /candidates\//.test(src.path)) { adopted = { item, source: src }; break; }
    await sleep(500);
  }
  if (!adopted) throw new Error('auto adopt timeout');
  results.observations.adopted = adopted;
  results.observations.stubSubmits = stub.events.filter(e => e.kind === 'submit').map(e => ({ model: e.model, auth: e.auth }));
  const candDir = path.join(project, 'assets/generated/candidates', FRAME);
  const metaName = (await readdir(candDir)).find(n => n.endsWith('.mp4.meta.json'));
  const metaBytes = await readFile(path.join(candDir, metaName));
  const meta = JSON.parse(metaBytes);
  results.observations.candidateMeta = { name: metaName, sha256: sha(metaBytes), kind: meta.kind, status: meta.status,
    prompt: meta.inputs?.prompt ?? null, camera: meta.inputs?.camera ?? null, output: meta.output ?? null, model: meta.model ?? null, cost: meta.cost ?? null };
  await sleep(1500);

  results.step = 'after adopt (same session)';
  const sameSession = await evalOn(cdp, `(()=>{const i=document.querySelector('[data-akari-ui="panel:inspector"]');if(!i)return null;
    return{text:i.textContent.replace(/\\s+/g,' ').trim().slice(0,800),promptVisible:[...i.querySelectorAll('textarea')].some(t=>t.value.includes(${S(meta.inputs?.prompt ?? '')}))}})()`);
  results.observations.sameSessionAfterAdopt = sameSession;
  await h.shot('00-before-b1-after-adopt-same-session.png');
  // アプリを開き直した状態（パネルの状態が消えたあと）で枠を選び直す
  results.step = 'reload';
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(3000);
  await h.waitEval(`Boolean(window.theia?.container&&document.querySelector('[data-akari-ui="timeline:cut:1"]'))`, 'timeline after reload', 600_000);
  await h.waitEval(`(()=>{const e=document.querySelector('.theia-preload');if(!e)return true;const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return !(s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0&&r.width&&r.height)})()`, 'preload', 480_000);
  await h.exec('akari.inspector.open').catch(() => undefined);
  results.step = 'reselect';
  await reselectFrame();
  await openTab('edit');
  await h.waitEval(`Boolean(document.querySelector(${S(SECTION)}))`, 'generation section', 30_000).catch(() => undefined);
  await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const body=s?.querySelector('.akari-inspector-section-body');
    if(body?.hidden)s.querySelector('.akari-inspector-section-toggle')?.click();s?.scrollIntoView({block:'start',behavior:'instant'});return true})()`);
  await h.settle();
  if (!await evalOn(cdp, `Boolean(document.querySelector(${S(SECTION)}))`) && await evalOn(cdp, `Boolean(document.querySelector('[data-akari-inspector-ai-tile="video"]'))`))
    await h.clickUntil('[data-akari-inspector-ai-tile="video"]', `Boolean(document.querySelector(${S(SECTION)}))`, 'video tile').catch(() => undefined);
  await h.settle();
  const section = await evalOn(cdp, `(()=>{const i=document.querySelector('[data-akari-ui="panel:inspector"]');if(!i)return null;
    return{text:i.textContent.replace(/\\s+/g,' ').trim().slice(0,900),generationSection:!!document.querySelector(${S(SECTION)}),videoPanel:!!document.querySelector(${S(PANEL)}),
      promptFields:[...i.querySelectorAll('textarea')].map(t=>t.value.slice(0,80)),
      promptVisible:[...i.querySelectorAll('textarea,input')].some(t=>t.value.includes(${S(meta.inputs?.prompt ?? '')})),
      cameraField:!!i.querySelector('[data-akari-ui="field:inspector-generation-camera"]'),
      doneLabel:/生成済み/.test(i.textContent),finalQuality:/本番の画質にする/.test(i.textContent)}})()`);
  results.observations.doneSection = section;
  await h.shot('00-before-b2-done-frame-no-prompt.png');
  await h.check('BEFORE: 作り終えた枠の「動画にする」に前回の指示文・カメラ・長さの欄が無い（直して作り直す道が無い）',
    !!section && !section.promptVisible && !section.cameraField && !section.text.includes(meta.inputs?.prompt ?? '\u0000'),
    { promptVisible: section?.promptVisible, cameraField: section?.cameraField, doneLabel: section?.doneLabel, videoPanel: section?.videoPanel });

  results.step = 'info tab';
  await openTab('info');
  const info = await inspectorText();
  results.observations.infoTab = info;
  await h.shot('00-before-c-info-tab-no-provenance.png');
  await h.check('BEFORE: 情報のタブに作り方（指示文・モデル）が出ない',
    !/作り方/.test(info ?? '') && !(info ?? '').includes(meta.inputs?.prompt ?? '\u0000'), { info: info?.slice(0, 600) });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('00-before-zz-failure.png').catch(() => undefined);
} finally {
  if (stub) results.observations.stubEvents = stub.events.map(({ kind, endpoint, model, auth }) => ({ kind, endpoint, model, auth }));
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
