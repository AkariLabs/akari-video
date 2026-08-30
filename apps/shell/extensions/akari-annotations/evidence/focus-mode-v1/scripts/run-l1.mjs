#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';
import { resolveOsrLauncher } from '../../../../../../../packages/osr-export/src/index.mjs';

const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9633);
if (!workspaceDir || !evidenceDir) throw new Error('usage: run-l1.mjs <port> <workspaceDir> <evidenceDir>');
const editPath = path.join(workspaceDir, 'project/edit.json');
const records = [];
const run = promisify(execFile);
const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
let main;
const record = (step, data = {}) => { records.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
const assert = (condition, message, data = {}) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`); };
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const waitFor = async (description, predicate, timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};
const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
const rect = selector => evalOn(main, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
  if(!e)return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
const click = async (selector, options = {}) => {
  await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await evalOn(main, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`);
  const target = await rect(selector);
  assert(target?.width > 0 && target?.height > 0, 'click target visible', { selector, target });
  await realClick(main, target.x, target.y, options);
  await sleep(250);
};
const doubleAtRatio = async (selector, ratio) => {
  const target = await rect(selector);
  assert(target?.width > 0, 'double-click target visible', { selector, target });
  await realClick(main, target.left + target.width * ratio, target.y, { clickCount: 2 });
  await sleep(500);
};
const locate = (doc, id) => {
  for (const track of doc.tracks ?? []) {
    const stack = (track.items ?? []).map(item => ({ item, parentId: undefined }));
    while (stack.length) {
      const { item, parentId } = stack.shift();
      if (item?.id === id) return { item, track, parentId };
      stack.unshift(...(item?.items ?? []).map(child => ({ item: child, parentId: item.id })));
    }
  }
};
const shot = async name => { await screenshot(main, path.join(evidenceDir, name)); };

async function clickPreviewPart(partId) {
  const editUri = `file://${editPath}`;
  const opened = await evalOn(main, `(async () => {
    const bindings=window.theia.container._bindingDictionary;
    const C=[...bindings._map.keys()].find(key=>typeof key==='function'
      && typeof key.prototype?.executeCommand==='function' && typeof key.prototype?.registerCommand==='function');
    if(!C)return false; await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible',
      {editUri:${JSON.stringify(editUri)}}); return true;
  })()`);
  assert(opened, 'output preview opened');
  let target;
  await waitFor('output preview target', async () => {
    target = (await listTargets(port)).find(entry => entry.type === 'iframe' && /webview\/index\.html/u.test(entry.url));
    return Boolean(target);
  });
  const preview = new CDP(target.webSocketDebuggerUrl);
  await preview.connect();
  const contexts = [];
  preview.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await preview.send('Page.enable'); await preview.send('Runtime.enable');
  let context;
  await waitFor('preview part mount', async () => {
    for (const candidate of contexts) {
      try {
        if (await evalOn(preview, `Boolean(document.querySelector('[data-overlay-id=${JSON.stringify(partId)}]'))`, candidate.id)) {
          context = candidate; return true;
        }
      } catch {}
    }
    return false;
  });
  const partName = partId.includes('#') ? partId.substring(partId.lastIndexOf('#') + 1) : partId;
  const part = await evalOn(preview, `(() => {
    const mount=document.querySelector('[data-overlay-id=${JSON.stringify(partId)}]');
    const e=mount?.querySelector('[data-akari-part=${JSON.stringify(partName)}]') ?? mount?.firstElementChild ?? mount;
    const r=e?.getBoundingClientRect();
    return r?{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}:null;
  })()`, context.id);
  assert(part?.width > 0 && part?.height > 0, 'preview part visible', { part });
  await realClick(preview, part.x, part.y);
  await domWait('preview click selects timeline row',
    `document.querySelector('[data-akari-item-id=${JSON.stringify(partId)}]')?.classList.contains('akari-annotations-selected')`);
  preview.close();
  return partId;
}

try {
  await rm(path.join(evidenceDir, 'capture'), { recursive: true, force: true });
  const targets = await listTargets(port);
  const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
    ?? targets.find(entry => entry.type === 'page');
  if (!target) throw new Error('Theia page target not found');
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect(); await main.send('Runtime.enable'); await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 1400, deviceScaleFactor: 1, mobile: false
  });
  await domWait('frontend ready', `document.readyState === 'complete'`);
  await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); })()`);
  for (let attempt = 0; attempt < 3 && !await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`); attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 }); await sleep(200);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(1000);
  }
  await domWait('group row', `Boolean(document.querySelector('[data-akari-tree-row-id="g1"]'))`);

  await click('[data-akari-tree-row-id="g1"]', { clickCount: 2 });
  await domWait('focus breadcrumb', `document.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]')?.textContent.includes('g1')`);
  const focusState = await evalOn(main, `({crumb:document.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]')?.textContent,
    rows:[...document.querySelectorAll('[data-akari-tree-row-id]')].map(e=>e.dataset.akariTreeRowId), zoom:document.querySelector('[data-testid="akari-timeline-zoom-percent"]')?.textContent})`);
  assert(focusState.rows.every(id => id === 'g1' || id.startsWith('g1.')), 'focus shows subtree only', focusState);
  record('step-1-focus', focusState); await shot('01-focus.png');

  await click('[data-akari-tree-row-id="g1.first"]');
  const propertySelector = '[data-akari-keyframe-property-row="g1.first:transform.x"]';
  await doubleAtRatio(propertySelector, 0.01);
  await waitFor('two endpoints saved', async () => locate(await edit(), 'g1.first')?.item.keyframes?.length === 2);
  const step2Points = locate(await edit(), 'g1.first').item.keyframes;
  assert(step2Points.map(point => point.t).join(',') === '0,45', 'first double click creates endpoint pair only', { step2Points });
  record('step-2-two-keyframes', { points: step2Points });

  await click('[data-akari-keyframe-item="g1.first"][data-akari-keyframe-property="transform.x"][data-akari-keyframe-t="45"]');
  await domWait('easing section', `Boolean(document.querySelector('[data-akari-ui="section:inspector-easing"] select'))`);
  await evalOn(main, `(() => { const s=document.querySelector('[data-akari-ui="section:inspector-easing"] select'); s.value='ease-in-out'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor('easing saved', async () => JSON.stringify(locate(await edit(), 'g1.first')?.item.keyframes).includes('ease-in-out'));
  await domWait('easing current value reflected',
    `document.querySelector('[data-akari-ui="field:inspector-segment-easing"]')?.value === 'ease-in-out'`);
  const hoverPreview = await evalOn(main, `(() => new Promise(resolve => {
    const done=event=>{window.removeEventListener('akari.timeline.liveTransform',done);resolve(event.detail)};
    window.addEventListener('akari.timeline.liveTransform',done);
    document.querySelector('[data-akari-easing-preview="out-cubic"]')
      ?.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
    setTimeout(()=>{window.removeEventListener('akari.timeline.liveTransform',done);resolve(null)},1000);
  }))()`);
  assert(hoverPreview?.easing === 'out-cubic', 'easing hover uses live preview channel', { hoverPreview });
  record('step-3-easing', {
    easing: locate(await edit(), 'g1.first').item.keyframes.at(-1).easing,
    inspectorValue: 'ease-in-out', hoverPreview
  });

  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500);
  const allRows = await evalOn(main, `[...document.querySelectorAll('[data-akari-tree-row-id]')].map(e=>e.dataset.akariTreeRowId)`);
  assert(allRows.includes('plain') && allRows.includes('s01'), 'Escape restores all rows', { allRows });
  record('step-4-escape', { allRows });

  let doc = await edit();
  assert(Array.isArray(locate(doc, 'g1.first').item.keyframes) && locate(doc, 'g1.first').item.keyframes.length === 2,
    'two points remain inline');
  record('step-5-inline-canonical', { line: (await readFile(editPath, 'utf8')).split('\n').find(line => line.includes('"id": "g1.first"')) });

  await click('[data-akari-tree-row-id="g1"]', { clickCount: 2 });
  await click('[data-akari-tree-row-id="g1.first"]');
  await domWait('transform X inspector input',
    `Boolean(document.querySelector('[data-akari-ui="field:inspector-transform-x"] .akari-inspector-number-input'))`);
  await evalOn(main, `(() => { const input=document.querySelector('[data-akari-ui="field:inspector-transform-x"] .akari-inspector-number-input');
    input.value='110'; input.dispatchEvent(new Event('blur',{bubbles:true})); })()`);
  await waitFor('static transform value saved', async () => locate(await edit(), 'g1.first')?.item.transform?.x === 110);
  await doubleAtRatio(propertySelector, 0.999);
  for (const ratio of [0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84]) await doubleAtRatio(propertySelector, ratio);
  await waitFor('nine points distributed', async () => !Array.isArray(locate(await edit(), 'g1.first')?.item.keyframes));
  doc = await edit();
  const reference = locate(doc, 'g1.first').item.keyframes;
  const motion = JSON.parse(await readFile(path.join(workspaceDir, 'project', reference.path), 'utf8'));
  assert(reference.count === 9 && motion.items['g1.first'].length === 9, 'nine points use motion bag', { reference });
  record('step-6-motion-bag', { reference, count: motion.items['g1.first'].length }); await shot('06-nine-points.png');

  const xValues = motion.items['g1.first'].filter(point => point.transform?.x !== undefined).map(point => point.transform.x);
  const captureDir = path.join(workspaceDir, 'project', '.akari', 'reports', 'capture', 'focus-mode-v1');
  const osrLauncher = await resolveOsrLauncher();
  assert(osrLauncher && [1, 2].includes(osrLauncher.tier), 'OSR launcher is tier 1 or 2', { osrLauncher });
  await run(process.execPath, [path.join(repositoryDir, 'packages/akari-tools/bin/capture.mjs'),
    '-p', path.join(workspaceDir, 'project'), '-t', '1.1', '2.4', '--engine', 'osr', '--separate', '--out', captureDir],
  { cwd: repositoryDir, maxBuffer: 10 * 1024 * 1024 });
  const pngs = (await readdir(captureDir)).filter(name => name.endsWith('.png')).sort();
  const hashes = await Promise.all(pngs.slice(0, 2).map(async name =>
    createHash('sha256').update(await readFile(path.join(captureDir, name))).digest('hex')));
  const captureManifest = JSON.parse(await readFile(path.join(captureDir, 'capture.json'), 'utf8'));
  assert(captureManifest.engine?.resolved === 'osr', 'capture receipt resolves OSR', { engine: captureManifest.engine });
  assert(pngs.length >= 2, 'OSR capture produces two PNG frames', { pngs, hashes });
  await copyFile(path.join(captureDir, pngs[0]), path.join(evidenceDir, '07-t1.png'));
  await copyFile(path.join(captureDir, pngs[1]), path.join(evidenceDir, '07-t2.png'));
  const sameFrame = hashes[0] === hashes[1];
  record('step-7-osr-samples', {
    status: sameFrame ? 'known-gap' : 'ok',
    xValues, pngs, hashes, engine: captureManifest.engine,
    osr: { launcher_tier: osrLauncher.tier, verify: captureManifest.verify },
    ...(sameFrame ? {
      reason: 'HTML 部品は overlays[] に射影され layers.mjs のキーフレーム合成を受けないため。修正には編集禁止の render-cut / osr-export が必要。'
    } : {})
  });

  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
  await click('[data-akari-item-kind="cut"][data-akari-item-id="0"]', { clickCount: 2 });
  await domWait('source trimmer', `Boolean(document.querySelector('.akari-annotations-strip-clip-trimmer-active'))`);
  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  record('step-8-video-trimmer', { status: 'opened-and-closed' });

  await click('[data-akari-tree-row-id="plain"]');
  await domWait('single row inspector',
    `Boolean(document.querySelector('[data-akari-tree-row-id="plain"].akari-annotations-selected')
      && document.querySelector('[data-akari-ui="section:inspector-transform"]')
      && document.querySelector('[data-akari-ui="inspector-kf-seat:transform-x"]'))`);
  record('step-9-single-row-selection', {
    selected: 'plain', sections: await evalOn(main,
      `[...document.querySelectorAll('.akari-inspector-section')].map(e=>e.dataset.akariUi)`)
  });

  const previewSelection = await clickPreviewPart('s01#A');
  record('step-10-preview-part-selection', { status: 'selected', id: previewSelection });

  await evalOn(main, `document.querySelector('[data-akari-tree-row-id="plain"]')?.scrollIntoView({block:'center'})`);
  const from = await rect('[data-akari-tree-row-id="plain"]');
  const to = await rect('[data-akari-tree-row-id="s01"]');
  assert(from?.width > 0 && to?.width > 0, 'row header D&D targets visible', { from, to });
  await realDrag(main, [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
  await waitFor('row header D&D saved', async () => locate(await edit(), 'plain')?.parentId === 's01');
  const moved = locate(await edit(), 'plain');
  assert(moved?.parentId === 's01', 'row header D&D reparents the item', { movedParent: moved?.parentId });
  record('step-11-row-header-dnd', { from: 'plain', to: 's01', savedParent: moved.parentId });

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({ status: 'PASS', records }, null, 2)}\n`);
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({ status: 'FAIL', error: error?.stack ?? String(error), records }, null, 2)}\n`);
  throw error;
} finally { main?.close(); }
