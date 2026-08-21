#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertTargetAttachPolicy, shouldAttachTarget } from './target-policy.mjs';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(fixtureDir, '..', '..');
const sourceProject = path.join(fixtureDir, 'generated-project');
const shellDir = path.join(worktree, 'apps', 'shell');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(fixtureDir, 'runs', stamp);
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'akari-shell-report-'));
const workspaceDir = path.join(isolatedRoot, 'workspace');
const editUri = pathToFileURL(path.join(workspaceDir, 'edit.json')).href;
const profileDir = path.join(isolatedRoot, 'profile');
const configDir = path.join(isolatedRoot, 'config');
const editPath = path.join(workspaceDir, 'edit.json');
const targetAttachPolicyCheck = assertTargetAttachPolicy();

const electronBinary = process.platform === 'darwin'
  ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : process.platform === 'win32'
    ? path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(shellDir, 'node_modules', 'electron', 'dist', 'electron');

await Promise.all([stat(sourceProject), stat(electronBinary)]);
await mkdir(runDir, { recursive: true });
await cp(sourceProject, workspaceDir, { recursive: true });
await Promise.all([mkdir(profileDir, { recursive: true }), mkdir(configDir, { recursive: true })]);

function sanitizeText(value) {
  let text = String(value ?? '');
  for (const [from, to] of [
    [worktree, '<WORKTREE>'],
    [isolatedRoot, '<ISOLATED>'],
    [os.homedir(), '<LOCAL_HOME>']
  ]) {
    text = text.split(`file://${from}`).join(`file://${to}`);
    text = text.split(from).join(to);
  }
  const userPrefix = `${path.sep}${'Users'}${path.sep}`;
  const homePrefix = `${path.sep}${'home'}${path.sep}`;
  const privateTempPrefix = `${path.sep}${'private'}${path.sep}${'tmp'}${path.sep}`;
  text = text.replace(new RegExp(`${userPrefix.replaceAll(path.sep, `\\${path.sep}`)}[^/]+/`, 'g'), '<LOCAL_HOME>/');
  text = text.replace(new RegExp(`${homePrefix.replaceAll(path.sep, `\\${path.sep}`)}[^/]+/`, 'g'), '<LOCAL_HOME>/');
  text = text.split(privateTempPrefix).join('<TEMP>/');
  return text;
}

function sanitizeValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(sanitizeText(JSON.stringify(value)));
}

class CDP {
  constructor(url, label) {
    this.url = url;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      if (!message.method) return;
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params, message.sessionId);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, listener) {
    const current = this.listeners.get(method) ?? [];
    current.push(listener);
    this.listeners.set(method, current);
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

function stackTraceValue(stackTrace) {
  if (!stackTrace) return null;
  return {
    description: stackTrace.description,
    callFrames: (stackTrace.callFrames ?? []).map(frame => ({
      functionName: frame.functionName,
      url: sanitizeText(frame.url),
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber
    })),
    parent: stackTraceValue(stackTrace.parent)
  };
}

function installEventWatchers(cdp, events, expectedSessionId, sourceLabel = cdp.label) {
  const accepts = actual => expectedSessionId === undefined
    ? actual === undefined
    : actual === expectedSessionId;
  cdp.on('Runtime.consoleAPICalled', (event, sessionId) => {
    if (!accepts(sessionId)) return;
    events.push({
      source: sourceLabel,
      method: 'Runtime.consoleAPICalled',
      type: event.type,
      args: (event.args ?? []).map(arg => sanitizeText(
        arg.value ?? arg.description ?? arg.unserializableValue ?? ''
      )),
      stackTrace: stackTraceValue(event.stackTrace)
    });
  });
  cdp.on('Runtime.exceptionThrown', (event, sessionId) => {
    if (!accepts(sessionId)) return;
    const details = event.exceptionDetails ?? {};
    events.push({
      source: sourceLabel,
      method: 'Runtime.exceptionThrown',
      text: sanitizeText(details.text),
      exception: sanitizeText(details.exception?.description ?? details.exception?.value ?? ''),
      url: sanitizeText(details.url ?? ''),
      lineNumber: details.lineNumber,
      columnNumber: details.columnNumber,
      stackTrace: stackTraceValue(details.stackTrace)
    });
  });
  cdp.on('Log.entryAdded', (event, sessionId) => {
    if (!accepts(sessionId)) return;
    const entry = event.entry ?? {};
    events.push({
      source: sourceLabel,
      method: 'Log.entryAdded',
      level: entry.level,
      text: sanitizeText(entry.text),
      url: sanitizeText(entry.url ?? ''),
      lineNumber: entry.lineNumber,
      stackTrace: stackTraceValue(entry.stackTrace)
    });
  });
}

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function browserDebuggerUrl(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const value = await response.json();
  if (!value.webSocketDebuggerUrl) throw new Error('browser debugger URL was not exposed');
  return value.webSocketDebuggerUrl;
}

async function waitForTargets(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    try {
      latest = await listTargets(port);
      if (latest.some(target => target.type === 'page')) return latest;
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP target was not ready: ${JSON.stringify(latest)}`);
}

async function evalOn(cdp, expression, contextId, sessionId) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const result = await cdp.send('Runtime.evaluate', params, sessionId);
  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${sanitizeText(JSON.stringify(result.exceptionDetails))}`);
  }
  return result.result.value;
}

class TargetScanner {
  constructor(cdp, events, mainTargetId) {
    this.cdp = cdp;
    this.events = events;
    this.mainTargetId = mainTargetId;
    this.sessions = new Map();
    this.contexts = new Map();
    this.networkEvents = [];
    this.targetInfos = [];
    this.attachErrors = [];
    this.scannerErrors = [];
    this.attemptedTargetIds = new Set();
    this.requestUrls = new Map();

    cdp.on('Runtime.executionContextCreated', (event, sessionId) => {
      if (!sessionId) return;
      const contexts = this.contexts.get(sessionId) ?? new Map();
      contexts.set(event.context.id, {
        id: event.context.id,
        origin: event.context.origin,
        name: event.context.name,
        auxData: event.context.auxData
      });
      this.contexts.set(sessionId, contexts);
    });
    cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => {
      this.contexts.get(sessionId)?.delete(event.executionContextId);
    });
    cdp.on('Runtime.executionContextsCleared', (_event, sessionId) => {
      if (sessionId) this.contexts.set(sessionId, new Map());
    });
    cdp.on('Target.detachedFromTarget', event => {
      for (const [targetId, session] of this.sessions) {
        if (session.sessionId === event.sessionId) {
          this.sessions.delete(targetId);
          this.contexts.delete(event.sessionId);
        }
      }
    });
    cdp.on('Network.requestWillBeSent', (event, sessionId) => {
      if (!sessionId || !this.sessionById(sessionId)) return;
      this.requestUrls.set(`${sessionId}:${event.requestId}`, event.request.url);
      this.networkEvents.push({
        source: this.sessionLabel(sessionId), method: 'Network.requestWillBeSent',
        requestId: event.requestId, url: event.request.url, resourceType: event.type
      });
    });
    cdp.on('Network.responseReceived', (event, sessionId) => {
      if (!sessionId || !this.sessionById(sessionId)) return;
      this.networkEvents.push({
        source: this.sessionLabel(sessionId), method: 'Network.responseReceived',
        requestId: event.requestId, url: event.response.url,
        status: event.response.status, statusText: event.response.statusText,
        mimeType: event.response.mimeType, fromDiskCache: event.response.fromDiskCache,
        fromServiceWorker: event.response.fromServiceWorker
      });
    });
    cdp.on('Network.loadingFinished', (event, sessionId) => {
      if (!sessionId || !this.sessionById(sessionId)) return;
      this.networkEvents.push({
        source: this.sessionLabel(sessionId), method: 'Network.loadingFinished',
        requestId: event.requestId,
        url: this.requestUrls.get(`${sessionId}:${event.requestId}`),
        encodedDataLength: event.encodedDataLength
      });
    });
    cdp.on('Network.loadingFailed', (event, sessionId) => {
      if (!sessionId || !this.sessionById(sessionId)) return;
      this.networkEvents.push({
        source: this.sessionLabel(sessionId), method: 'Network.loadingFailed',
        requestId: event.requestId,
        url: this.requestUrls.get(`${sessionId}:${event.requestId}`),
        errorText: event.errorText, canceled: event.canceled,
        blockedReason: event.blockedReason
      });
    });
  }

  sessionById(sessionId) {
    return [...this.sessions.values()].find(session => session.sessionId === sessionId);
  }

  sessionLabel(sessionId) {
    const session = this.sessionById(sessionId);
    return session ? `target:${session.info.type}:${session.info.targetId}` : `target:${sessionId}`;
  }

  async initialize() {
    await this.safeSend('Target.setDiscoverTargets', { discover: true });
    await this.refresh();
  }

  async safeSend(method, params, sessionId) {
    try {
      return await this.cdp.send(method, params, sessionId);
    } catch {
      return undefined;
    }
  }

  async refresh() {
    const result = await this.safeSend('Target.getTargets', {});
    if (!result) {
      this.scannerErrors.push({ method: 'Target.getTargets', error: 'request failed' });
      return;
    }
    this.targetInfos = result.targetInfos ?? [];
    for (const info of this.targetInfos) {
      if (!shouldAttachTarget(
        info,
        this.mainTargetId,
        this.attemptedTargetIds,
        new Set(this.sessions.keys())
      )) continue;
      this.attemptedTargetIds.add(info.targetId);
      try {
        const attached = await this.cdp.send('Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true
        });
        const session = { info, sessionId: attached.sessionId, attachedAt: Date.now() };
        this.sessions.set(info.targetId, session);
        this.contexts.set(attached.sessionId, new Map());
        installEventWatchers(this.cdp, this.events, attached.sessionId, this.sessionLabel(attached.sessionId));
        await this.safeSend('Runtime.enable', {}, attached.sessionId);
        await this.safeSend('Log.enable', {}, attached.sessionId);
        await this.safeSend('Network.enable', {}, attached.sessionId);
        await this.safeSend('Page.enable', {}, attached.sessionId);
      } catch (error) {
        this.attachErrors.push({ targetId: info.targetId, type: info.type, error: error.message });
      }
    }
  }

  async probeSession(session) {
    const expression = `(() => {
      if (typeof document === 'undefined') return { hasDocument: false };
      const previewVideo = document.getElementById('preview-video');
      const fallback = document.querySelector('[data-akari-3d-fallback]');
      const chapterTag = document.querySelector('[data-overlay-id="chapter-tag"]');
      return {
        hasDocument: true,
        hasPreviewVideo: Boolean(previewVideo),
        has3dFallback: Boolean(fallback),
        hasChapterTag: Boolean(chapterTag),
        title: document.title,
        href: typeof location === 'object' ? location.href : '',
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 240) ?? ''
      };
    })()`;
    const cdp = this.cdp;
    const sessionId = session.sessionId;
    const frames = new Map();
    try {
      const result = await cdp.send('Page.getFrameTree', {}, sessionId);
      const visit = (node, depth = 0) => {
        if (!node?.frame?.id) return;
        frames.set(node.frame.id, {
          id: node.frame.id, depth, url: node.frame.url,
          name: node.frame.name, parentId: node.frame.parentId
        });
        for (const child of node.childFrames ?? []) visit(child, depth + 1);
      };
      visit(result.frameTree);
    } catch {}
    const contexts = [...(this.contexts.get(session.sessionId)?.values() ?? [])];
    contexts.sort((left, right) => {
      const leftDepth = frames.get(left.auxData?.frameId)?.depth ?? -1;
      const rightDepth = frames.get(right.auxData?.frameId)?.depth ?? -1;
      if (leftDepth !== rightDepth) return rightDepth - leftDepth;
      return Number(Boolean(right.auxData?.isDefault)) - Number(Boolean(left.auxData?.isDefault));
    });
    const probes = [];
    for (const context of contexts) {
      try {
        const value = await evalOn(cdp, expression, context.id, sessionId);
        probes.push({ context, frame: frames.get(context.auxData?.frameId) ?? null, value });
      } catch (error) {
        probes.push({ context, frame: frames.get(context.auxData?.frameId) ?? null, error: error.message });
      }
    }
    if (contexts.length === 0) {
      try {
        probes.push({ context: null, value: await evalOn(cdp, expression, undefined, sessionId) });
      } catch (error) {
        probes.push({ context: null, error: error.message });
      }
    }
    return probes;
  }

  async probeAll() {
    await this.refresh();
    const probes = [];
    for (const session of this.sessions.values()) {
      const values = await this.probeSession(session);
      for (const probe of values) probes.push({ session, ...probe });
    }
    return probes;
  }

  async findPreviewOnce() {
    const probes = await this.probeAll();
    const withVideo = probes.filter(probe => probe.value?.hasPreviewVideo).sort((left, right) => {
      const leftScore = Number(Boolean(left.value?.hasChapterTag)) * 2
        + Number(Boolean(left.value?.has3dFallback));
      const rightScore = Number(Boolean(right.value?.hasChapterTag)) * 2
        + Number(Boolean(right.value?.has3dFallback));
      if (leftScore !== rightScore) return rightScore - leftScore;
      return (right.session.attachedAt ?? 0) - (left.session.attachedAt ?? 0);
    })[0];
    const withFallback = probes.find(probe => probe.value?.has3dFallback);
    const match = withVideo ?? withFallback;
    return {
      preview: match ? {
        cdp: this.cdp,
        sessionId: match.session.sessionId,
        targetId: match.session.info.targetId,
        targetType: match.session.info.type,
        contextId: match.context?.id,
        probe: match.value
      } : undefined,
      probes
    };
  }

  async findPreview(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let last = { preview: undefined, probes: [] };
    while (Date.now() < deadline) {
      last = await this.findPreviewOnce();
      if (last.preview?.probe?.hasPreviewVideo) return last.preview;
      await sleep(250);
    }
    throw new Error(`preview DOM context was not found: ${JSON.stringify(this.diagnostics(last.probes))}`);
  }

  diagnostics(probes = []) {
    return {
      targets: this.targetInfos.map(info => ({
        targetId: info.targetId, type: info.type, title: info.title,
        url: info.url, attached: info.attached
      })),
      attachErrors: this.attachErrors,
      scannerErrors: this.scannerErrors,
      mainTargetId: this.mainTargetId,
      attemptedTargetIds: [...this.attemptedTargetIds],
      attachedTargetIds: [...this.sessions.keys()],
      probes: probes.map(probe => ({
        targetId: probe.session.info.targetId,
        targetType: probe.session.info.type,
        context: probe.context,
        frame: probe.frame,
        value: probe.value,
        error: probe.error
      }))
    };
  }

  modelNetworkEvidence(modelUrl) {
    if (!modelUrl) return [];
    return this.networkEvents.filter(event => event.url === modelUrl
      || String(event.url ?? '').includes('laptop-slim-aluminum'));
  }
}

async function keyPress(cdp, key, code, virtualKey, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, modifiers
  });
  await sleep(20);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, modifiers
  });
}

async function realClick(cdp, x, y, options = {}) {
  const clickCount = options.clickCount ?? 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  for (let count = 1; count <= clickCount; count += 1) {
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count
    });
    await sleep(40);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: count
    });
    if (count < clickCount) await sleep(70);
  }
}

async function realDrag(cdp, start, end) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1
  });
  for (let step = 1; step <= 18; step += 1) {
    const ratio = step / 18;
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      button: 'left', buttons: 1
    });
    await sleep(20);
  }
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: end.x, y: end.y, button: 'left'
  });
}

async function screenshot(cdp, outputPath, sessionId) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await writeFile(outputPath, Buffer.from(result.data, 'base64'));
}

async function safeScreenshot(cdp, outputPath, sessionId) {
  try {
    await screenshot(cdp, outputPath, sessionId);
    return { ok: true, file: path.basename(outputPath) };
  } catch (error) {
    return { ok: false, file: path.basename(outputPath), error: error.message };
  }
}

async function executeTheiaCommand(main, commandId, argument) {
  return evalOn(main, `(async () => {
    try {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const CommandClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.executeCommand === 'function'
        && typeof key.prototype.registerCommand === 'function');
      if (!CommandClass) return { ok: false, error: 'command registry binding was not found' };
      const registry = window.theia.container.get(CommandClass);
      const value = await registry.executeCommand(${JSON.stringify(commandId)}, ${JSON.stringify(argument)});
      // returnByValue deep-serializes the result. A Theia command that resolves to a Widget
      // makes V8 answer "Object reference chain is too long" and poisons the whole run,
      // so only primitives are carried back.
      const primitive = value === null
        || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
      return { ok: true, valueType: typeof value, value: primitive ? value : undefined };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error), stack: error?.stack ?? null };
    }
  })()`);
}

async function openTimeline(main) {
  if (await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`)) return true;
  const command = await executeTheiaCommand(main, 'akari.annotations.open');
  if (command.ok) {
    for (let wait = 0; wait < 30; wait += 1) {
      if (await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`)) return true;
      await sleep(250);
    }
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await keyPress(main, 'F1', 'F1', 112);
    await sleep(500);
    await main.send('Input.insertText', { text: 'タイムラインを開く' });
    await sleep(500);
    await keyPress(main, 'Enter', 'Enter', 13);
    for (let wait = 0; wait < 30; wait += 1) {
      if (await evalOn(main, `Boolean(document.getElementById('akari-annotations-widget'))`)) return true;
      await sleep(250);
    }
  }
  return false;
}

async function dismissConsent(main) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const dismissed = await evalOn(main, `(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find(candidate => candidate.textContent?.trim() === '開くだけ');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (dismissed) return true;
    await sleep(300);
  }
  return false;
}

async function outputPreviewTitleState(main) {
  return evalOn(main, `(() => {
    const labels = Array.from(document.querySelectorAll(
      '.p-TabBar-tabLabel, .lm-TabBar-tabLabel, [class*="TabBar-tabLabel"], [title]'
    )).map(element => ({ text: element.textContent?.trim() ?? '', title: element.getAttribute('title') ?? '' }))
      .filter(value => value.text || value.title);
    return {
      found: labels.some(value => value.text === '出力プレビュー' || value.title === '出力プレビュー'),
      labels: labels.filter(value => value.text.includes('プレビュー') || value.title.includes('プレビュー'))
    };
  })()`);
}

async function editCardPoint(main) {
  return evalOn(main, `(() => {
    const nodes = Array.from(document.querySelectorAll('span'));
    const hit = nodes.find(element => {
      const own = Array.from(element.childNodes).filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim()).join('');
      return own.includes('edit.json');
    });
    if (!hit) return null;
    const rect = hit.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      text: hit.textContent, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  })()`);
}

async function openOutputPreview(main, scanner, editUri) {
  let method = 'ensure-visible-command';
  let card = null;
  // The preview open handler registers akari.preview.ensureVisible, which opens the widget
  // when it is not open yet and resolves to 'opened' | 'revealed' | 'unavailable'.
  const command = await executeTheiaCommand(main, 'akari.preview.ensureVisible', { editUri });
  const commandOpened = command.ok && (command.value === 'opened' || command.value === 'revealed');
  if (!commandOpened) {
    // Fallback: the home card. A single click only selects it; the open needs the
    // following double click, so both are dispatched in order.
    method = 'edit-card';
    for (let attempt = 0; attempt < 12 && !card; attempt += 1) {
      card = await editCardPoint(main);
      if (!card) await sleep(500);
    }
    if (!card) throw new Error(`the visible edit.json card was not found: ${JSON.stringify(command)}`);
    await realClick(main, card.x, card.y, { clickCount: 1 });
    await sleep(400);
    card = (await editCardPoint(main)) ?? card;
    await realClick(main, card.x, card.y, { clickCount: 2 });
  }
  const preview = await scanner.findPreview(30000);
  let titleState = await outputPreviewTitleState(main);
  for (let attempt = 0; attempt < 40 && !titleState.found; attempt += 1) {
    await sleep(250);
    titleState = await outputPreviewTitleState(main);
  }
  if (!titleState.found) throw new Error(`output preview title was not found: ${JSON.stringify(titleState)}`);
  if (!preview?.probe?.hasPreviewVideo) throw new Error('output preview DOM has no #preview-video');
  return { preview, method, card, command, titleState, target: {
    targetId: preview.targetId, targetType: preview.targetType,
    contextId: preview.contextId, probe: preview.probe
  } };
}

async function itemRect(main, id) {
  return evalOn(main, `(() => {
    const element = document.querySelector('[data-akari-item-id=${JSON.stringify(id)}]');
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY)?.closest?.('[data-akari-item-id]');
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
      centerX, centerY,
      kind: element.dataset.akariItemKind, lane: element.dataset.akariLane,
      className: element.className, text: element.textContent,
      hitItemId: hit?.dataset?.akariItemId ?? null,
      hitItemKind: hit?.dataset?.akariItemKind ?? null
    };
  })()`);
}

async function clickTimelineItemWithRetry(main, id, maxAttempts = 3) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const beforeEvents = events.length;
    const beforeState = await timelineState(main);
    const beforeInstrumented = beforeState.instrumentedErrors.length;
    const rect = await itemRect(main, id);
    if (!rect) {
      attempts.push({ attempt, error: `timeline item ${id} was not found` });
      continue;
    }
    if (rect.hitItemId !== id) {
      attempts.push({
        attempt, rect, selectedAsIntended: false,
        error: `elementFromPoint resolved ${rect.hitItemId ?? 'nothing'} instead of ${id}`
      });
      await sleep(100);
      continue;
    }
    await realClick(main, rect.centerX, rect.centerY);
    await sleep(650);
    const state = await timelineState(main);
    const newEvents = events.slice(beforeEvents);
    const selectedAsIntended = state.selected.some(item => item.id === id);
    attempts.push({
      attempt,
      rect,
      selectedAsIntended,
      selected: state.selected,
      inspectorClipName: state.inspectorClipName,
      runtimeExceptions: newEvents.filter(event => event.method === 'Runtime.exceptionThrown'),
      otherErrors: newEvents.filter(event => event.method !== 'Runtime.exceptionThrown'
        && (event.type === 'error' || event.level === 'error')),
      instrumentedErrors: state.instrumentedErrors.slice(beforeInstrumented)
    });
    if (selectedAsIntended) break;
  }
  const final = attempts.at(-1) ?? {};
  return {
    id,
    ok: Boolean(final.selectedAsIntended),
    attempts,
    rect: final.rect ?? null,
    selected: final.selected ?? [],
    inspectorClipName: final.inspectorClipName ?? null,
    runtimeExceptions: attempts.flatMap(attempt => attempt.runtimeExceptions ?? []),
    otherErrors: attempts.flatMap(attempt => attempt.otherErrors ?? []),
    instrumentedErrors: attempts.flatMap(attempt => attempt.instrumentedErrors ?? [])
  };
}

async function installWidgetStackCapture(main) {
  return evalOn(main, `(() => {
    try {
      window.__shellFieldInstrumentedErrors = window.__shellFieldInstrumentedErrors ?? [];
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const WidgetClass = keys.find(key => typeof key === 'function' && key.prototype
        && typeof key.prototype.pathBaseName === 'function'
        && typeof key.prototype.snapshotForSelection === 'function'
        && typeof key.prototype.commitEditV2Drag === 'function');
      if (!WidgetClass) return { ok: false, error: 'annotations widget class was not found' };
      const prototype = WidgetClass.prototype;
      if (!prototype.__shellFieldPathBaseNameWrapped) {
        const original = prototype.pathBaseName;
        Object.defineProperty(prototype, '__shellFieldPathBaseNameWrapped', { value: true });
        prototype.pathBaseName = function (value) {
          try {
            return original.call(this, value);
          } catch (error) {
            window.__shellFieldInstrumentedErrors.push({
              method: 'pathBaseName', valueType: typeof value,
              value: value ?? null, message: error?.message ?? String(error),
              stack: error?.stack ?? null
            });
            throw error;
          }
        };
      }
      return { ok: true, className: WidgetClass.name };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error), stack: error?.stack ?? null };
    }
  })()`);
}

async function timelineState(main) {
  return evalOn(main, `(() => {
    const rect = element => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height };
    };
    const widget = document.getElementById('akari-annotations-widget');
    const rows = Array.from(document.querySelectorAll('.akari-inspector-row')).map(row => ({
      label: row.querySelector('.akari-inspector-row-label')?.textContent?.trim() ?? '',
      value: row.querySelector('.akari-inspector-row-value, .akari-inspector-row-scrub')?.textContent?.trim() ?? ''
    })).filter(row => row.label);
    const timelineText = widget?.innerText ?? '';
    const ownText = element => Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join(' ');
    const notices = widget ? Array.from(widget.querySelectorAll('*')).map(ownText)
      .filter(text => text.includes('タイムラインを更新できません')) : [];
    return {
      selected: Array.from(document.querySelectorAll('.akari-annotations-selected')).map(element => ({
        id: element.dataset.akariItemId,
        kind: element.dataset.akariItemKind,
        className: element.className
      })),
      inspectorFields: rows,
      inspectorClipName: rows.find(row => row.label === 'クリップ')?.value ?? null,
      timelineText,
      invalidCaptionWarning: timelineText.includes('時刻または内容が不正'),
      captionLaneEmpty: timelineText.includes('字幕 (空)'),
      captionItems: Array.from(document.querySelectorAll('[data-akari-item-kind="caption"]')).map(element => ({
        id: element.dataset.akariItemId, text: element.textContent, className: element.className,
        rect: rect(element)
      })),
      notices,
      capturedErrors: window.__shellFieldErrors ?? [],
      instrumentedErrors: window.__shellFieldInstrumentedErrors ?? []
    };
  })()`);
}

async function previewDom() {
  if (!scanner) throw new Error('Target scanner is unavailable');
  const preview = await scanner.findPreview(30000);
  const value = await evalOn(preview.cdp, `(() => {
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height };
    };
    const insetPixels = (clipPath, containerRect) => {
      const match = /^inset\\(([^)]*)\\)/.exec(clipPath);
      if (!match) return null;
      const raw = match[1].split(/\\s+round\\s+/)[0].trim().split(/\\s+/);
      const values = raw.length === 1 ? [raw[0], raw[0], raw[0], raw[0]]
        : raw.length === 2 ? [raw[0], raw[1], raw[0], raw[1]]
          : raw.length === 3 ? [raw[0], raw[1], raw[2], raw[1]] : raw.slice(0, 4);
      const px = (token, size) => token.endsWith('%') ? parseFloat(token) / 100 * size : parseFloat(token);
      return {
        top: px(values[0], containerRect.height), right: px(values[1], containerRect.width),
        bottom: px(values[2], containerRect.height), left: px(values[3], containerRect.width),
        tokens: values
      };
    };
    const video = document.getElementById('preview-video');
    const caption = document.getElementById('caption-plate');
    const scene = document.querySelector('[data-overlay-id="laptop-3d"]');
    const fallback = scene?.querySelector('[data-akari-3d-fallback]');
    const canvas = scene?.querySelector('canvas');
    const descriptorElement = scene?.querySelector('script[type="application/json"][data-akari-3d-scene]');
    let descriptor = null;
    try { descriptor = JSON.parse(descriptorElement?.textContent ?? 'null'); } catch {}
    const chapter = document.querySelector('[data-overlay-id="chapter-tag"]');
    const title = chapter?.querySelector('.ref3-chapter-tag__title');
    const row = chapter?.querySelector('.ref3-chapter-tag__row');
    const root = chapter?.querySelector('.ref3-chapter-tag');
    const clipPath = chapter ? getComputedStyle(chapter).clipPath : '';
    const chapterRect = rect(chapter);
    const insets = chapterRect ? insetPixels(clipPath, chapterRect) : null;
    const clipRight = chapterRect && insets ? chapterRect.right - insets.right : null;
    const titleRect = rect(title);
    const rowRect = rect(row);
    const contentRight = Math.max(titleRect?.right ?? -Infinity, rowRect?.right ?? -Infinity);
    const resources = performance.getEntriesByType('resource').map(entry => ({
      name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration,
      transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      ...(typeof entry.responseStatus === 'number' ? { responseStatus: entry.responseStatus } : {})
    }));
    return {
      document: { title: document.title, href: location.href, readyState: document.readyState },
      video: video ? { currentTime: video.currentTime, paused: video.paused, readyState: video.readyState } : null,
      seek: document.getElementById('seek')?.value ?? null,
      timeLabel: document.getElementById('time-label')?.textContent ?? null,
      caption: caption ? {
        text: caption.textContent, html: caption.innerHTML,
        visibility: getComputedStyle(caption).visibility,
        display: getComputedStyle(caption).display,
        opacity: getComputedStyle(caption).opacity, rect: rect(caption)
      } : null,
      scene3d: scene ? {
        containerRect: rect(scene), containerVisibility: getComputedStyle(scene).visibility,
        descriptor,
        fallback: fallback ? {
          text: fallback.textContent, hidden: fallback.hidden,
          display: getComputedStyle(fallback).display,
          visibility: getComputedStyle(fallback).visibility, rect: rect(fallback)
        } : null,
        canvas: canvas ? {
          rect: rect(canvas), width: canvas.width, height: canvas.height,
          display: getComputedStyle(canvas).display
        } : null,
        runtime: window.akari.threeRuntime?.inspect?.(scene) ?? null,
        resourceEntries: resources.filter(entry => entry.name === descriptor?.model
          || entry.name.includes('laptop-slim-aluminum'))
      } : null,
      chapter: chapter ? {
        text: title?.textContent ?? null, visibility: getComputedStyle(chapter).visibility,
        clipPath, clipInsets: insets, containerRect: chapterRect,
        rootRect: rect(root), rowRect, titleRect, contentRight, clipRight,
        contentRightMinusClipRight: Number.isFinite(contentRight) && clipRight !== null
          ? contentRight - clipRight : null
      } : null
    };
  })()`, preview.contextId, preview.sessionId);
  return {
    ...value,
    resolvedContext: {
      targetId: preview.targetId,
      targetType: preview.targetType,
      contextId: preview.contextId,
      probe: preview.probe
    }
  };
}

async function seekOutputTime(outputTime) {
  if (!scanner) throw new Error(`output seek ${outputTime} failed: Target scanner is unavailable`);
  const preview = await scanner.findPreview(30000);
  const result = await evalOn(preview.cdp, `(() => {
    const seek = document.getElementById('seek');
    if (!seek) return { ok: false, error: '#seek was not found' };
    seek.value = String(${outputTime});
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: seek.value };
  })()`, preview.contextId, preview.sessionId);
  if (!result?.ok) throw new Error(`output seek ${outputTime} failed: ${JSON.stringify(result)}`);
  await sleep(650);
  return {
    route: 'existing-preview-dom',
    result,
    resolvedContext: {
      targetId: preview.targetId,
      targetType: preview.targetType,
      contextId: preview.contextId,
      probe: preview.probe
    }
  };
}

function relevantEvents(events, start = 0) {
  return events.slice(start).filter(event => event.method === 'Runtime.exceptionThrown'
    || event.type === 'error' || event.level === 'error');
}

function threeErrorEvents(events) {
  return events.filter(event => {
    const text = JSON.stringify(event);
    return (event.method === 'Runtime.exceptionThrown' || event.type === 'error' || event.level === 'error')
      && /akari-three|3D scene|WebGL|GLTF|\.glb/iu.test(text);
  });
}

async function readEditItem(id) {
  const edit = JSON.parse(await readFile(editPath, 'utf8'));
  return edit.tracks.flatMap(track => track.items ?? []).find(item => item.id === id);
}

async function terminateExactProcess(child, lifecycle) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  lifecycle.push({ action: 'SIGTERM', pid: child.pid });
  process.kill(child.pid, 'SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    sleep(5000).then(() => false)
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    lifecycle.push({ action: 'SIGKILL', pid: child.pid });
    process.kill(child.pid, 'SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

const symptoms = ['②', '③', '⑤', '⑥', '⑨'];
const events = [];
const observations = [];
const symptomResults = [];
const electronOutput = { stdout: [], stderr: [] };
const lifecycle = [];
let child;
let main;
let browserCdp;
let scanner;
let fatalFailure;
let timelineReady = false;
let timelineBaseline;
let previewOpen;
let previewOpenError;
let instrumentation;

function record(step, data) {
  const entry = { step, data: sanitizeValue(data) };
  observations.push(entry);
  console.log(`[${step}] ${JSON.stringify(entry.data)}`);
  return entry.data;
}

async function observeSymptom(symptom, operation) {
  try {
    const result = await operation();
    const entry = {
      symptom,
      verdict: result.verdict,
      evidence: sanitizeValue(result.evidence ?? {}),
      ...(result.error ? { error: sanitizeText(result.error) } : {})
    };
    symptomResults.push(entry);
    record(`symptom-${symptom}`, entry);
  } catch (error) {
    const entry = {
      symptom,
      verdict: 'not-observed',
      evidence: {},
      error: sanitizeText(error?.stack ?? error?.message ?? String(error))
    };
    symptomResults.push(entry);
    record(`symptom-${symptom}`, entry);
  }
}

async function requirePreview() {
  if (!scanner) throw new Error('Target scanner is unavailable');
  return scanner.findPreview(12000);
}

try {
  const port = Number(process.env.AKARI_CDP_PORT) || 18000 + (process.pid % 20000);
  child = spawn(electronBinary, [
    shellDir,
    workspaceDir,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-sandbox'
  ], {
    cwd: shellDir,
    env: { ...process.env, THEIA_CONFIG_DIR: configDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  lifecycle.push({ action: 'spawn', pid: child.pid, port });
  child.on('exit', (code, signal) => {
    lifecycle.push({ action: 'exit', pid: child.pid, code, signal });
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => electronOutput.stdout.push(sanitizeText(chunk)));
  child.stderr.on('data', chunk => electronOutput.stderr.push(sanitizeText(chunk)));

  const targets = await waitForTargets(port);
  const mainTarget = targets.find(target => target.type === 'page' && !target.url.startsWith('devtools:'));
  if (!mainTarget) throw new Error('main page target was not found');
  if (!mainTarget.id) throw new Error('main page target id was not exposed');

  main = new CDP(mainTarget.webSocketDebuggerUrl, 'main');
  await main.connect();
  installEventWatchers(main, events, undefined, 'main');
  await main.send('Page.enable');
  await main.send('Runtime.enable');
  await main.send('Log.enable');
  await main.send('Network.enable');
  await main.send('DOM.enable');

  browserCdp = new CDP(await browserDebuggerUrl(port), 'browser');
  await browserCdp.connect();
  scanner = new TargetScanner(browserCdp, events, mainTarget.id);
  await scanner.initialize();

  await evalOn(main, `(() => {
    window.resizeTo(1600, 1200);
    window.__shellFieldErrors = [];
    window.__shellFieldInstrumentedErrors = [];
    window.addEventListener('error', event => {
      window.__shellFieldErrors.push({ message: event.message, stack: event.error?.stack ?? null });
    });
    window.addEventListener('unhandledrejection', event => {
      window.__shellFieldErrors.push({ message: String(event.reason), stack: event.reason?.stack ?? null });
    });
    return true;
  })()`);
  await sleep(700);
  const consentDismissed = await dismissConsent(main);

  try {
    previewOpen = await openOutputPreview(main, scanner, editUri);
    record('preview-open', previewOpen);
    record('preview-open-screenshot', await safeScreenshot(
      previewOpen.preview.cdp,
      path.join(runDir, 'preview-open.png'),
      previewOpen.preview.sessionId
    ));
  } catch (error) {
    previewOpenError = { message: error.message, stack: error.stack };
    let targetDiagnostics;
    try {
      const probe = await scanner.findPreviewOnce();
      targetDiagnostics = scanner.diagnostics(probe.probes);
    } catch (diagnosticError) {
      targetDiagnostics = { error: diagnosticError.message };
    }
    record('preview-open-failed', {
      error: previewOpenError,
      targetDiagnostics
    });
  }

  timelineReady = await openTimeline(main);
  if (timelineReady) {
    await sleep(1200);
    timelineBaseline = await timelineState(main);
    instrumentation = await installWidgetStackCapture(main);
    record('timeline-baseline', { timelineBaseline, instrumentation });
    record('timeline-open-screenshot', await safeScreenshot(main, path.join(runDir, 'timeline-open.png')));
  } else {
    record('timeline-open-failed', { error: 'timeline widget did not open' });
  }

  if (!previewOpen && timelineReady) {
    try {
      previewOpen = await openOutputPreview(main, scanner);
      previewOpenError = undefined;
      record('preview-open-after-timeline', previewOpen);
      record('preview-open-after-timeline-screenshot', await safeScreenshot(
        previewOpen.preview.cdp,
        path.join(runDir, 'preview-open.png'),
        previewOpen.preview.sessionId
      ));
    } catch (error) {
      previewOpenError = { message: error.message, stack: error.stack };
      record('preview-open-after-timeline-failed', { error: previewOpenError });
    }
  }

  record('boot', {
    electronPid: child.pid, cdpPort: port, consentDismissed,
    outputPreviewTitle: await outputPreviewTitleState(main),
    previewOpenError, timelineReady
  });

  await observeSymptom('②', async () => {
    if (!timelineReady) throw new Error('timeline is unavailable');
    const acceptance = await timelineState(main);
    if (acceptance.invalidCaptionWarning || acceptance.captionLaneEmpty || acceptance.captionItems.length !== 4) {
      throw new Error(`caption fixture was rejected: ${JSON.stringify({
        invalidCaptionWarning: acceptance.invalidCaptionWarning,
        captionLaneEmpty: acceptance.captionLaneEmpty,
        captionCount: acceptance.captionItems.length
      })}`);
    }
    const cases = [
      { name: 'first-retained', outputTime: 0.5, expected: '残っている1本目の字幕' },
      { name: 'must-not-appear-before-gap', outputTime: 1.5, expected: '' },
      { name: 'cross-deletion-before', outputTime: 2.5, expected: '削除区間をまたぐ字幕' },
      { name: 'output-gap', outputTime: 3.5, expected: '出力gap数値の字幕' },
      { name: 'cross-deletion-after', outputTime: 4.5, expected: '削除区間をまたぐ字幕' },
      { name: 'second-retained', outputTime: 5.5, expected: '残っている2本目の字幕' },
      { name: 'no-cue', outputTime: 7.5, expected: '' }
    ];
    const measurements = [];
    for (const sample of cases) {
      const seekResult = await seekOutputTime(sample.outputTime);
      const dom = await previewDom();
      measurements.push({ ...sample, actual: dom.caption?.text ?? null,
        rect: dom.caption?.rect ?? null, seek: dom.seek, timeLabel: dom.timeLabel,
        video: dom.video, seekResult });
    }
    const mismatches = measurements.filter(sample => sample.actual !== sample.expected);
    return {
      verdict: mismatches.length > 0 ? 'reproduced' : 'not-reproduced',
      evidence: {
        timeline: {
          invalidCaptionWarning: acceptance.invalidCaptionWarning,
          captionLaneEmpty: acceptance.captionLaneEmpty,
          captionItems: acceptance.captionItems
        },
        measurements, mismatches
      }
    };
  });

  await observeSymptom('③', async () => {
    const eventStart = events.length;
    const seekResult = await seekOutputTime(1.0);
    let dom;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      dom = await previewDom();
      const status = dom.scene3d?.runtime?.status;
      if (status === 'ready' || status === 'error'
        || (dom.scene3d?.fallback?.hidden === true && dom.scene3d?.fallback?.display === 'none')) break;
      await sleep(250);
    }
    if (!dom?.scene3d?.fallback) throw new Error('laptop 3D fallback DOM was not found');
    const modelUrl = dom.scene3d.descriptor?.model;
    const fallbackVisible = dom.scene3d.fallback.hidden === false
      && dom.scene3d.fallback.display !== 'none';
    const loadingText = String(dom.scene3d.fallback.text ?? '').includes('読み込み中');
    return {
      verdict: fallbackVisible && loadingText ? 'reproduced' : 'not-reproduced',
      evidence: {
        dom: dom.scene3d,
        seekResult,
        modelUrl,
        network: scanner.modelNetworkEvidence(modelUrl),
        console: [...threeErrorEvents(events), ...relevantEvents(events, eventStart)]
      }
    };
  });

  await observeSymptom('⑤', async () => {
    const samples = [];
    for (const localTime of [0, 0.15, 0.3, 1.0]) {
      const seekResult = await seekOutputTime(localTime);
      const dom = await previewDom();
      if (!dom.chapter?.titleRect || !dom.chapter?.rowRect) {
        throw new Error(`chapter DOM was not measurable at ${localTime}`);
      }
      samples.push({ localTime, seekResult, ...dom.chapter });
    }
    const clipped = samples.filter(sample => sample.contentRightMinusClipRight > 0.5);
    const preview = await requirePreview();
    const screenshotResult = await safeScreenshot(
      preview.cdp,
      path.join(runDir, 'symptom-05-chapter.png'),
      preview.sessionId
    );
    return {
      verdict: clipped.length > 0 ? 'reproduced' : 'not-reproduced',
      evidence: { samples, clipped, screenshot: screenshotResult }
    };
  });

  await observeSymptom('⑥', async () => {
    if (!timelineReady) throw new Error('timeline is unavailable');
    if (!instrumentation?.ok) throw new Error(`widget stack capture unavailable: ${JSON.stringify(instrumentation)}`);

    const simpleHtml = await clickTimelineItemWithRetry(main, 'simple-html');
    const chapterHtml = await clickTimelineItemWithRetry(main, 'chapter-tag');
    const nativeTelop = await clickTimelineItemWithRetry(main, 'native-telop');
    const htmlSucceeded = simpleHtml.ok && chapterHtml.ok
      && simpleHtml.runtimeExceptions.length === 0 && chapterHtml.runtimeExceptions.length === 0
      && simpleHtml.instrumentedErrors.length === 0 && chapterHtml.instrumentedErrors.length === 0;
    if (!htmlSucceeded) {
      return {
        verdict: 'not-observed',
        error: 'HTML comparison selection did not complete cleanly',
        evidence: { simpleHtml, chapterHtml, nativeTelop }
      };
    }
    const nativeSelected = nativeTelop.ok;
    const nativeErrored = nativeTelop.runtimeExceptions.length > 0 || nativeTelop.instrumentedErrors.length > 0;
    return {
      verdict: !nativeSelected || nativeErrored ? 'reproduced' : 'not-reproduced',
      evidence: { simpleHtml, chapterHtml, nativeTelop }
    };
  });

  await observeSymptom('⑨', async () => {
    if (!timelineReady) throw new Error('timeline is unavailable');
    const beforeEvents = events.length;
    const beforeState = await timelineState(main);
    const beforeInstrumented = beforeState.instrumentedErrors.length;
    const beforeItem = await readEditItem('native-telop');
    let rect;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      rect = await itemRect(main, 'native-telop');
      if (rect?.hitItemId === 'native-telop') break;
      await sleep(100);
    }
    if (!rect || rect.hitItemId !== 'native-telop' || !beforeItem) {
      throw new Error(`native-telop drag precondition was not met: ${JSON.stringify(rect)}`);
    }
    await realDrag(main,
      { x: rect.centerX, y: rect.centerY },
      { x: rect.centerX + 70, y: rect.centerY });
    await sleep(1800);
    const afterItem = await readEditItem('native-telop');
    const state = await timelineState(main);
    const notice = state.notices.find(text => text.includes('タイムラインを更新できません'))
      ?? (state.timelineText.match(/タイムラインを更新できません:[^\n]*/)?.[0] ?? null);
    const newEvents = events.slice(beforeEvents);
    const evidence = {
      rect, beforeAt: beforeItem.at, afterAt: afterItem?.at,
      notice, selected: state.selected,
      runtimeExceptions: newEvents.filter(event => event.method === 'Runtime.exceptionThrown'),
      otherErrors: newEvents.filter(event => event.method !== 'Runtime.exceptionThrown'
        && (event.type === 'error' || event.level === 'error')),
      instrumentedErrors: state.instrumentedErrors.slice(beforeInstrumented)
    };
    evidence.screenshot = await safeScreenshot(main, path.join(runDir, 'symptom-09-drag.png'));
    if (notice) return { verdict: 'reproduced', evidence };
    if (afterItem?.at !== beforeItem.at) return { verdict: 'not-reproduced', evidence };
    return { verdict: 'not-observed', evidence, error: 'drag produced neither a write nor an error notice' };
  });
} catch (error) {
  fatalFailure = { message: sanitizeText(error?.message), stack: sanitizeText(error?.stack) };
  console.error(fatalFailure.stack);
} finally {
  for (const symptom of symptoms) {
    if (!symptomResults.some(result => result.symptom === symptom)) {
      symptomResults.push({
        symptom,
        verdict: 'not-observed',
        evidence: {},
        error: fatalFailure?.stack ?? 'driver stopped before this symptom'
      });
    }
  }

  main?.close();
  browserCdp?.close();
  await terminateExactProcess(child, lifecycle).catch(error => {
    lifecycle.push({ action: 'terminate-error', message: sanitizeText(error.message) });
  });
  await rm(isolatedRoot, { recursive: true, force: true });
  lifecycle.push({ action: 'remove-isolated-workspace', removed: true });

  const hasNotObserved = symptomResults.some(result => result.verdict === 'not-observed');
  const status = fatalFailure ? 'FAIL' : hasNotObserved ? 'PARTIAL' : 'PASS';
  const maximumCallStackEvents = events.filter(event =>
    String(event.exception ?? event.text ?? event.args?.join(' ') ?? '').includes('Maximum call stack size exceeded'));
  const runContext = {
    targetAttachPolicyCheck,
    outputPreview: previewOpen ? {
      method: previewOpen.method,
      titleState: previewOpen.titleState,
      target: previewOpen.target
    } : null,
    outputPreviewError: previewOpenError,
    timelineReady,
    timelineBaseline: timelineBaseline ? {
      invalidCaptionWarning: timelineBaseline.invalidCaptionWarning,
      captionLaneEmpty: timelineBaseline.captionLaneEmpty,
      captionCount: timelineBaseline.captionItems.length
    } : null,
    instrumentation,
    maximumCallStack: {
      relationToFiveSymptoms: 'unclassified',
      events: maximumCallStackEvents
    },
    targetDiagnostics: scanner?.diagnostics() ?? null
  };
  const summary = sanitizeValue({ status, symptoms: symptomResults, runContext });
  const observation = sanitizeValue({
    status,
    failure: fatalFailure,
    lifecycle,
    observations,
    events,
    networkEvents: scanner?.networkEvents ?? [],
    electronOutput,
    symptoms: symptomResults,
    runContext
  });
  await writeFile(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(runDir, 'observation.json'), `${JSON.stringify(observation, null, 2)}\n`);
  await writeFile(path.join(runDir, 'console.json'), `${JSON.stringify(observation.events, null, 2)}\n`);
  console.log(path.relative(worktree, runDir));

  if (fatalFailure || hasNotObserved) process.exitCode = 1;
}
