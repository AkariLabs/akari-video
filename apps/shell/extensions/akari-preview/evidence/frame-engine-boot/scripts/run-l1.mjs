#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';
import { createEvidenceRedactor, localPathValueKeys } from './redact.mjs';

const run = promisify(execFile);
const [, , portArg, workspaceDir, outDir, label, optionsJson] = process.argv;
const port = Number(portArg || 9645);
if (!workspaceDir || !outDir || !label) {
  throw new Error('usage: run-l1.mjs <port> <workspaceDir> <outDir> <label> [optionsJson]');
}

const options = optionsJson ? JSON.parse(optionsJson) : {};
const seekTime = Number.isFinite(options.seekTime) ? options.seekTime : 2.0;
const canvasProbeTime = Number.isFinite(options.canvasProbeTime) ? options.canvasProbeTime : 6.5;
const overlayExpectedRgb = Array.isArray(options.overlayExpectedRgb)
  ? options.overlayExpectedRgb : [0, 128, 255];
const canvasExpectedRgb = Array.isArray(options.canvasExpectedRgb)
  ? options.canvasExpectedRgb : [230, 200, 40];
const editPath = path.join(workspaceDir, 'project', 'edit.json');
const viewWidth = 1600;
const viewHeight = 1200;
const startedAt = Date.now();
await mkdir(outDir, { recursive: true });
const redactValue = createEvidenceRedactor({
  repoDir: process.env.AKARI_REPO,
  workspaceDir,
  outDir,
  homeDir: homedir()
});
const redact = value => redactValue(value);

const mainConsoleEntries = [];
const mainExceptionEntries = [];
const consoleEntries = [];
const exceptionEntries = [];
const logEntries = [];
const contexts = [];
let main;
let view;
let contextId;
let openResult = null;
let stageDetectedAt = null;
let stageDetectedFromWebviewConnectMs = null;
let readyAfterStageMs = null;
let webviewConnectedAt = null;
let failLoud = null;

const simplifyConsole = params => ({
  type: params.type,
  timestamp: params.timestamp,
  args: params.args.map(arg => arg.value ?? arg.description ?? arg.type)
});
const simplifyException = params => {
  const detail = params.exceptionDetails;
  return {
    timestamp: params.timestamp,
    text: detail.text,
    url: detail.url,
    lineNumber: detail.lineNumber,
    columnNumber: detail.columnNumber,
    exception: detail.exception?.description ?? detail.exception?.value ?? null
  };
};

const targets = await listTargets(port);
const mainTarget = targets.find(target => target.type === 'page' && /localhost/u.test(target.url))
  ?? targets.find(target => target.type === 'page');
if (!mainTarget) throw new Error('main page target not found');

main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
main.on('Runtime.consoleAPICalled', params => mainConsoleEntries.push(simplifyConsole(params)));
main.on('Runtime.exceptionThrown', params => mainExceptionEntries.push(simplifyException(params)));
await main.send('Page.enable');
await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', {
  width: viewWidth,
  height: viewHeight,
  deviceScaleFactor: 1,
  mobile: false
});
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => {
  const button = [...document.querySelectorAll('button')]
    .find(element => element.textContent?.trim() === '開くだけ');
  if (button) button.click();
  return true;
})()`);
await sleep(1000);

openResult = await evalOn(main, `(() => {
  const bindings = window.theia.container._bindingDictionary;
  const keys = [...bindings._map.keys()];
  const commandRegistry = keys.find(key => typeof key === 'function'
    && typeof key.prototype?.executeCommand === 'function'
    && typeof key.prototype?.registerCommand === 'function');
  if (!commandRegistry) return 'no-command-registry';
  const pending = window.theia.container.get(commandRegistry).executeCommand(
    'akari.preview.ensureVisible',
    { editUri: ${JSON.stringify(`file://${editPath}`)} }
  );
  window.__akariFrameEngineProbeOpen = Promise.resolve(pending).catch(error => String(error));
  return 'requested';
})()`);

const webviewTarget = await waitFor('webview target', async () => {
  const current = await listTargets(port);
  return current.find(target => target.type === 'iframe' && /webview\/index\.html/u.test(target.url));
}, 60000).catch(() => null);

if (webviewTarget) {
  view = new CDP(webviewTarget.webSocketDebuggerUrl);
  await view.connect();
  webviewConnectedAt = Date.now();
  view.on('Runtime.executionContextCreated', params => contexts.push(params.context));
  view.on('Runtime.consoleAPICalled', params => consoleEntries.push(simplifyConsole(params)));
  view.on('Runtime.exceptionThrown', params => exceptionEntries.push(simplifyException(params)));
  view.on('Log.entryAdded', params => logEntries.push(params.entry));
  await view.send('Page.enable');
  await view.send('Runtime.enable');
  await view.send('Log.enable');
}

const refreshPreviewContext = async () => {
  if (!view) return false;
  const candidates = [
    ...contexts.map(context => context.id).reverse(),
    contextId,
    undefined
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);
  for (const candidate of candidates) {
    try {
      if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, candidate)) {
        contextId = candidate;
        return true;
      }
    } catch {}
  }
  return false;
};

if (view) {
  const foundStage = await waitFor('preview stage in webview', refreshPreviewContext, 90000).catch(() => false);
  if (foundStage) {
    stageDetectedAt = Date.now();
    stageDetectedFromWebviewConnectMs = stageDetectedAt - webviewConnectedAt;
  }
}

const vEval = async expression => {
  if (!view) return null;
  try {
    return await evalOn(view, expression, contextId);
  } catch {
    if (!await refreshPreviewContext()) return null;
    try {
      return await evalOn(view, expression, contextId);
    } catch {
      return null;
    }
  }
};

const collectState = () => vEval(`(() => {
  const stage = document.getElementById('preview-stage');
  const engineRoot = document.getElementById('frame-engine-preview');
  const errorCard = document.getElementById('frame-engine-boot-error');
  const fallback = document.getElementById('frame-engine-boot-fallback');
  const engineError = document.getElementById('frame-engine-error');
  const fragment = document.querySelector('#overlay-stage [data-overlay-id] > *');
  const fragmentRect = fragment?.getBoundingClientRect();
  const stageRect = stage?.getBoundingClientRect();
  const rectValue = rect => rect ? {
    left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
    width: rect.width, height: rect.height
  } : null;
  return {
    frameEngineActive: stage?.dataset.frameEngineActive ?? null,
    frameEngineReady: engineRoot?.dataset.frameEngineReady ?? null,
    frameEngineClockType: typeof (window.akari && window.akari.frameEngineClock),
    frameEngineBootFailure: document.documentElement.dataset.frameEngineBootFailure ?? null,
    frameEngineBootErrors: document.documentElement.dataset.frameEngineBootErrors ?? null,
    bootError: {
      present: Boolean(errorCard),
      textContent: errorCard?.textContent ?? null,
      fallbackPresent: Boolean(fallback)
    },
    frameEngineErrorText: engineError?.textContent ?? null,
    frameEngineSources: window.akariFrameEngineSources ?? null,
    fragmentRect: rectValue(fragmentRect),
    stageRect: rectValue(stageRect),
    timeLabel: document.getElementById('time-label')?.textContent ?? null,
    seekValue: document.getElementById('seek')?.value ?? null
  };
})()`);
const emptyState = () => ({
  frameEngineActive: null,
  frameEngineReady: null,
  frameEngineClockType: null,
  frameEngineBootFailure: null,
  frameEngineBootErrors: null,
  bootError: { present: false, textContent: null, fallbackPresent: false },
  frameEngineErrorText: null,
  frameEngineSources: null,
  fragmentRect: null,
  stageRect: null,
  timeLabel: null,
  seekValue: null
});
const stateOrEmpty = state => state ?? emptyState();

const frameEngineOverride = (process.env.AKARI_FRAME_ENGINE ?? '').trim().toLowerCase();
const expectFrameEngine = frameEngineOverride !== '0' && frameEngineOverride !== 'false';
if (stageDetectedAt && expectFrameEngine && options.failLoud !== true) {
  const bootWaitMs = Number.isFinite(options.bootWaitMs) ? options.bootWaitMs : 20000;
  await waitFor('frame-engine ready or fail-loud', async () => {
    const state = await collectState();
    if (state?.frameEngineReady === 'true' || state?.frameEngineClockType === 'object') {
      readyAfterStageMs ??= Date.now() - stageDetectedAt;
      return true;
    }
    return Boolean(state?.frameEngineBootFailure);
  }, bootWaitMs, 50).catch(() => false);
} else if (stageDetectedAt) {
  await sleep(500);
}

let bootState = stateOrEmpty(await collectState());

const captureScreenshot = async suffix => {
  const screenshot = await main.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  });
  const screenshotPath = path.join(outDir, `${label}${suffix}-window.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  return screenshotPath;
};

if (options.failLoud === true && stageDetectedAt) {
  const pollingStartedAt = Date.now();
  const appeared = await waitFor('frame-engine fail-loud card', async () => {
    const state = await collectState();
    return state?.bootError.present ? state : false;
  }, 40000, 50).catch(() => null);
  const appearedAt = appeared ? Date.now() : null;
  bootState = stateOrEmpty(appeared || await collectState());
  const failScreenshotPath = appeared ? await captureScreenshot('-fail-loud') : null;
  const clicked = appeared
    ? await vEval(`(() => {
        const button = document.getElementById('frame-engine-boot-fallback');
        if (!button) return false;
        button.click();
        return true;
      })()`)
    : false;
  const fallbackRecovered = clicked
    ? await waitFor('legacy fallback recovered', async () => {
        const ready = await vEval(`(() => {
          const stage = document.getElementById('preview-stage');
          const video = document.getElementById('preview-video');
          return Boolean(video && (video.currentSrc || video.getAttribute('src'))
            && !(stage && stage.dataset.frameEngineActive));
        })()`);
        return Boolean(ready);
      }, 60000, 100).catch(() => false)
    : false;
  failLoud = {
    requested: true,
    cardAppeared: Boolean(appeared),
    cardAppearedAfterPollingMs: appearedAt ? appearedAt - pollingStartedAt : null,
    cardAppearedAfterStageMs: appearedAt ? appearedAt - stageDetectedAt : null,
    screenshot: failScreenshotPath ? `<out>/${path.basename(failScreenshotPath)}` : null,
    clicked: Boolean(clicked),
    fallbackRecovered: Boolean(fallbackRecovered),
    stateBeforeFallback: bootState,
    stateAfterFallback: stateOrEmpty(await collectState())
  };
}

const seekTo = async seconds => {
  const result = await vEval(`(() => {
    const video = document.getElementById('preview-video');
    if (video && !video.paused) document.getElementById('play-toggle')?.click();
    const seek = document.getElementById('seek');
    if (!seek) return null;
    seek.value = ${JSON.stringify(String(seconds))};
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    return seek.value;
  })()`);
  if (result !== null) await sleep(1200);
  return result;
};

await seekTo(seekTime);
const overlayState = stateOrEmpty(await collectState());
const iframeRect = await evalOn(main, `(() => {
  const frame = [...document.querySelectorAll('iframe')]
    .find(element => element.src.includes('/webview/index.html'));
  if (!frame) return null;
  const rect = frame.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
})()`).catch(() => null);
const overlayScreenshotPath = await captureScreenshot('');

await seekTo(canvasProbeTime);
const canvasState = stateOrEmpty(await collectState());
const canvasScreenshotPath = await captureScreenshot('-canvas');

const scratch = await mkdtemp(path.join(tmpdir(), 'akari-frame-engine-boot-pixels-'));
const decodeScreenshot = async (screenshotPath, key) => {
  const rawPath = path.join(scratch, `${key}.rgb`);
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', screenshotPath,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath
  ]);
  const probe = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', screenshotPath
  ]);
  const [width, height] = probe.stdout.trim().split(',').map(Number);
  return { width, height, raw: await readFile(rawPath) };
};
const delta = (left, right) => left && right
  ? Math.max(...left.map((value, index) => Math.abs(value - right[index])))
  : null;
const pixelReader = decoded => (x, y) => {
  if (!decoded || !iframeRect) return null;
  const px = Math.round(iframeRect.left + x);
  const py = Math.round(iframeRect.top + y);
  if (px < 0 || py < 0 || px >= decoded.width || py >= decoded.height) return null;
  const offset = (py * decoded.width + px) * 3;
  return [decoded.raw[offset], decoded.raw[offset + 1], decoded.raw[offset + 2]];
};

let overlayPixels = {
  threshold: 8,
  expectedRgb: overlayExpectedRgb,
  samples: null,
  maxDelta: null,
  maxAbsoluteDelta: null,
  pass: null
};
let canvasPixels = {
  probeTime: canvasProbeTime,
  expectedRgb: canvasExpectedRgb,
  samples: null,
  maxAbsoluteDelta: null
};

try {
  if (iframeRect && overlayState?.fragmentRect) {
    const decoded = await decodeScreenshot(overlayScreenshotPath, 'overlay');
    const pixel = pixelReader(decoded);
    const rect = overlayState.fragmentRect;
    const anchors = [
      ['top-mid', (rect.left + rect.right) / 2, rect.top, 0, 1],
      ['bottom-mid', (rect.left + rect.right) / 2, rect.bottom, 0, -1],
      ['left-mid', rect.left, (rect.top + rect.bottom) / 2, 1, 0],
      ['right-mid', rect.right, (rect.top + rect.bottom) / 2, -1, 0],
      ['top-left', rect.left, rect.top, 1, 1],
      ['top-right', rect.right, rect.top, -1, 1],
      ['bottom-left', rect.left, rect.bottom, 1, -1],
      ['bottom-right', rect.right, rect.bottom, -1, -1]
    ];
    const samples = anchors.map(([name, x, y, dx, dy]) => {
      const inside = pixel(x + dx * 2, y + dy * 2);
      const reference = pixel(x + dx * 8, y + dy * 8);
      return {
        name,
        inside,
        reference,
        delta: delta(inside, reference),
        absoluteDelta: delta(inside, overlayExpectedRgb)
      };
    });
    const measuredDeltas = samples.map(sample => sample.delta).filter(Number.isFinite);
    const absoluteDeltas = samples.map(sample => sample.absoluteDelta).filter(Number.isFinite);
    const maxDelta = measuredDeltas.length > 0 ? Math.max(...measuredDeltas) : null;
    overlayPixels = {
      threshold: 8,
      expectedRgb: overlayExpectedRgb,
      samples,
      maxDelta,
      maxAbsoluteDelta: absoluteDeltas.length > 0 ? Math.max(...absoluteDeltas) : null,
      pass: maxDelta === null ? null : maxDelta <= 8
    };
  }

  if (iframeRect && canvasState?.stageRect) {
    const decoded = await decodeScreenshot(canvasScreenshotPath, 'canvas');
    const pixel = pixelReader(decoded);
    const rect = canvasState.stageRect;
    const points = [
      ['center', (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
      ['top-left', rect.left + 8, rect.top + 8],
      ['top-right', rect.right - 8, rect.top + 8],
      ['bottom-left', rect.left + 8, rect.bottom - 8],
      ['bottom-right', rect.right - 8, rect.bottom - 8],
      ['top-mid', (rect.left + rect.right) / 2, rect.top + 8],
      ['bottom-mid', (rect.left + rect.right) / 2, rect.bottom - 8]
    ];
    const samples = points.map(([name, x, y]) => {
      const rgb = pixel(x, y);
      return { name, rgb, absoluteDelta: delta(rgb, canvasExpectedRgb) };
    });
    const absoluteDeltas = samples.map(sample => sample.absoluteDelta).filter(Number.isFinite);
    canvasPixels = {
      probeTime: canvasProbeTime,
      expectedRgb: canvasExpectedRgb,
      samples,
      maxAbsoluteDelta: absoluteDeltas.length > 0 ? Math.max(...absoluteDeltas) : null
    };
  }

  const payload = {
    label,
    generatedBy: 'frame-engine-boot L1 probe',
    openResult,
    timings: {
      totalMs: Date.now() - startedAt,
      stageDetectedFromWebviewConnectMs,
      readyAfterStageMs
    },
    frameEngine: bootState,
    measurements: {
      overlay: { time: seekTime, state: overlayState },
      canvas: { time: canvasProbeTime, state: canvasState }
    },
    failLoud,
    iframeRect,
    screenshots: {
      overlay: `<out>/${path.basename(overlayScreenshotPath)}`,
      canvas: `<out>/${path.basename(canvasScreenshotPath)}`
    },
    overlayPixels,
    canvasPixels,
    webviewLogs: {
      console: consoleEntries,
      exceptions: exceptionEntries,
      entries: logEntries
    },
    mainPageLogs: {
      console: mainConsoleEntries,
      exceptions: mainExceptionEntries
    }
  };
  const redactedPayload = redact(payload);
  const leakedKeys = localPathValueKeys(redactedPayload);
  const payloadJson = JSON.stringify(redactedPayload, null, 2);
  if (leakedKeys.length > 0 || payloadJson.includes('/Users/')) {
    const keys = leakedKeys.length > 0 ? leakedKeys : ['<unknown string value>'];
    console.error(`[frame-engine-boot] local absolute path redaction failed: ${keys.join(', ')}`);
    throw new Error('frame-engine boot evidence still contains a local absolute path');
  }
  await writeFile(path.join(outDir, `${label}-measure.json`), `${payloadJson}\n`);
  console.log(JSON.stringify({
    timings: redactedPayload.timings,
    frameEngine: redactedPayload.frameEngine,
    overlayPixels: redactedPayload.overlayPixels,
    canvasPixels: redactedPayload.canvasPixels,
    failLoud: redactedPayload.failLoud
  }, null, 2));
} finally {
  await rm(scratch, { recursive: true, force: true });
  main?.close();
  view?.close();
}
