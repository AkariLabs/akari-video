#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { CDP, evalOn, keyPress, listTargets, realClick, screenshot } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [phase, portText, workspaceDir, evidenceOutDir] = process.argv.slice(2);
if (!['a', 'b', 'c'].includes(phase) || !portText || !workspaceDir || !evidenceOutDir) {
  throw new Error('usage: run-l1.mjs <phase:a|b|c> <cdpPort> <workspaceDir> <evidenceOutDir>');
}

const port = Number(portText);
const projectDir = path.join(workspaceDir, 'project');
const editPath = path.join(projectDir, 'edit.json');
const lintPath = path.join(projectDir, '.akari', 'lint.json');
const log = [];

function record(step, data = {}) {
  const entry = { step, ...data };
  log.push(entry);
  console.log(`[${step}] ${JSON.stringify(data)}`);
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(workspaceDir).join('<workspace>');
}

async function saveLog(status, error) {
  await mkdir(evidenceOutDir, { recursive: true });
  await writeFile(
    path.join(evidenceOutDir, `phase-${phase}.json`),
    `${JSON.stringify({ phase, status, observations: log, ...(error ? { error: cleanError(error) } : {}) }, null, 2)}\n`
  );
}

async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 480; attempt++) {
    try {
      targets = await listTargets(port);
    } catch {
      targets = [];
    }
    if (targets.some(target => target.type === 'page')) break;
    await sleep(250);
  }
  const target = targets.find(candidate => candidate.type === 'page');
  assert.ok(target, 'Electron page target was not created');
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1680, height: 1250, deviceScaleFactor: 1, mobile: false
  });
  return cdp;
}

async function waitForApplicationShell(cdp) {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < 960; attempt++) {
    const ready = await evalOn(cdp, `Boolean(document.querySelector('.theia-ApplicationShell'))
      && !document.querySelector('.theia-preload')`);
    if (ready) {
      record('application-shell-ready', { elapsedMs: Date.now() - startedAt });
      return;
    }
    await sleep(250);
  }
  throw new Error('Theia application shell did not become ready within 240 seconds');
}

async function openTimeline(cdp) {
  let opened = await evalOn(cdp, "Boolean(document.getElementById('akari-annotations-widget'))");
  for (let attempt = 1; attempt <= 8 && !opened; attempt++) {
    await keyPress(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(500);
    await cdp.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    for (let wait = 0; wait < 60 && !opened; wait++) {
      await sleep(250);
      opened = await evalOn(cdp, "Boolean(document.getElementById('akari-annotations-widget'))");
    }
    record('open-timeline-attempt', { attempt, opened });
  }
  assert.equal(opened, true, 'timeline widget did not open after 8 attempts');
}

async function elementState(cdp, selector) {
  return evalOn(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      text: element.textContent ?? '',
      title: element.title ?? '',
      disabled: Boolean(element.disabled),
      hitTag: hit?.tagName ?? null,
      hitText: hit?.textContent ?? ''
    };
  })()`);
}

async function waitForElement(cdp, selector, present = true, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await elementState(cdp, selector);
    if (Boolean(state) === present) return state;
    await sleep(250);
  }
  throw new Error(`selector did not reach expected presence: ${selector}`);
}

async function readEditSource() {
  return readFile(editPath, 'utf8');
}

async function waitForEdit(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await readEditSource();
    const edit = JSON.parse(source);
    if (predicate(edit)) return { edit, source };
    await sleep(250);
  }
  throw new Error('edit.json did not reach the expected state');
}

async function waitForLint(verdict, timeoutMs = 30000, requireCompletedRun = false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const lint = JSON.parse(await readFile(lintPath, 'utf8'));
      if (lint.verdict === verdict && (!requireCompletedRun || typeof lint.checked_at === 'string')) return lint;
    } catch {
      // atomic rename window or first lint run
    }
    await sleep(250);
  }
  throw new Error(`lint verdict did not become ${verdict}`);
}

async function waitForFooterText(cdp, expected, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const footer = await evalOn(cdp, `(() => {
      const widget = document.getElementById('akari-annotations-widget');
      if (!widget) return null;
      const element = Array.from(widget.children).find(child =>
        Math.round(child.getBoundingClientRect().height) === 26);
      return element ? { text: element.textContent ?? '', height: element.getBoundingClientRect().height } : null;
    })()`);
    if (footer?.text.includes(expected)) return footer;
    await sleep(250);
  }
  throw new Error(`timeline footer did not include: ${expected}`);
}

async function click(cdp, selector) {
  const state = await waitForElement(cdp, selector);
  assert.ok(state.width > 0 && state.height > 0, `element has no hit area: ${selector}`);
  await realClick(cdp, state.x, state.y);
  return state;
}

async function phaseA(cdp) {
  const warningSelector = '[data-akari-unsupported-transition="0"]';
  const warning = await waitForElement(cdp, warningSelector);
  assert.match(warning.title, /並べ替えたトラックを合成する方式では書き出せません/);
  record('warning-visible', { title: warning.title, hitTag: warning.hitTag, height: warning.height });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-a-01-warning.png'));

  await click(cdp, warningSelector);
  await waitForEdit(edit => !Object.hasOwn(edit.tracks[0].items[0].source, 'transition_out'));
  await waitForLint('pass');
  record('one-click-removal', { transitionOutPresent: false, lint: 'pass' });

  await click(cdp, '#akari-annotations-widget [aria-label="元に戻す"]');
  await waitForEdit(edit => Object.hasOwn(edit.tracks[0].items[0].source, 'transition_out'));
  await waitForLint('fail');
  const summary = '保存後の検証で問題が見つかりました: このトランジションは現在のトラック順では書き出せません';
  const footer = await waitForFooterText(cdp, summary);
  assert.match(footer.text, /詳細: \[cuts\.track-transition-unsupported\]/);
  record('localized-lint-banner', { height: footer.height, text: footer.text });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-a-02-localized-banner.png'));

  await click(cdp, warningSelector);
  await waitForEdit(edit => !Object.hasOwn(edit.tracks[0].items[0].source, 'transition_out'));
  await waitForLint('pass');
  record('phase-a-final', { transitionOutPresent: false, lint: 'pass' });
}

async function phaseB(cdp) {
  const before = await readEditSource();
  await click(cdp, '[data-akari-transition-boundary="0-1"]');
  const guard = await waitForElement(cdp, '[data-akari-transition-guard="0"]');
  assert.match(guard.text, /並べ替えたトラックを合成する方式では書き出せません/);
  const disabled = await evalOn(cdp, `Array.from(
    document.querySelectorAll('.akari-annotations-transition-popover button')
  ).map(button => button.disabled)`);
  assert.ok(disabled.length > 0 && disabled.every(Boolean), JSON.stringify(disabled));
  record('guard-visible', { text: guard.text, typeButtonsDisabled: disabled });

  const forced = await evalOn(cdp, `(() => {
    const button = document.querySelector('.akari-annotations-transition-popover button');
    if (!button) return null;
    button.disabled = false;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(forced, 'transition type button was not found');
  await realClick(cdp, forced.x, forced.y);
  await sleep(800);
  assert.equal(await readEditSource(), before, 'guarded declaration changed edit.json bytes');
  const notice = await waitForElement(cdp, '[data-akari-timeline-notice] [data-akari-notice-text]');
  assert.match(notice.text, /並べ替えたトラックを合成する方式では書き出せません/);
  record('forced-click-rejected', { editByteDiff: 0, notice: notice.text });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-b-guard.png'));
}

async function phaseC(cdp) {
  await click(cdp, '[data-akari-transition-boundary="0-1"]');
  await waitForElement(cdp, '.akari-annotations-transition-popover');
  assert.equal(await elementState(cdp, '[data-akari-transition-guard="0"]'), null);
  const enabled = await evalOn(cdp, `Array.from(
    document.querySelectorAll('.akari-annotations-transition-popover button')
  ).map(button => button.disabled)`);
  assert.ok(enabled.length > 0 && enabled.every(value => value === false), JSON.stringify(enabled));
  await click(cdp, '.akari-annotations-transition-popover button');
  await waitForEdit(edit => Boolean(edit.tracks[0].items[0].source.transition_out));
  await waitForLint('pass', 30000, true);
  record('default-order-allows-transition', { guardVisible: false, typeButtonsDisabled: enabled, lint: 'pass' });
  await screenshot(cdp, path.join(evidenceOutDir, 'phase-c-transition-added.png'));
}

let cdp;
try {
  await mkdir(evidenceOutDir, { recursive: true });
  cdp = await connect();
  await waitForApplicationShell(cdp);
  await openTimeline(cdp);
  if (phase === 'a') await phaseA(cdp);
  if (phase === 'b') await phaseB(cdp);
  if (phase === 'c') await phaseC(cdp);
  record('phase-pass');
  await saveLog('PASS');
  console.log(`PHASE ${phase} PASS`);
} catch (error) {
  record('phase-fail', { message: cleanError(error) });
  await saveLog('FAIL', error);
  throw error;
} finally {
  cdp?.close();
}
