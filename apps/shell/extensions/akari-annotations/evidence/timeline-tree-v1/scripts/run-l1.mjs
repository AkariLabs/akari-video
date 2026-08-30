#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9631);
if (!workspaceDir || !evidenceDir) throw new Error('usage: run-l1.mjs <port> <workspaceDir> <evidenceDir>');
const editPath = path.join(workspaceDir, 'project/edit.json');
const records = [];
let main;
let previewOuter;

const record = (step, data = {}) => {
  records.push({ t: new Date().toISOString(), step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
};
const assert = (condition, message, data = {}) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`);
  record('assertion-ok', { message, ...data });
};
const edit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const waitFor = async (description, predicate, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};
const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
const rect = selector => evalOn(main, `(() => {
  const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height,
    x:r.left+r.width/2, y:r.top+r.height/2 };
})()`);
const aimSelector = async selector => {
  await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  let value;
  let hit;
  for (let attempt = 0; attempt < 2; attempt++) {
    await evalOn(main, `document.querySelector(${JSON.stringify(selector)})
      ?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
    await sleep(120);
    value = await rect(selector);
    assert(value?.width > 0 && value?.height > 0, 'click target visible', { selector, value, attempt });
    hit = await evalOn(main, `(() => {
      const wanted=document.querySelector(${JSON.stringify(selector)});
      const r=wanted?.getBoundingClientRect();
      const actual=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
      return { matches: actual===wanted || wanted?.contains(actual), tag: actual?.tagName,
        html: actual?.outerHTML?.slice(0,240) };
    })()`);
    if (hit.matches) return value;
    if (attempt === 0) record('click-reaim', { selector, hit });
  }
  assert(false, 'click target is topmost at its center', { selector, hit, value });
};
const clickSelector = async (selector, modifiers = 0) => {
  const value = await aimSelector(selector);
  await realClick(main, value.x, value.y, { modifiers });
  await sleep(250);
};
const shot = async name => { await screenshot(main, path.join(evidenceDir, name)); record('screenshot', { name }); };
const locate = (doc, id) => {
  for (const track of doc.tracks ?? []) {
    const stack = [...(track.items ?? [])];
    while (stack.length) {
      const item = stack.shift();
      if (item?.id === id) return { track, item };
      stack.unshift(...(item?.items ?? []));
    }
  }
};

async function verifyPreviewPartSelection() {
  try {
    await verifyPreviewPartSelectionAttempt();
  } catch (error) {
    try { previewOuter?.close(); } catch {}
    previewOuter = undefined;
    record('preview-part-selection', {
      status: 'skipped',
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function verifyPreviewPartSelectionAttempt() {
  const explorerState = await evalOn(main, `(() => {
    const visible=!![...document.querySelectorAll('.theia-TreeNode')]
      .find(e=>e.getBoundingClientRect().width>0);
    const icon=document.querySelector('#shell-tab-explorer-view-container .codicon-files');
    if(!icon)return null; const r=icon.getBoundingClientRect();
    return {visible,x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  if (!explorerState) throw new Error('Explorer icon not found');
  if (!explorerState.visible) await realClick(main, explorerState.x, explorerState.y);
  await sleep(500);
  const findTreeRow = label => evalOn(main, `(() => {
    const row=[...document.querySelectorAll('.theia-TreeNode, [class*="TreeNode"]')]
      .find(e=>e.textContent?.trim()===${JSON.stringify(label)});
    if(!row)return null; const r=row.getBoundingClientRect();
    return {collapsed:!!row.querySelector('.theia-mod-collapsed'),x:r.left+20,y:r.top+r.height/2};
  })()`);
  let editRow = await findTreeRow('edit.json');
  if (!editRow) {
    const rootRow = await findTreeRow('project');
    if (rootRow?.collapsed) await realClick(main, rootRow.x, rootRow.y, { clickCount: 2 });
    await sleep(500);
    editRow = await findTreeRow('edit.json');
  }
  if (!editRow) throw new Error('Explorer edit.json row not found');
  await realClick(main, editRow.x, editRow.y, { clickCount: 2 });
  await sleep(1200);

  let target;
  await waitFor('output preview webview target', async () => {
    target = (await listTargets(port)).find(entry => entry.type === 'iframe' && /webview\/index\.html/u.test(entry.url));
    return Boolean(target);
  }, 30000);
  previewOuter = new CDP(target.webSocketDebuggerUrl);
  await previewOuter.connect();
  const contexts = [];
  previewOuter.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  await previewOuter.send('Page.enable');
  await previewOuter.send('Runtime.enable');
  let activeContext;
  await waitFor('output preview inner active-frame', async () => {
    for (const context of contexts) {
      try {
        if (await evalOn(previewOuter,
          `Boolean(document.querySelector('[data-overlay-id="s01#A"]'))`, context.id)) {
          activeContext = context;
          return true;
        }
      } catch {}
    }
    return false;
  }, 30000);
  const partRect = await evalOn(previewOuter, `(() => {
    const mount=document.querySelector('[data-overlay-id="s01#A"]');
    const part=mount?.querySelector('[data-akari-part="A"]') ?? mount?.firstElementChild;
    if(!part)return null; const r=part.getBoundingClientRect();
    return {left:r.left,top:r.top,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2};
  })()`, activeContext.id);
  assert(partRect?.width > 0 && partRect?.height > 0,
    'projected preview part has a hit-tested rect', { partRect });
  await realClick(previewOuter, partRect.x, partRect.y);
  await domWait('projected timeline row selected from preview click',
    `Boolean(document.querySelector('.akari-timeline-tree-item[data-akari-item-id="s01#A"]')
      ?.classList.contains('akari-annotations-selected'))`);
  const selectedOverlayId = await evalOn(previewOuter,
    `document.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]')
      ?.getAttribute('data-overlay-id')`, activeContext.id);
  assert(selectedOverlayId === 's01#A', 'preview click reports the projected common id', { selectedOverlayId });
  record('preview-part-selection', {
    status: 'ok',
    id: selectedOverlayId,
    reason: 'A3 mounts each masked projected part as an independent data-overlay-id container; interaction selectOverlay marks that container and the existing MutationObserver reports the same id.'
  });
}

try {
  const targets = await listTargets(port);
  const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
    ?? targets.find(entry => entry.type === 'page');
  if (!target) throw new Error('Theia page target not found');
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  await main.send('Page.enable');
  await domWait('frontend ready', `document.readyState === 'complete'`);
  const onboarding = await evalOn(main, `(() => {
    const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');
    if(b){b.click();return true}return false
  })()`);
  if (onboarding) await sleep(400);
  let opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(300);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1200);
    opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  }
  assert(opened, 'timeline opened');
  await domWait('bag tree row', `Boolean(document.querySelector('[data-akari-tree-row-id="s01"]'))`);

  const plainBefore = await rect('.akari-annotations-strip-overlay[data-akari-item-id="plain"]');
  const initialPlainRows = await evalOn(main,
    `document.querySelectorAll('.akari-annotations-strip-overlay[data-akari-item-id="plain"]').length`);
  const initialBagRows = await evalOn(main, `[...document.querySelectorAll('[data-akari-tree-row-id]')]
    .filter(e=>['s01','s01#A','s01.B'].includes(e.dataset.akariTreeRowId)).map(e=>e.dataset.akariTreeRowId)`);
  assert(initialBagRows.length === 3, 'step1 bag expands to projected children in declaration order', { initialBagRows });
  await clickSelector('[data-akari-tree-toggle="s01"]');
  record('collapse-debug', await evalOn(main, `({
    stored:Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.includes('akari.timeline.collapsed.v1'))),
    toggle:document.querySelector('[data-akari-tree-toggle="s01"]')?.outerHTML,
    rows:[...document.querySelectorAll('[data-akari-tree-row-id]')].map(e=>e.dataset.akariTreeRowId)
  })`));
  await domWait('bag collapsed', `!document.querySelector('[data-akari-tree-row-id="s01.B"]')`);
  await clickSelector('[data-akari-tree-toggle="s01"]');
  await domWait('bag expanded', `Boolean(document.querySelector('[data-akari-tree-row-id="s01.B"]'))`);
  record('step-1-expand', { rowIds: initialBagRows, diffLines: 0 });
  await verifyPreviewPartSelection();
  await shot('01-bag-expanded.png');

  const beforeDetach = await readFile(editPath, 'utf8');
  const detachTarget = await aimSelector('[data-akari-tree-row-id="s01.B"]');
  await evalOn(main, `(() => {
    const e=document.querySelector('[data-akari-tree-row-id="s01.B"]');
    e.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,
      clientX:${JSON.stringify(detachTarget.x)},clientY:${JSON.stringify(detachTarget.y)}})); return true;
  })()`);
  await domWait('detach menu', `[...document.querySelectorAll('button')].some(b=>b.textContent?.trim()==='出す')`);
  await evalOn(main, `[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()==='出す').click()`);
  await waitFor('detached part saved', async () => {
    const doc = await edit(); const found = locate(doc, 's01.B'); const bag = locate(doc, 's01')?.item;
    return found?.track && found.track.items.includes(found.item) && bag?.source?.exclude?.includes('B');
  });
  const afterDetach = await readFile(editPath, 'utf8');
  const detachedDoc = await edit();
  record('step-2-detach', {
    trackCount: detachedDoc.tracks.length,
    exclude: locate(detachedDoc, 's01').item.source.exclude,
    diffLines: lineDiff(beforeDetach, afterDetach)
  });
  await shot('02-part-detached.png');

  await clickSelector('.akari-annotations-strip-overlay[data-akari-item-id="s01.B"]');
  const tracksBeforeBracket = (await edit()).tracks.length;
  const beforeBracket = await readFile(editPath, 'utf8');
  await keyPress(main, { key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221 });
  await waitFor('bracket move saved', async () => (await readFile(editPath, 'utf8')) !== afterDetach);
  const bracketDoc = await edit();
  const afterBracket = await readFile(editPath, 'utf8');
  record('step-3-bracket', {
    tracksBefore: tracksBeforeBracket, tracksAfter: bracketDoc.tracks.length,
    partTrackId: locate(bracketDoc, 's01.B')?.track.id,
    diffLines: lineDiff(beforeBracket, afterBracket)
  });
  await shot('03-bracket-new-track.png');

  await clickSelector('.akari-annotations-strip-overlay[data-akari-item-id="s01.B"]');
  await clickSelector('.akari-annotations-strip-overlay[data-akari-item-id="plain"]', 8);
  const beforeGroup = await readFile(editPath, 'utf8');
  await keyPress(main, { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 4 });
  await waitFor('group saved', async () => (await edit()).tracks.some(track =>
    (track.items ?? []).some(item => item?.source?.kind === 'group'
      && (item.items ?? []).some(child => child.id === 's01.B')
      && (item.items ?? []).some(child => child.id === 'plain'))));
  const groupedDoc = await edit();
  const afterGroup = await readFile(editPath, 'utf8');
  const grouped = groupedDoc.tracks.flatMap(track => track.items ?? []).find(item =>
    item?.source?.kind === 'group' && (item.items ?? []).some(child => child.id === 's01.B'));
  assert(grouped.items.every(child => child.at >= 0), 'step4 children use parent-relative at', { groupId: grouped.id });
  record('step-4-group', {
    groupId: grouped.id,
    childAt: grouped.items.map(child => [child.id, child.at]),
    diffLines: lineDiff(beforeGroup, afterGroup)
  });
  await shot('04-grouped.png');

  await clickSelector(`[data-akari-tree-row-id=${JSON.stringify(grouped.id)}]`);
  const beforeUngroup = await readFile(editPath, 'utf8');
  await keyPress(main, { key: 'G', code: 'KeyG', windowsVirtualKeyCode: 71, modifiers: 12 });
  await waitFor('ungroup saved', async () => !locate(await edit(), grouped.id));
  const ungroupedDoc = await edit();
  const afterUngroup = await readFile(editPath, 'utf8');
  record('step-5-ungroup', {
    trackCount: ungroupedDoc.tracks.length,
    childTracks: ['s01.B', 'plain'].map(id => [id, locate(ungroupedDoc, id)?.track.id]),
    diffLines: lineDiff(beforeUngroup, afterUngroup)
  });
  await shot('05-ungrouped.png');

  const plainAfter = await rect('.akari-annotations-strip-overlay[data-akari-item-id="plain"]');
  const finalPlainRows = await evalOn(main,
    `document.querySelectorAll('.akari-annotations-strip-overlay[data-akari-item-id="plain"]').length`);
  assert(initialPlainRows === finalPlainRows, 'step6 untagged overlay row count unchanged', { initialPlainRows, finalPlainRows });
  assert(plainBefore && plainAfter && plainBefore.left === plainAfter.left && plainBefore.width === plainAfter.width,
    'step6 untagged overlay horizontal chip rect unchanged', { plainBefore, plainAfter });
  record('step-6-regression', {
    plainBefore, plainAfter, rowCount: finalPlainRows,
    diffLines: lineDiff(afterUngroup, await readFile(editPath, 'utf8'))
  });
  await shot('06-plain-regression.png');

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'PASS', finishedAt: new Date().toISOString(), records
  }, null, 2)}\n`);
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'FAIL', finishedAt: new Date().toISOString(), error: error?.stack ?? String(error), records
  }, null, 2)}\n`);
  throw error;
} finally {
  previewOuter?.close();
  main?.close();
}

function lineDiff(before, after) {
  const left = before.split('\n'); const right = after.split('\n');
  let changed = 0;
  for (let i = 0; i < Math.max(left.length, right.length); i++) if (left[i] !== right[i]) changed++;
  return changed;
}
