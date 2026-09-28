#!/usr/bin/env node
// 手順 0（BEFORE）: スタブ fal で 3 案を作り、候補を押しても出力プレビューの枠が空の枠のままなのを記録する。
//   node l1-before.mjs [--port=9658] [--keep-tmp]
// 開発ビルドの Electron + ローカルのスタブ fal（モデルごとに色・音の高さが別）+ 偽の鍵。一時プロジェクト + 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { evalOn } from './cdp-lib.mjs';
import { cleanupIso, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, PROFILES, S, sha, startStubFal, stopElectron, writeAppModels } from './l1-common.mjs';
import { candidateRows, hue, makeThreeCandidates, openPreview, PANEL, previewColor, probeExpression } from './l1-flow.mjs';

const iso = await makeIso('before');
const ctx = makeResults('before', iso, 'results-before.json');
const { results, clean, save } = ctx;
const [H3, KLING, SEEDANCE] = PROFILES.map(p => p.model);
let electron, cdp, stub, preview;
try {
  results.step = 'fixture';
  const project = await makeProject(iso);
  await writeAppModels(iso);
  stub = await startStubFal(iso);
  const editSha = async () => sha(await readFile(path.join(project, 'edit.json')));
  const originalSha = await editSha();
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project, { AKARI_FAL_STUB_URL: stub.url }));
  results.observations.electronPid = electron.pid;
  const h = helpers(cdp, ctx);
  results.step = 'generate three';
  await openFrameGeneration(h, cdp);
  const candidates = await makeThreeCandidates(h, cdp, [KLING, SEEDANCE]);
  results.observations.candidates = candidates;
  await h.check('BEFORE: スタブ fal で 3 案ができた', candidates.length === 3, candidates.map(c => c.path));
  results.step = 'preview';
  preview = await openPreview(h, cdp, project);
  // 枠（3〜7 秒）の途中の 4.5 秒で止めて見る
  await preview.seek(4.5);
  await sleep(1500);
  const emptyColor = await previewColor(cdp, preview, iso);
  const emptyProbe = await preview.pv(probeExpression);
  results.observations.emptyFrame = { color: emptyColor, hue: hue(emptyColor), probe: emptyProbe };
  await h.shot('00-before-empty-frame.png');
  results.step = 'pick candidate';
  const green = candidates.find(c => /kling/.test(c.path));
  await h.click(`${PANEL} [data-akari-inspector-video-candidate="${green.path}"]`);
  await h.waitEval(`(()=>{const v=document.querySelector('[data-akari-inspector-video-player]');return v&&v.readyState>=2})()`, 'panel player', 60_000).catch(() => undefined);
  await sleep(2000);
  await preview.seek(4.5);
  await sleep(1500);
  const pickedColor = await previewColor(cdp, preview, iso);
  const pickedProbe = await preview.pv(probeExpression);
  const panelPlayer = await evalOn(cdp, `(()=>{const v=document.querySelector('[data-akari-inspector-video-player]');return v?{picked:v.getAttribute('data-akari-inspector-video-player'),readyState:v.readyState}:null})()`);
  results.observations.pickedKling = { color: pickedColor, hue: hue(pickedColor), probe: pickedProbe, panelPlayer, rows: await evalOn(cdp, candidateRows), editShaSame: (await editSha()) === originalSha };
  await h.shot('01-before-picked-candidate-frame-still-empty.png');
  await h.check('BEFORE: 候補（緑の kling）を押しても出力プレビューの枠は緑にならない（パネル内のプレイヤーだけ）',
    hue(pickedColor) !== 'green' && Boolean(panelPlayer), results.observations.pickedKling);
  await h.check('BEFORE: 出力プレビューの枠の要素に候補の mp4 が入らない', !JSON.stringify(pickedProbe.frame).includes('kling')
    && !pickedProbe.videos.some(v => /kling/.test(v.src)), pickedProbe);
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('00-before-zz-failure.png').catch(() => undefined);
} finally {
  if (stub) results.observations.stubEvents = stub.events.map(e => ({ kind: e.kind, model: e.model, auth: e.auth }));
  await save();
  preview?.close();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await stub?.close?.();
  await cleanupIso(iso);
}
