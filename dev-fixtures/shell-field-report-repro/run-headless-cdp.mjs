#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(fixtureDir, '..', '..');
const shellDir = path.join(worktree, 'apps', 'shell');
const projectDir = path.join(fixtureDir, 'generated-project');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(fixtureDir, 'runs', `headless-${stamp}`);

async function findBrowser() {
  if (process.env.AKARI_CHROME_BIN) return process.env.AKARI_CHROME_BIN;
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const entries = (await readdir(cacheRoot)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const entry of entries) {
      const candidate = path.join(cacheRoot, entry, 'chrome-mac', 'headless_shell');
      try {
        await stat(candidate);
        return candidate;
      } catch {}
    }
  } catch {}
  return path.join(path.sep, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
}

function sanitize(value) {
  let text = JSON.stringify(value);
  for (const [from, to] of [[worktree, '<WORKTREE>'], [os.homedir(), '<LOCAL_HOME>']]) {
    text = text.split(from).join(to);
    text = text.split(`file://${from}`).join(`file://${to}`);
  }
  return JSON.parse(text);
}

function stackValue(stackTrace) {
  if (!stackTrace) return null;
  return {
    description: stackTrace.description,
    callFrames: (stackTrace.callFrames ?? []).map(frame => ({
      functionName: frame.functionName,
      url: sanitize(frame.url),
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber
    })),
    parent: stackValue(stackTrace.parent)
  };
}

const requireFromShell = createRequire(path.join(shellDir, 'package.json'));
const puppeteer = requireFromShell('puppeteer-core');
const executablePath = await findBrowser();
await mkdir(runDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  pipe: true,
  args: [
    '--no-sandbox', '--single-process', '--no-zygote', '--disable-crash-reporter',
    '--allow-file-access-from-files', '--disable-web-security',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ]
});
const browserPid = browser.process()?.pid;
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const cdp = await page.createCDPSession();
const events = [];
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Page.enable');
cdp.on('Runtime.consoleAPICalled', event => events.push({
  method: 'Runtime.consoleAPICalled',
  type: event.type,
  args: (event.args ?? []).map(arg => arg.value ?? arg.description ?? ''),
  stackTrace: stackValue(event.stackTrace)
}));
cdp.on('Runtime.exceptionThrown', event => events.push({
  method: 'Runtime.exceptionThrown',
  text: event.exceptionDetails?.text,
  exception: event.exceptionDetails?.exception?.description,
  stackTrace: stackValue(event.exceptionDetails?.stackTrace)
}));
cdp.on('Log.entryAdded', event => events.push({
  method: 'Log.entryAdded',
  level: event.entry?.level,
  text: event.entry?.text,
  url: event.entry?.url,
  lineNumber: event.entry?.lineNumber,
  stackTrace: stackValue(event.entry?.stackTrace)
}));

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

const result = {
  mode: 'production overlay runtime in headless Chromium through CDP',
  browserPid,
  executable: '<HEADLESS_CHROMIUM>',
  observations: [],
  events
};

try {
  await cdp.send('Page.navigate', { url: pathToFileURL(path.join(projectDir, 'harness.html')).href });
  let harnessReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await evaluate(`({ ready: window.__reportHarness?.ready === true,
      error: window.__reportHarness?.error ?? null })`).catch(() => null);
    if (state?.error) throw new Error(JSON.stringify(state.error));
    if (state?.ready) {
      harnessReady = true;
      break;
    }
    await sleep(100);
  }
  if (!harnessReady) throw new Error('headless harness did not become ready');

  const readDom = `(() => {
    const box = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height };
    };
    const scene = document.querySelector('[data-overlay-id="laptop-3d"]');
    const fallback = scene?.querySelector('[data-akari-3d-fallback]');
    const canvas = scene?.querySelector('canvas');
    const chapter = document.querySelector('[data-overlay-id="chapter-tag"]');
    const title = chapter?.querySelector('.ref3-chapter-tag__title');
    const row = chapter?.querySelector('.ref3-chapter-tag__row');
    const clipPath = chapter ? getComputedStyle(chapter).clipPath : '';
    const numbers = (clipPath.match(/-?\\d+(?:\\.\\d+)?/g) ?? []).map(Number);
    const chapterRect = box(chapter);
    const rightInset = numbers.length >= 4 ? numbers[1] : null;
    const clipRight = chapterRect && rightInset !== null
      ? chapterRect.right - chapterRect.width * rightInset / 100 : null;
    const titleRect = box(title);
    const caption = document.getElementById('caption-plate');
    return {
      caption: { text: caption?.textContent ?? null, rect: box(caption),
        visibility: caption ? getComputedStyle(caption).visibility : null },
      scene3d: scene ? {
        visibility: getComputedStyle(scene).visibility,
        containerRect: box(scene),
        fallback: fallback ? { text: fallback.textContent, hidden: fallback.hidden,
          display: getComputedStyle(fallback).display, visibility: getComputedStyle(fallback).visibility,
          rect: box(fallback) } : null,
        canvas: canvas ? { rect: box(canvas), width: canvas.width, height: canvas.height } : null,
        runtime: window.akari.threeRuntime?.inspect?.(scene) ?? null
      } : null,
      chapter: chapter ? {
        text: title?.textContent ?? null,
        visibility: getComputedStyle(chapter).visibility,
        clipPath,
        containerRect: chapterRect,
        rowRect: box(row),
        titleRect,
        clipRight,
        titleOverflowBeyondClipRight: titleRect && clipRight !== null ? titleRect.right - clipRight : null
      } : null
    };
  })()`;

  let initial;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    initial = await evaluate(readDom);
    if (['ready', 'error'].includes(initial.scene3d?.runtime?.status)) break;
    await sleep(200);
  }
  if (!initial.scene3d || !initial.chapter) {
    throw new Error(`required overlay DOM is missing: ${JSON.stringify(initial)}`);
  }
  result.observations.push({ step: 'output-1s', dom: initial });

  const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(runDir, 'headless-preview.png'), Buffer.from(image.data, 'base64'));
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL';
  result.failure = { message: error.message, stack: error.stack };
} finally {
  await browser.close();
  result.lifecycle = { browserPid, closed: true };
  await writeFile(path.join(runDir, 'headless-observation.json'),
    `${JSON.stringify(sanitize(result), null, 2)}\n`);
  console.log(path.relative(worktree, runDir));
}

if (result.status !== 'PASS') process.exitCode = 1;
