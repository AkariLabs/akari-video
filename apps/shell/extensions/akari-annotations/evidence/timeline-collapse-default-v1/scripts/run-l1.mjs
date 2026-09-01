#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP, evalOn, keyPress, listTargets, realClick, realDrag, screenshot
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceDir, evidenceDir] = process.argv;
const port = Number(portArg || 9781);
if (!workspaceDir || !evidenceDir) throw new Error('usage: run-l1.mjs <port> <workspaceDir> <evidenceDir>');
const editPath = path.join(workspaceDir, 'project/edit.json');
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
const domWait = (description, expression) => waitFor(description, () => evalOn(main, expression));
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
// run-log は公開リポにコミットされるので、実行機のパス（ワークスペース・リポジトリ位置）を
// 落としてから書く（Governance ゲートの tracked-file leak scan）。
const redact = value => JSON.parse(JSON.stringify(value)
  .replaceAll(JSON.stringify(workspaceDir).slice(1, -1), '<workspace>')
  .replace(/\\?\/private\\?\/tmp\\?\/[A-Za-z0-9_.-]+/gu, '<scratch>')
  .replace(/\\?\/Users\\?\/[A-Za-z0-9_.-]+/gu, '<home>'));
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
const rect = selector => evalOn(main, `(() => {
  const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return null;
  const r=element.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height,
    right:r.right,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2};
})()`);
const click = async (selector, options = {}) => {
  await domWait(selector, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  let target;
  let hit;
  for (let attempt = 0; attempt < 3; attempt++) {
    await evalOn(main, `document.querySelector(${JSON.stringify(selector)})
      ?.scrollIntoView({block:'center',inline:'nearest'})`);
    await sleep(120);
    target = await rect(selector);
    assert(target?.width > 0 && target?.height > 0,
      'click target is visible', { selector, target, attempt });
    hit = await evalOn(main, `(() => {
      const wanted=document.querySelector(${JSON.stringify(selector)});
      const r=wanted?.getBoundingClientRect();
      const actual=r?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
      return {matches:actual===wanted||wanted?.contains(actual),tag:actual?.tagName,
        html:actual?.outerHTML?.slice(0,240)};
    })()`);
    if (hit.matches) {
      await realClick(main, target.x, target.y, options);
      await sleep(250);
      return;
    }
  }
  assert(false, 'click target is topmost at its center', { selector, target, hit });
};
const shot = async name => {
  await screenshot(main, path.join(evidenceDir, name));
  record('screenshot', { name });
};
async function openTimeline() {
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
  await domWait('timeline tracks rendered', `document.querySelectorAll('.akari-track-header-row').length > 0`);
}

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
    width: 1800, height: 1600, deviceScaleFactor: 1, mobile: false
  });
  await domWait('frontend ready', `document.readyState === 'complete'`);
  const onboarding = await evalOn(main, `(() => {
    const button=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ');
    if(button){button.click();return true}return false
  })()`);
  if (onboarding) await sleep(500);
  await openTimeline();

  const declaredTracks = (await readEdit()).tracks.length;
  const startup = await evalOn(main, `(() => ({
    headerCount:document.querySelectorAll('.akari-track-header-row').length,
    treeHeaderCount:document.querySelectorAll('.akari-track-header-row [data-akari-tree-row-id]').length,
    audioHeaderCount:document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id="collapse-audio-track"]').length,
    audioTreeRows:document.querySelectorAll('.akari-track-header-row[data-akari-timeline-track-id="collapse-audio-track"] [data-akari-tree-row-id]').length,
    group1Toggle:document.querySelector('[data-akari-tree-toggle="collapse-group-1"]')?.textContent,
    disabledToggles:document.querySelectorAll('[data-akari-tree-toggle]:disabled').length
  }))()`);
  assert(startup.headerCount === declaredTracks && startup.audioHeaderCount === 1 && startup.audioTreeRows === 0,
    'startup header count equals track count and 30 SFX keep one audio header', { declaredTracks, startup });
  assert(startup.group1Toggle === '▸' && startup.disabledToggles === 0,
    'pure groups start collapsed and no disabled leaf toggles remain', startup);
  await shot('01-before.png');

  const bagState = await evalOn(main, `(() => ({
    captionToggle:Boolean(document.querySelector('[data-akari-tree-toggle="caps"]')),
    captionTicks:document.querySelectorAll('[data-akari-tree-bag-tick="caps"]').length,
    htmlToggles:[1,2,3].filter(i=>document.querySelector('[data-akari-tree-toggle="collapse-html-bag-'+i+'"]')).length,
    htmlTicks:[1,2,3].map(i=>document.querySelectorAll('[data-akari-tree-bag-tick="collapse-html-bag-'+i+'"]').length),
    bagHeaderRows:[...document.querySelectorAll('.akari-track-header-row [data-akari-tree-row-id]')]
      .filter(e=>e.dataset.akariTreeRowId==='caps'||e.dataset.akariTreeRowId?.startsWith('collapse-html-bag-')).length
  }))()`);
  assert(!bagState.captionToggle && bagState.htmlToggles === 0 && bagState.bagHeaderRows === 0,
    'captions and HTML bags have no toggle or header child rows', bagState);
  assert(bagState.captionTicks === 30 && bagState.htmlTicks.every(count => count === 5),
    'captions and HTML bags remain one-row tick bands', bagState);

  await click('[data-akari-item-kind="caption"][data-akari-item-id="collapse-caption-01"]');
  await domWait('caption bag child selected',
    `document.querySelector('[data-akari-item-kind="caption"][data-akari-item-id="collapse-caption-01"]')
      ?.classList.contains('akari-annotations-selected')===true`);
  const captionSelected = await evalOn(main,
    `document.querySelector('[data-akari-item-kind="caption"][data-akari-item-id="collapse-caption-01"]')?.classList.contains('akari-annotations-selected')`);
  assert(captionSelected, 'caption bag child chip is directly selectable');

  await click('[data-akari-item-id="collapse-html-bag-1"]');
  await domWait('HTML bag selected',
    `document.querySelector('[data-akari-item-id="collapse-html-bag-1"]')
      ?.classList.contains('akari-annotations-selected')===true`);
  const htmlBagSelected = await evalOn(main,
    `document.querySelector('[data-akari-item-id="collapse-html-bag-1"]')?.classList.contains('akari-annotations-selected')`);
  assert(htmlBagSelected, 'HTML bag chip selects the bag itself');
  await sleep(450);
  await click('[data-akari-item-id="collapse-html-bag-1"]', { clickCount: 2 });
  await domWait('bag focus mode', `Boolean(document.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]'))`);
  await domWait('five HTML parts in focus rows', `new Set(
    [...document.querySelectorAll('.akari-track-header-row [data-akari-tree-row-id^="collapse-html-bag-1#"]')]
      .map(element=>element.dataset.akariTreeRowId)).size===5`);
  const focusedHtmlPartRows = await evalOn(main, `[...new Set(
    [...document.querySelectorAll('.akari-track-header-row [data-akari-tree-row-id^="collapse-html-bag-1#"]')]
      .map(element=>element.dataset.akariTreeRowId))]`);
  assert(focusedHtmlPartRows.length === 5,
    'HTML bag exposes its five parts as rows only inside focus mode', { focusedHtmlPartRows });
  record('bag-focus', { entered: true, focusedHtmlPartRows });
  await keyPress(main, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await domWait('returned to global scope', `!document.querySelector('[data-akari-ui="timeline-focus-breadcrumbs"]')`);

  await click('[data-akari-tree-toggle="collapse-group-1"]');
  await domWait('group 1 expanded', `document.querySelectorAll('[data-akari-tree-row-id^="collapse-group-1-child-"]').length===5`);
  const synchronized = await evalOn(main, `(() => {
    const header=document.querySelector('.akari-track-header-row[data-akari-timeline-track-id="collapse-group-track-1"]')?.getBoundingClientRect();
    const lane=document.querySelector('.akari-track-band[data-akari-lane="collapse-group-track-1"]')?.getBoundingClientRect();
    return header&&lane?{header:{top:header.top,height:header.height},lane:{top:lane.top,height:lane.height},
      topDiff:header.top-lane.top,heightDiff:header.height-lane.height}:null;
  })()`);
  // レーン帯の getBoundingClientRect は 1px border を含むため、height だけ 1px 差を許す。
  assert(synchronized?.topDiff === 0 && Math.abs(synchronized?.heightDiff ?? Infinity) <= 1
    && synchronized.header.height >= 120,
  'expanded group header and strip lane align, allowing only the lane border pixel', synchronized);
  await shot('02-after.png');

  await click('[data-akari-tree-toggle="collapse-group-1"]');
  await domWait('group 1 collapsed again', `!document.querySelector('[data-akari-tree-row-id="collapse-group-1-child-1"]')`);
  record('collapse-again', { toggle: await evalOn(main,
    `document.querySelector('[data-akari-tree-toggle="collapse-group-1"]')?.textContent`) });
  await click('[data-akari-tree-toggle="collapse-group-1"]');

  await evalOn(main, 'location.reload()');
  await domWait('frontend reloaded', `document.readyState === 'complete'`);
  await openTimeline();
  await domWait('persisted group 1 expanded', `document.querySelectorAll('[data-akari-tree-row-id^="collapse-group-1-child-"]').length===5`);
  const persistence = await evalOn(main, `({
    group1:document.querySelector('[data-akari-tree-toggle="collapse-group-1"]')?.textContent,
    group2:document.querySelector('[data-akari-tree-toggle="collapse-group-2"]')?.textContent,
    expandedKeys:Object.keys(localStorage).filter(key=>key.includes('akari.timeline.expanded.v1')),
    oldKeys:Object.keys(localStorage).filter(key=>key.includes('akari.timeline.collapsed.v1'))
  })`);
  assert(persistence.group1 === '▾' && persistence.group2 === '▸'
    && persistence.expandedKeys.length === 1 && persistence.oldKeys.length === 0,
  'reload preserves only explicitly expanded pure groups', persistence);

  await click('[data-akari-tree-toggle="collapse-group-2"]');
  await domWait('group 2 expanded', `document.querySelectorAll('[data-akari-tree-row-id^="collapse-group-2-child-"]').length===5`);
  const scrollResult = await evalOn(main, `(() => {
    const strip=document.querySelector('.akari-annotations-strip');
    const scroll=strip?.parentElement;
    if(!scroll)return null;
    scroll.scrollTop=scroll.scrollHeight;
    scroll.dispatchEvent(new Event('scroll'));
    const last=document.querySelector('.akari-track-header-row[data-akari-timeline-track-id="collapse-audio-track"]')?.getBoundingClientRect();
    const viewport=scroll.getBoundingClientRect();
    return last?{last:{top:last.top,bottom:last.bottom,height:last.height},viewport:{top:viewport.top,bottom:viewport.bottom},
      visible:last.bottom>viewport.top&&last.top<viewport.bottom,scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight}:null;
  })()`);
  assert(scrollResult?.visible, 'last audio track remains reachable after two groups expand', scrollResult);

  // (e) で scrollTop を JS から動かした直後の 1 回目のクリックは決定的に食われる
  // （2 回連続で再現・2 回目は必ず選択される）。実ホイール操作ではなく scrollTop 直書き +
  // 合成 scroll イベントで動かした後だけ起きる CDP ハーネス側の癖なので、
  // 選択が付かなかったときだけ 1 回だけ押し直す（クラスが付くことは下の domWait が引き続き要求する）。
  await click('[data-akari-item-id="collapse-sfx-01"]');
  if (!await evalOn(main,
    `document.querySelector('[data-akari-item-id="collapse-sfx-01"]')?.classList.contains('akari-annotations-selected')`)) {
    record('sfx-click-retry', { reason: 'first click after programmatic scroll was swallowed' });
    await click('[data-akari-item-id="collapse-sfx-01"]');
  }
  await domWait('SFX leaf selected',
    `document.querySelector('[data-akari-item-id="collapse-sfx-01"]')
      ?.classList.contains('akari-annotations-selected')===true`);
  const sfxSelected = await evalOn(main,
    `document.querySelector('[data-akari-item-id="collapse-sfx-01"]')?.classList.contains('akari-annotations-selected')`);
  assert(sfxSelected, 'SFX leaf chip click selection still works');
  const sfxBefore = locate(await readEdit(), 'collapse-sfx-01').item.at;
  const sfxRect = await rect('[data-akari-item-id="collapse-sfx-01"]');
  await realDrag(main, [
    { x: sfxRect.x, y: sfxRect.y },
    { x: sfxRect.x + 36, y: sfxRect.y }
  ], { steps: 8, stepDelayMs: 20 });
  await waitFor('SFX drag persisted', async () => locate(await readEdit(), 'collapse-sfx-01').item.at !== sfxBefore);
  const sfxAfter = locate(await readEdit(), 'collapse-sfx-01').item.at;
  assert(sfxAfter !== sfxBefore, 'SFX leaf D&D still writes through', { sfxBefore, sfxAfter });

  await click('[data-akari-item-id="telop-chapter"]');
  const overlayTrackBefore = locate(await readEdit(), 'telop-chapter').track.id;
  await keyPress(main, { key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221 });
  await waitFor('overlay bracket move persisted', async () =>
    locate(await readEdit(), 'telop-chapter').track.id !== overlayTrackBefore);
  const overlayTrackAfter = locate(await readEdit(), 'telop-chapter').track.id;
  assert(overlayTrackAfter !== overlayTrackBefore, 'overlay leaf ] move still works', {
    overlayTrackBefore, overlayTrackAfter
  });
  record('leaf-regression', { sfxBefore, sfxAfter, overlayTrackBefore, overlayTrackAfter });

  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'PASS', finishedAt: new Date().toISOString(), records: redact(records)
  }, null, 2)}\n`);
} catch (error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify({
    status: 'FAIL', finishedAt: new Date().toISOString(),
    error: redact(String(error?.stack ?? error)), records: redact(records)
  }, null, 2)}\n`);
  throw error;
} finally {
  main?.close();
}
