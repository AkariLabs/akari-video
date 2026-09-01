#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP, evalOn, keyPress, listTargets, realClick, screenshot
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9782);
if (!workspaceDir || !evidenceDir) {
  throw new Error('usage: run-l1.mjs <port> <workspaceDir> <evidenceDir>');
}

const repositoryDir = fileURLToPath(new URL('../../../../../../../', import.meta.url));
const editPath = path.join(workspaceDir, 'project/edit.json');
const logPath = path.join(evidenceDir, 'run-log.json');
const detachedCueId = 'c-0003';
const detachedItemId = `cap-${detachedCueId}`;
const controlChips = [
  { id: 'cut-0', selector: '[data-akari-item-kind="cut"][data-akari-item-id="0"]' },
  { id: 'pip-b', selector: '[data-akari-item-kind="layer"][data-akari-item-id="pip-b"]' },
];
const records = [];
let main;

const record = (step, data = {}) => {
  records.push({ t: new Date().toISOString(), step, ...data });
  console.log(`[${step}]`, JSON.stringify(data));
};
const assert = (condition, message, data = {}) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(data)}`);
  record('assertion-ok', { message, ...data });
};
const waitFor = async (description, predicate, timeoutMs = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
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
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const redact = value => {
  let serialized = JSON.stringify(value);
  for (const [root, replacement] of [
    [path.resolve(workspaceDir), '<workspace>'],
    [path.resolve(repositoryDir), '<repository>'],
  ]) serialized = serialized.replace(new RegExp(escapeRegExp(root), 'gu'), replacement);
  serialized = serialized
    .replace(/\/?private\/?tmp\/?[A-Za-z0-9_.-]*/gu, '<scratch>')
    .replace(/\/?Users\/?[A-Za-z0-9_.-]+/gu, '<home>');
  return JSON.parse(serialized);
};
const sameHorizontalGeometry = (before, after) => before?.left === after?.left
  && before?.width === after?.width && before?.height === after?.height;

try {
  await mkdir(evidenceDir, { recursive: true });
  const targets = await listTargets(port);
  const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
    ?? targets.find(entry => entry.type === 'page');
  if (!target) throw new Error('Theia page target not found');
  main = new CDP(target.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Runtime.enable');
  await main.send('Page.enable');
  await main.send('Emulation.setDeviceMetricsOverride', {
    width: 1800, height: 1200, deviceScaleFactor: 1, mobile: false
  });

  const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
  const itemRects = () => evalOn(main, `(() => [...document.querySelectorAll('[data-akari-item-id]')]
    .map((element,index)=>{const rect=element.getBoundingClientRect();return {
      index,id:element.dataset.akariItemId??null,kind:element.dataset.akariItemKind??null,
      className:element.className,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}
    }}))()`);
  const captionRects = cueIds => evalOn(main, `(() => ${JSON.stringify(cueIds)}.map(id=>{
    const element=document.querySelector('[data-akari-item-kind="caption"][data-akari-item-id="'+id+'"]');
    if(!element)return {id,rect:null}; const rect=element.getBoundingClientRect();
    return {id,rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}};
  }))()`);
  const controlRects = () => evalOn(main, `(() => ${JSON.stringify(controlChips)}.map(control=>{
    const element=document.querySelector(control.selector); if(!element)return {...control,rect:null};
    const rect=element.getBoundingClientRect(); return {...control,
      rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}};
  }))()`);
  const elementCenter = selector => evalOn(main, `(() => {
    const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return null;
    const rect=element.getBoundingClientRect();
    return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height};
  })()`);
  const click = async selector => {
    await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const target = await elementCenter(selector);
    assert(target?.width > 0 && target?.height > 0, 'click target is visible', { selector, target });
    await realClick(main, target.x, target.y);
    await sleep(250);
  };
  const openTimeline = async () => {
    let opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
      await sleep(250);
      await main.send('Input.insertText', { text: 'タイムラインを開く' });
      await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(1200);
      opened = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    }
    assert(opened, 'timeline opened');
  };

  await domWait('frontend ready', `document.readyState === 'complete'`);
  const onboarding = await evalOn(main, `(() => {
    const button=[...document.querySelectorAll('button')].find(element=>element.textContent?.trim()==='開くだけ');
    if(button){button.click();return true}return false
  })()`);
  if (onboarding) await sleep(500);
  await openTimeline();
  await domWait('caption bag chips',
    `Boolean(document.querySelector('[data-akari-item-kind="caption"][data-akari-item-id="${detachedCueId}"]'))`);

  const cueIds = await evalOn(main,
    `[...document.querySelectorAll('[data-akari-item-kind="caption"][data-akari-item-id]')]
      .map(element=>element.dataset.akariItemId).filter(Boolean).sort()`);
  const remainingCueIds = cueIds.filter(id => id !== detachedCueId);
  const beforeAll = await itemRects();
  const beforeRemaining = await captionRects(remainingCueIds);
  const beforeControls = await controlRects();
  assert(beforeRemaining.every(entry => entry.rect), 'all remaining caption chips have BEFORE rectangles', {
    remainingCueIds, beforeRemaining
  });
  assert(beforeControls.every(entry => entry.rect), 'unrelated control chips have BEFORE rectangles', {
    beforeControls
  });
  record('before', {
    allItemRects: beforeAll, remainingCaptionRects: beforeRemaining, controlChipRects: beforeControls
  });
  await screenshot(main, path.join(evidenceDir, '01-before.png'));

  const sourceSelector = `[data-akari-item-kind="caption"][data-akari-item-id="${detachedCueId}"]`;
  const sourceTarget = await elementCenter(sourceSelector);
  assert(sourceTarget?.width > 0 && sourceTarget?.height > 0,
    'caption bag child is visible for context menu', { sourceTarget });
  await evalOn(main, `(() => {
    const element=document.querySelector(${JSON.stringify(sourceSelector)});
    element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,
      clientX:${JSON.stringify(sourceTarget.x)},clientY:${JSON.stringify(sourceTarget.y)}}));
  })()`);
  await domWait('detach menu',
    `[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='出す')`);
  await evalOn(main,
    `[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='出す').click()`);
  await waitFor('detached caption saved', async () => {
    const doc = await readEdit();
    return locate(doc, detachedItemId)?.item?.source?.kind === 'caption'
      && locate(doc, 'caps')?.item?.source?.exclude?.includes(detachedCueId);
  });
  await domWait('exactly one detached caption chip',
    `document.querySelectorAll('[data-akari-item-id="${detachedItemId}"]').length===1`);

  const detachedState = await evalOn(main, `(() => {
    const chips=[...document.querySelectorAll('[data-akari-item-id="${detachedItemId}"]')];
    return {count:chips.length,label:chips[0]?.textContent?.trim()??null,
      itemKind:chips[0]?.dataset.akariItemKind??null,
      treeItemKind:chips[0]?.dataset.akariTreeItemKind??null,
      headerCount:document.querySelectorAll(
        '.akari-track-header-row [data-akari-tree-row-id="${detachedItemId}"]').length};
  })()`);
  assert(detachedState.count === 1 && detachedState.itemKind === 'item'
    && detachedState.treeItemKind === 'caption' && detachedState.headerCount === 0,
  'detached caption is exactly one strip chip and not a header row', detachedState);
  assert(detachedState.label === 'この行を「出す」対象にする',
    'detached caption label comes from captions.json', detachedState);
  const afterRemaining = await captionRects(remainingCueIds);
  const remainingGeometry = beforeRemaining.map((before, index) => ({
    id: before.id,
    before: before.rect,
    after: afterRemaining[index]?.rect ?? null,
    deltaTop: before.rect && afterRemaining[index]?.rect
      ? afterRemaining[index].rect.top - before.rect.top : null,
  }));
  const remainingDeltaTops = [...new Set(remainingGeometry.map(entry => entry.deltaTop))];
  const deltaTop = remainingDeltaTops.length === 1 && typeof remainingDeltaTops[0] === 'number'
    ? remainingDeltaTops[0] : null;
  const afterControls = await controlRects();
  const controlDeltas = beforeControls.map((before, index) => ({
    id: before.id,
    before: before.rect,
    after: afterControls[index]?.rect ?? null,
    deltaTop: before.rect && afterControls[index]?.rect
      ? afterControls[index].rect.top - before.rect.top : null,
  }));
  record('remaining-caption-geometry', {
    beforeRemaining,
    afterRemaining,
    deltaTop,
    controlDeltas,
  });
  assert(remainingGeometry.every(entry => sameHorizontalGeometry(entry.before, entry.after)),
    'remaining caption chips keep identical left, width, and height', { remainingGeometry });
  assert(deltaTop !== null,
    'remaining caption chips share one top delta', { remainingGeometry, remainingDeltaTops });
  const cutControl = controlDeltas.find(control => control.id === 'cut-0');
  assert(cutControl?.deltaTop === deltaTop,
    'remaining caption top delta matches an unrelated control chip', { deltaTop, controlDeltas });

  const detachedSelector = `[data-akari-item-id="${detachedItemId}"]`;
  await click(detachedSelector);
  await domWait('detached caption selected',
    `document.querySelector(${JSON.stringify(detachedSelector)})
      ?.classList.contains('akari-annotations-selected')===true`);
  await domWait('detached caption shown in inspector',
    `[...document.querySelectorAll('.akari-inspector-widget .akari-inspector-row')].some(row=>
      row.querySelector('.akari-inspector-row-label')?.textContent?.trim()==='clip'
      && row.querySelector('.akari-inspector-row-value')?.textContent?.includes('${detachedCueId}'))`);
  const inspector = await evalOn(main, `(() => {
    const clipRow=[...document.querySelectorAll('.akari-inspector-widget .akari-inspector-row')].find(row=>
      row.querySelector('.akari-inspector-row-label')?.textContent?.trim()==='clip');
    const widget=document.querySelector('.akari-inspector-widget'); const rect=widget?.getBoundingClientRect();
    return {selected:document.querySelector(${JSON.stringify(detachedSelector)})
      ?.classList.contains('akari-annotations-selected')===true,
      captionId:clipRow?.querySelector('.akari-inspector-row-value')?.textContent?.trim()??null,
      visible:Boolean(rect&&rect.width>0&&rect.height>0)};
  })()`);
  assert(inspector.selected && inspector.visible && inspector.captionId?.includes(detachedCueId),
    'detached caption selection is reflected in the inspector', inspector);

  const beforeY = locate(await readEdit(), detachedItemId).item.transform?.y;
  await keyPress(main, {
    key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, modifiers: 1
  });
  await waitFor('Alt+ArrowDown persisted transform.y', async () =>
    locate(await readEdit(), detachedItemId)?.item?.transform?.y === (beforeY ?? 0) + 1);
  const afterY = locate(await readEdit(), detachedItemId).item.transform?.y;
  assert(afterY === (beforeY ?? 0) + 1,
    'Alt+ArrowDown writes transform.y on the detached caption item', { beforeY: beforeY ?? null, afterY });

  const afterAll = await itemRects();
  record('after', {
    detachedItemId, detachedState, inspector, transformY: afterY,
    allItemRects: afterAll, remainingCaptionRects: afterRemaining,
    deltaTop, controlDeltas
  });
  await screenshot(main, path.join(evidenceDir, '02-after.png'));

  await writeFile(logPath, `${JSON.stringify(redact({
    status: 'PASS', finishedAt: new Date().toISOString(), records
  }), null, 2)}\n`);
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(logPath, `${JSON.stringify(redact({
    status: 'FAIL', finishedAt: new Date().toISOString(),
    error: String(error?.stack ?? error), records
  }), null, 2)}\n`);
  throw error;
} finally {
  main?.close();
}
