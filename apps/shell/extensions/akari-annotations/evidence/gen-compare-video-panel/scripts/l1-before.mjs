#!/usr/bin/env node
// 手順 0（BEFORE）: 今の動画の生成の欄（モデルはドロップダウンで 1 つだけ）を撮る。
//   node l1-before.mjs [--port=9653] [--keep-tmp]
// 生成は始めない（スタブ fal も立てない）。一時プロジェクト + 隔離した HOME / AKARI_HOME / THEIA_CONFIG_DIR / userData。
import { evalOn } from './cdp-lib.mjs';
import { cleanupIso, helpers, launchElectron, makeIso, makeProject, makeResults, openFrameGeneration, S, stopElectron, writeAppModels } from './l1-common.mjs';

const iso = await makeIso('before');
const ctx = makeResults('before', iso, 'results-before.json');
const { results, clean, save } = ctx;
let electron, cdp;
try {
  results.step = 'fixture';
  const project = await makeProject(iso);
  await writeAppModels(iso);
  results.step = 'electron';
  ({ electron, cdp } = await launchElectron(iso, project));
  results.observations.electronPid = electron.pid;
  const h = helpers(cdp, ctx);
  results.step = 'open generation';
  const SECTION = await openFrameGeneration(h, cdp);
  const field = `${SECTION} [data-akari-ui="field:inspector-generation-model"]`;
  await h.waitEval(`Boolean(document.querySelector(${S(field)}))`, 'model select', 60_000);
  results.observations.panel = await evalOn(cdp, `(()=>{const s=document.querySelector(${S(SECTION)});const sel=s.querySelector('select[data-akari-ui="field:inspector-generation-model"],[data-akari-ui="field:inspector-generation-model"] select')||document.querySelector(${S(field)});
    return{modelControl:sel?.tagName??null,selected:sel?.selectedOptions?.[0]?.textContent?.trim()??null,selectedTitle:sel?.selectedOptions?.[0]?.title??null,
      options:sel?[...sel.options].map(o=>({text:o.textContent.trim(),title:o.title})):[],
      checkboxes:s.querySelectorAll('input[type="checkbox"]').length,
      actions:[...s.querySelectorAll('[data-akari-generation-action]')].map(b=>({name:b.getAttribute('data-akari-generation-action'),text:b.textContent.trim()})),
      text:s.textContent.replace(/\\s+/g,' ').trim().slice(0,600)}})()`);
  await evalOn(cdp, `(()=>{document.querySelector(${S(field)})?.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
  await h.settle();
  await h.shot('00-before-model-dropdown.png');
  await h.check('BEFORE: モデルはドロップダウン（select）で 1 つだけ', results.observations.panel.modelControl === 'SELECT' && results.observations.panel.options.length > 1,
    { modelControl: results.observations.panel.modelControl, options: results.observations.panel.options.length });
  results.status = results.checks.every(c => c.pass) ? 'pass' : 'fail';
} catch (error) {
  results.status = 'fail';
  results.error = clean(error?.stack ?? error);
  console.error(error);
  process.exitCode = 1;
  if (cdp) await helpers(cdp, ctx).shot('00-before-zz-failure.png').catch(() => undefined);
} finally {
  await save();
  try { cdp?.close(); } catch {}
  await stopElectron(electron);
  await cleanupIso(iso);
}
