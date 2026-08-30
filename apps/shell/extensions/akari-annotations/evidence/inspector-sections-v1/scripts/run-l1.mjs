#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CDP,
  evalOn,
  keyPress,
  listTargets,
  realClick,
  realDrag,
  screenshot
} from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , cdpPortArg, workspaceDir, evidenceDir] = process.argv;
const cdpPort = Number(cdpPortArg || 9623);
if (!workspaceDir || !evidenceDir) {
  throw new Error('usage: run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>');
}

const projectDir = path.join(workspaceDir, 'project');
const editPath = path.join(projectDir, 'edit.json');
const runLogPath = path.join(evidenceDir, 'run-log.json');
const log = [];
let main;

function record(step, data) {
  const entry = { t: new Date().toISOString(), step, ...data };
  log.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data = {}) {
  if (!condition) {
    record('ASSERTION-FAILED', { message, ...data });
    throw new Error(`assertion failed: ${message} :: ${JSON.stringify(data)}`);
  }
  record('assertion-ok', { message, ...data });
}

async function persistRunLog(status, error) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(runLogPath, `${JSON.stringify({
    status,
    finishedAt: new Date().toISOString(),
    ...(error ? { error: error instanceof Error ? error.stack ?? error.message : String(error) } : {}),
    records: log
  }, null, 2)}\n`);
}

async function waitFor(description, expression, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evalOn(main, expression)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function dismissOnboardingIfPresent() {
  const dismissed = await evalOn(main, `(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find(candidate => candidate.textContent?.trim() === '開くだけ');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  record(dismissed ? 'onboarding-modal-dismissed' : 'onboarding-modal-absent', {});
  if (dismissed) await sleep(500);
  return dismissed;
}

async function openTimeline() {
  let found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !found; attempt++) {
    await keyPress(main, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(400);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(400);
    await keyPress(main, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 30 && !found; wait++) {
      await sleep(200);
      found = await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`);
    }
  }
  assert(found, 'timeline widget opened');
}

async function shot(name) {
  await screenshot(main, path.join(evidenceDir, name));
  record('screenshot', { name });
}

async function readEditText() {
  return readFile(editPath, 'utf8');
}

async function readEdit() {
  return JSON.parse(await readEditText());
}

function locateItem(edit, itemId) {
  for (const track of edit.tracks ?? []) {
    if (!Array.isArray(track.items)) continue;
    const item = track.items.find(candidate => candidate?.id === itemId);
    if (item) return { track, item };
  }
  return undefined;
}

async function observeEditRevisions(action, settleMs = 900) {
  const beforeText = await readEditText();
  const revisions = [beforeText];
  let active = true;
  const monitor = (async () => {
    while (active) {
      try {
        const current = await readEditText();
        if (current !== revisions.at(-1)) revisions.push(current);
      } catch {
        // atomic rename can briefly make one poll miss; the next poll observes the completed revision.
      }
      await sleep(10);
    }
  })();
  await action();
  await sleep(settleMs);
  active = false;
  await monitor;
  const afterText = await readEditText();
  if (afterText !== revisions.at(-1)) revisions.push(afterText);
  return {
    beforeText,
    afterText,
    writeCount: revisions.length - 1,
    revisionByteLengths: revisions.map(value => value.length)
  };
}

async function selectorRect(selector) {
  const encoded = JSON.stringify(selector);
  return evalOn(main, `(() => {
    const element = document.querySelector(${encoded});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function selectItem(itemId) {
  const selector = `[data-akari-item-id=${JSON.stringify(itemId)}]`;
  await waitFor(`timeline item ${itemId}`, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const rect = await selectorRect(selector);
  assert(Boolean(rect && rect.width > 0 && rect.height > 0), `timeline item ${itemId} has a visible rect`, { rect });
  await realClick(main, rect.x, rect.top + Math.min(8, rect.height / 2));
  await waitFor(
    `inspector selection ${itemId}`,
    `Boolean(document.querySelector(${JSON.stringify(selector)}).classList.contains('akari-annotations-selected')
      && document.querySelector('.akari-inspector-widget'))`
  );
  await evalOn(main, `(() => {
    const timeline = document.getElementById('akari-annotations-widget');
    timeline.tabIndex = -1;
    timeline.focus();
    return document.activeElement === timeline;
  })()`);
  await sleep(250);
}

async function dispatchKey({ key, code, windowsVirtualKeyCode, modifiers = 0, downs = 1 }) {
  for (let index = 0; index < downs; index++) {
    await main.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, autoRepeat: index > 0
    });
    await sleep(25);
  }
  await main.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers
  });
}

async function currentPlayheadLeft() {
  return evalOn(main, `(() => {
    const strip = document.querySelector('.akari-annotations-strip');
    return strip?.parentElement?.parentElement?.lastElementChild?.firstElementChild?.style.left ?? null;
  })()`);
}

async function setRangeValue(selector, value) {
  const encoded = JSON.stringify(selector);
  return evalOn(main, `(() => {
    const range = document.querySelector(${encoded});
    if (!(range instanceof HTMLInputElement) || range.type !== 'range') return false;
    range.value = ${JSON.stringify(String(value))};
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function main_() {
  await mkdir(evidenceDir, { recursive: true });
  const targets = await listTargets(cdpPort);
  const pageTarget = targets.find(target => target.type === 'page' && !target.url.startsWith('devtools://'));
  assert(Boolean(pageTarget), 'found electron page target', { targets: targets.map(target => target.url) });
  main = new CDP(pageTarget.webSocketDebuggerUrl);
  await main.connect();
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('DOM.enable');
  await evalOn(main, `(() => { window.resizeTo(1800, 1600); return true; })()`);

  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(700);
    if (await dismissOnboardingIfPresent()) break;
  }
  await openTimeline();
  await sleep(1200);
  await shot('00-boot.png');

  // 1. Real scrub drag: one persisted revision and at least one live-preview event.
  await evalOn(main, `(() => {
    window.__akariInspectorLiveCount = 0;
    window.addEventListener('akari.timeline.liveTransform', () => window.__akariInspectorLiveCount++);
    return true;
  })()`);
  await selectItem('telop-chapter');
  const telopDomKind = await evalOn(main,
    `document.querySelector('[data-akari-item-id="telop-chapter"]')?.dataset.akariItemKind`);
  assert(telopDomKind === 'layer', 'telop-chapter is selected through the real layer DOM projection', { telopDomKind });
  const xHandleSelector = '[data-akari-ui="field:inspector-transform-x"] .akari-inspector-number-handle';
  await waitFor('transform X scrub handle', `Boolean(document.querySelector(${JSON.stringify(xHandleSelector)}))`);
  const handleRect = await selectorRect(xHandleSelector);
  const beforeScrub = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  const scrubRevisions = await observeEditRevisions(() => realDrag(main, [
    { x: handleRect.x, y: handleRect.y },
    { x: handleRect.x + 12, y: handleRect.y }
  ], { steps: 12, stepDelayMs: 12 }));
  const afterScrub = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  const liveCount = await evalOn(main, `window.__akariInspectorLiveCount`);
  assert(afterScrub !== beforeScrub, 'scrub drag changed telop-chapter transform.x', { beforeScrub, afterScrub });
  assert(liveCount >= 1, 'scrub drag emitted liveTransform at least once', { liveCount });
  assert(scrubRevisions.writeCount === 1, 'scrub drag persisted exactly one edit.json content revision', scrubRevisions);
  await shot('01-layer-x-scrub.png');

  // 2. Opacity uses the filled range and persists display 50 as internal 0.5.
  await selectItem('telop-chapter');
  const opacitySelector = '[data-akari-ui="slider:inspector-opacity"]';
  await waitFor('opacity slider', `Boolean(document.querySelector(${JSON.stringify(opacitySelector)}))`);
  const opacityRevisions = await observeEditRevisions(async () => {
    assert(await setRangeValue(opacitySelector, 50), 'opacity range accepted value 50');
  });
  const afterOpacity = locateItem(await readEdit(), 'telop-chapter').item.opacity;
  const opacityDisplay = await evalOn(main, `document.querySelector(${JSON.stringify(opacitySelector)})
    ?.parentElement?.querySelector('.akari-inspector-slider-number')?.value`);
  assert(afterOpacity === 0.5, 'opacity display 50 persisted as internal 0.5', { afterOpacity });
  assert(Number(opacityDisplay) === 50, 'opacity slider numeric display is 50', { opacityDisplay });
  assert(opacityRevisions.writeCount === 1, 'opacity change persisted exactly one content revision', opacityRevisions);
  await shot('02-opacity-50.png');

  // 3. meta.json knobs become grouped typed controls and write through source.vars.
  await selectItem('lower-third');
  const lowerThirdDomKind = await evalOn(main,
    `document.querySelector('[data-akari-item-id="lower-third"]')?.dataset.akariItemKind`);
  assert(lowerThirdDomKind === 'overlay', 'lower-third is selected through the real overlay DOM projection', { lowerThirdDomKind });
  const knobSectionSelector = '[data-akari-ui^="section:inspector-knobs:"]';
  const fontSizeSelector = '[data-akari-ui="slider:inspector-var---font-size"]';
  await waitFor('knob sections from meta.json', `document.querySelectorAll(${JSON.stringify(knobSectionSelector)}).length >= 3`);
  await waitFor('font-size knob slider', `Boolean(document.querySelector(${JSON.stringify(fontSizeSelector)}))`);
  const knobGroups = await evalOn(main, `Array.from(document.querySelectorAll(${JSON.stringify(knobSectionSelector)}))
    .map(section => section.querySelector('.akari-inspector-section-toggle')?.textContent ?? '')`);
  for (const group of ['typography', 'style', 'layout']) {
    assert(knobGroups.some(label => label.includes(group)), `knob group ${group} is visible`, { knobGroups });
  }
  const beforeFontSize = locateItem(await readEdit(), 'lower-third').item.source.vars['--font-size'];
  const knobRevisions = await observeEditRevisions(async () => {
    assert(await setRangeValue(fontSizeSelector, 48), 'font-size range accepted value 48');
  });
  const afterFontSize = locateItem(await readEdit(), 'lower-third').item.source.vars['--font-size'];
  assert(afterFontSize !== beforeFontSize && afterFontSize === 48,
    'font-size knob changed source.vars[--font-size]', { beforeFontSize, afterFontSize });
  assert(knobRevisions.writeCount === 1, 'knob change persisted exactly one content revision', knobRevisions);
  await shot('03-overlay-knobs.png');

  // 4. Alt nudge commits once on keyup; plain ArrowRight moves only the playhead.
  await selectItem('telop-chapter');
  let beforeX = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  const altOnce = await observeEditRevisions(() => dispatchKey({
    key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1
  }));
  let afterX = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  assert(afterX === beforeX + 1, 'Alt+ArrowRight nudged transform.x by +1', { beforeX, afterX });
  assert(altOnce.writeCount === 1, 'Alt nudge persisted once on keyup', altOnce);

  beforeX = afterX;
  const shiftAltOnce = await observeEditRevisions(() => dispatchKey({
    key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 9
  }));
  afterX = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  assert(afterX === beforeX + 10, 'Shift+Alt+ArrowRight nudged transform.x by +10', { beforeX, afterX });
  assert(shiftAltOnce.writeCount === 1, 'Shift+Alt nudge persisted once on keyup', shiftAltOnce);

  beforeX = afterX;
  const repeatedAlt = await observeEditRevisions(() => dispatchKey({
    key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1, downs: 3
  }));
  afterX = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  assert(afterX === beforeX + 3, 'three keydowns accumulated three 1px nudges', { beforeX, afterX });
  assert(repeatedAlt.writeCount === 1, 'multiple nudge keydowns persisted once at the single keyup', repeatedAlt);

  const playheadBefore = await currentPlayheadLeft();
  beforeX = afterX;
  const plainArrow = await observeEditRevisions(() => dispatchKey({
    key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39
  }), 350);
  const playheadAfter = await currentPlayheadLeft();
  afterX = locateItem(await readEdit(), 'telop-chapter').item.transform.x;
  assert(afterX === beforeX, 'plain ArrowRight left transform.x unchanged', { beforeX, afterX });
  assert(plainArrow.writeCount === 0, 'plain ArrowRight did not write edit.json', plainArrow);
  assert(playheadAfter !== playheadBefore, 'plain ArrowRight moved the playhead', { playheadBefore, playheadAfter });
  await shot('04-keyboard-nudge.png');

  // 5. Bracket moves to the adjacent visual track, but overlap is rejected with the display name.
  await selectItem('laptop-3d');
  const laptopBefore = locateItem(await readEdit(), 'laptop-3d').track.id;
  const laptopMove = await observeEditRevisions(() => dispatchKey({
    key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221
  }));
  const laptopAfter = locateItem(await readEdit(), 'laptop-3d').track.id;
  assert(laptopBefore === 'v-overlay' && laptopAfter === 'v1',
    'laptop-3d moved from v-overlay to the adjacent upper visual track v1', { laptopBefore, laptopAfter });
  assert(laptopMove.writeCount === 1, 'successful bracket move persisted one content revision', laptopMove);

  await selectItem('lower-third');
  const lowerBefore = locateItem(await readEdit(), 'lower-third').track.id;
  const blockedMove = await observeEditRevisions(() => dispatchKey({
    key: ']', code: 'BracketRight', windowsVirtualKeyCode: 221
  }), 450);
  const lowerAfter = locateItem(await readEdit(), 'lower-third').track.id;
  await waitFor('overlap rejection notice', `document.querySelector('[data-akari-timeline-notice]')
    ?.textContent?.includes('重なるアイテムがあるため移動できません') === true`);
  const notice = await evalOn(main, `document.querySelector('[data-akari-timeline-notice]')?.textContent ?? ''`);
  assert(lowerBefore === lowerAfter, 'overlapping lower-third stayed on its source track', { lowerBefore, lowerAfter });
  assert(blockedMove.writeCount === 0, 'blocked bracket move did not write edit.json', blockedMove);
  assert(notice.includes('V3 に重なるアイテムがあるため移動できません'),
    'overlap notice uses the timeline display track name V3', { notice });
  await shot('05-track-move-and-overlap.png');

  // 6. Sections replace tabs, follow the fixed order, and info starts collapsed.
  const inspectorShape = await evalOn(main, `(() => {
    const sections = Array.from(document.querySelectorAll('[data-akari-ui^="section:inspector-"]'));
    return {
      tabCount: document.querySelectorAll('.akari-inspector-tab').length,
      ids: sections.map(section => section.getAttribute('data-akari-ui')),
      labels: sections.map(section => section.querySelector('.akari-inspector-section-toggle')?.textContent ?? ''),
      infoHidden: sections.find(section => section.getAttribute('data-akari-ui') === 'section:inspector-info')
        ?.querySelector('.akari-inspector-section-body')?.hidden ?? false,
      kindHeadingCount: document.querySelectorAll('.akari-inspector-heading').length
    };
  })()`);
  assert(inspectorShape.tabCount === 0, 'legacy inspector tabs are absent', inspectorShape);
  assert(inspectorShape.ids[0] === 'section:inspector-time'
    && inspectorShape.ids[1] === 'section:inspector-transform'
    && inspectorShape.ids[2] === 'section:inspector-appearance'
    && inspectorShape.ids.at(-1) === 'section:inspector-info',
  'sections are vertically ordered time, transform, appearance, kind-specific, info', inspectorShape);
  assert(inspectorShape.ids.slice(3, -1).every(id => id.startsWith('section:inspector-knobs:')),
    'overlay kind-specific sections are knob groups between appearance and info', inspectorShape);
  assert(inspectorShape.infoHidden === true, 'information section is collapsed by default', inspectorShape);
  assert(inspectorShape.kindHeadingCount === 0, 'standalone kind heading is absent', inspectorShape);
  await shot('06-section-stack.png');

  record('DONE', { criteria: 6 });
}

main_()
  .then(async () => {
    await persistRunLog('PASS');
    console.log('L1_RESULT=PASS');
    main?.close();
    process.exit(0);
  })
  .catch(async error => {
    record('ERROR', { message: error instanceof Error ? error.message : String(error) });
    await persistRunLog('FAIL', error);
    console.error(error);
    console.log('L1_RESULT=FAIL');
    main?.close();
    process.exit(1);
  });
