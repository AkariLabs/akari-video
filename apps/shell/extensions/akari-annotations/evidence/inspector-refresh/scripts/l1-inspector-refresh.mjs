#!/usr/bin/env node
// Based on evidence/inspector-section-collapse/scripts/l1-inspector-section-collapse.mjs.
// Execute explicitly: importing this module never launches Electron.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';

const EVIDENCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKTREE = path.resolve(EVIDENCE, '../../../../../..');
const INSPECTOR = '[data-akari-ui="panel:inspector"]';
const REVIEW = '[data-akari-ui="panel:review"]';
const FIELD = 'transform-x';
const FPS = 30;
const S = JSON.stringify;
const UI_TIMEOUT_MS = Math.max(180_000, Number(process.env.AKARI_CDP_TIMEOUT_MS ?? 10_000) * 2);

function argumentsFor(argv) {
  const options = { port: 9456, shell: path.join(WORKTREE, 'apps/shell'), label: 'after' };
  for (const arg of argv) {
    const match = /^--(port|shell|label|out)=(.+)$/u.exec(arg);
    assert.ok(match, `Unknown or empty argument: ${arg}`);
    options[match[1]] = match[1] === 'port' ? Number(match[2]) : match[2];
  }
  assert.ok(Number.isInteger(options.port) && options.port > 0 && options.port < 65536, 'Invalid --port');
  assert.ok(['before', 'after'].includes(options.label), '--label must be before or after');
  assert.ok(path.isAbsolute(options.shell), '--shell must be absolute');
  options.shell = path.resolve(options.shell);
  options.out = path.resolve(options.out ?? path.join(EVIDENCE, options.label));
  return options;
}

function fixtureEdit() {
  // v2 item.at/duration/keyframe.t are integer frames; source.in/out remain seconds.
  // Sources: test/timeline-keyframe-rows.test.mjs and packages/edit-store/test/tree-ops.test.mjs.
  return {
    version: 2, output: { width: 1280, height: 720, fps: FPS },
    sources: ['a', 'b'].map(name => ({ id: `video-${name}`, path: `assets/video/${name}.mp4` })),
    tracks: [{ id: 'visual-main', lane: 'visual', items: ['a', 'b'].map((name, i) => ({
      id: `clip-${name}`, at: i * 90, duration: 90,
      source: { kind: 'media', src: `video-${name}`, in: 0, out: 3 },
      ...(i === 0 ? { transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        keyframes: [0, 30, 60, 90].map((t, n) => ({ t, transform: { x: n * 20 }, easing: 'linear' })) } : {})
    })) }], audio: { narration: [], sfx: [] }
  };
}

async function ensureFreePort(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Port ${port} is occupied; refusing to attach`)); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(error); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error(`Port ${port} probe timed out`)); });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFor(argv);
  const shellRepo = path.resolve(options.shell, '../..');
  const result = { label: options.label, status: 'running', startedAt: new Date().toISOString(),
    options: { ...options, out: '.' }, fixture: null, themes: [], measurements: [], interactions: [], checks: [], screenshots: [] };
  let iso, project, child, cdp, launchError, interrupted;
  let electronLog = '';
  const started = Date.now();
  const signal = name => { interrupted = new Error(`Interrupted by ${name}`); };
  const onInt = () => signal('SIGINT'), onTerm = () => signal('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  const ensureRunning = () => {
    if (interrupted) throw interrupted;
    if (launchError) throw launchError;
    if (cdp?.ws?.readyState === WebSocket.CLOSED) throw new Error('CDP target connection closed');
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Owned Electron exited unexpectedly');
  };
  let pathAliases = [], aliasedIso;
  function scrub(value) {
    if (typeof value === 'string') {
      // Resolve each stable root once, not once per string in the growing results tree.
      // Keep the canonical temp alias after cleanup removes the directory.
      if (!pathAliases.length || aliasedIso !== iso) {
        aliasedIso = iso;
        const roots = [[iso, '<TMP>'], [options.out, `<WORKTREE>/evidence/inspector-refresh/${options.label}`],
          [shellRepo, '<WORKTREE>'], [WORKTREE, '<WORKTREE>'],
          [os.homedir(), '<HOME>'], [os.tmpdir(), '<TMP>']].filter(([root]) => root);
        const aliases = new Map();
        for (const [root, label] of roots) {
          const forms = [root, root.replaceAll('\\', '/'), encodeURI(root)];
          try { forms.push(realpathSync(root)); } catch { /* Missing output/temp root. */ }
          for (const form of forms) if (!aliases.has(form)) aliases.set(form, label);
        }
        pathAliases = [...aliases].sort((a, b) => b[0].length - a[0].length);
      }
      for (const [root, label] of pathAliases) value = value.replaceAll(root, label);
      return value.replace(/\/(?:private\/)?var\/folders\/[^\s)'"\]]+/gu, '<TMP>')
        .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), scrub(item)]));
    return value;
  }
  async function save() {
    const filename = path.join(options.out, 'results.json');
    const temporary = `${filename}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(scrub(result), null, 2)}\n`);
    await rename(temporary, filename);
  }
  const page = (fn, ...args) => evalOn(cdp, `(${fn.toString()})(${args.map(S).join(',')})`);
  async function waitFor(read, label, timeout = UI_TIMEOUT_MS) {
    console.log(`[L1] waiting: ${label}`);
    result.stage = label;
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      ensureRunning();
      try { const value = await read(); if (value) return value; } catch (error) { last = error; }
      await sleep(120);
    }
    throw new Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
  }
  const settle = () => page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
  function check(name, passed, actual) {
    result.checks.push({ name, passed: Boolean(passed), enforced: options.label === 'after', actual });
  }
  async function scenario(name, run) {
    console.log(`[L1] scenario: ${name}`);
    try { await run(); } catch (error) {
      if (interrupted || launchError || cdp?.ws?.readyState === WebSocket.CLOSED
          || (child && (child.exitCode !== null || child.signalCode !== null))) throw error;
      result.interactions.push({ name, error: error.stack ?? String(error) });
      check(name, false, error.message);
      console.error(`[L1] ${name}: ${scrub(error.message)}`);
    }
    await save();
  }
  async function runTool(binary, args) {
    await new Promise((resolve, reject) => {
      const proc = spawn(binary, args, { cwd: project, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      const timer = setTimeout(() => proc.kill('SIGKILL'), 600_000);
      const abort = setInterval(() => { if (interrupted) proc.kill('SIGTERM'); }, 100);
      const clear = () => { clearTimeout(timer); clearInterval(abort); };
      proc.once('error', error => { clear(); reject(error); });
      proc.once('close', code => { clear(); code === 0 ? resolve() : reject(new Error(`${binary}: ${code}: ${stderr}`)); });
    });
  }
  async function capture(name, selector) {
    const clip = selector ? await page(selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing screenshot target: ${selector}`);
      const r = element.getBoundingClientRect();
      const x = Math.max(0, r.left), y = Math.max(0, r.top);
      return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y };
    }, selector) : undefined;
    if (clip) assert.ok(clip.width > 0 && clip.height > 0, `Hidden screenshot target: ${selector}`);
    await screenshot(cdp, path.join(options.out, name), clip);
    result.screenshots.push(name);
  }
  const command = id => page(async id => {
    const value = await window.__inspectorL1.commands.executeCommand(id);
    return typeof value === 'number' || typeof value === 'string' ? value : null;
  }, id);
  async function click(selector) {
    const point = await waitFor(() => page(async selector => {
      const e = document.querySelector(selector);
      if (!e || e.disabled) return null;
      e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!e.isConnected) return null;
      const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return r.width && r.height && hit && (hit === e || e.contains(hit)) ? { x, y } : null;
    }, selector), `click ${selector}`);
    await page(selector => {
      const audit = { selector, events: [] };
      const record = event => {
        const expected = document.querySelector(selector), target = event.target;
        audit.events.push({ type: event.type, matches: Boolean(expected && (expected === target || expected.contains(target))),
          targetTag: target?.tagName, targetLabel: target?.closest?.('button')?.getAttribute('aria-label'),
          targetMarker: target?.closest?.('[data-akari-ui]')?.getAttribute('data-akari-ui') });
      };
      audit.dispose = () => {
        document.removeEventListener('pointerdown', record, true);
        document.removeEventListener('click', record, true);
      };
      document.addEventListener('pointerdown', record, true);
      document.addEventListener('click', record, true);
      window.__inspectorL1.clickAudit = audit;
    }, selector);
    await realClick(cdp, point.x, point.y);
    const audit = await page(() => {
      const audit = window.__inspectorL1.clickAudit;
      audit.dispose();
      return { selector: audit.selector, events: audit.events };
    });
    result.interactions.push({ name: 'real-click', ...audit });
    assert.ok(audit.events.some(e => e.type === 'click' && e.matches), `Real click missed ${selector}: ${S(audit.events)}`);
    await settle();
  }

  const visible = selector => page(selector => {
    const e = document.querySelector(selector), r = e?.getBoundingClientRect();
    return Boolean(r?.width && r?.height && getComputedStyle(e).visibility !== 'hidden');
  }, selector);
  async function openInspector() {
    await command('akari.inspector.open');
    await waitFor(() => visible(INSPECTOR), 'inspector visible');
  }
  async function selectClip(index) {
    const selector = `[data-akari-ui="timeline:cut:${index}"]`;
    await click(selector);
    await waitFor(() => page((selector, index) => {
      const t = window.__inspectorL1.timeline();
      const selected = t.selectionModel.snapshot;
      return document.querySelector(selector)?.classList.contains('akari-annotations-selected') &&
        (selected?.kind === 'cut' && selected.index === index || selected?.id === `clip-${index ? 'b' : 'a'}`);
    }, selector, index), `clip ${index} selected by real click`);
    await openInspector();
    await selectTab('tab:inspector-video');
  }
  async function selectTab(marker) {
    await click(`[data-akari-ui="${marker}"]`);
    await waitFor(() => page(marker => document.querySelector(`[data-akari-ui="${marker}"]`)?.getAttribute('aria-selected') === 'true', marker), marker);
    await settle();
  }
  async function expandSections() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const next = await page(selector => {
        const root = document.querySelector(selector);
        const elements = [...root.querySelectorAll('.akari-inspector-section-toggle[aria-expanded="false"], details:not([open]) > summary')];
        const e = elements.find(e => !e.disabled && e.getBoundingClientRect().height > 0);
        if (!e) return false;
        e.setAttribute('data-inspector-l1-expand', 'true');
        return true;
      }, INSPECTOR);
      if (!next) return;
      await click('[data-inspector-l1-expand="true"]');
      await page(() => document.querySelector('[data-inspector-l1-expand]')?.removeAttribute('data-inspector-l1-expand'));
    }
    throw new Error('Section expansion did not converge');
  }
  async function resize(width) {
    const size = await page(async width => {
      const shell = window.__inspectorL1.shell;
      shell.resize(width, 'right');
      await shell.rightPanelHandler.state.pendingUpdate;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { requested: width, panelSize: shell.rightPanelHandler.getPanelSize(),
        dockWidth: shell.rightPanelHandler.dockPanel.node.getBoundingClientRect().width,
        inspectorWidth: document.querySelector('[data-akari-ui="panel:inspector"]').getBoundingClientRect().width };
    }, width);
    check(`right-panel-width-${width}`, Math.abs(size.panelSize - width) <= 2, size);
    return size;
  }
  async function measure(theme, width, tab) {
    await expandSections();
    const state = await page(selector => {
      const root = document.querySelector(selector);
      root.scrollLeft = 0;
      const describe = e => ({ tag: e.tagName, marker: e.getAttribute('data-akari-ui'), className: String(e.className),
        scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
        overflowX: getComputedStyle(e).overflowX, overflowY: getComputedStyle(e).overflowY,
        visible: e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 });
      const elements = [root, ...root.querySelectorAll('*')].filter(e => e instanceof HTMLElement);
      // Include every real scrollport, even if it currently has no overflowing content.
      const scrollports = elements.filter(e => e === root || /^(auto|scroll|overlay)$/u.test(getComputedStyle(e).overflowX)
        || /^(auto|scroll|overlay)$/u.test(getComputedStyle(e).overflowY)).map(describe);
      const clipped = elements.filter(e => /^(hidden|clip)$/u.test(getComputedStyle(e).overflowX) && e !== root).map(describe);
      const seats = [...root.querySelectorAll('.akari-inspector-kf-controls')]
        .filter(e => e.getBoundingClientRect().height > 0)
        .map(e => e.querySelector('[data-akari-ui^="inspector-kf-seat:"]')?.getAttribute('data-akari-ui'));
      return { root: describe(root), scrollports, clipped, seats };
    }, INSPECTOR);
    const observation = { theme, width, tab, ...state, controls: [] };
    result.measurements.push(observation);
    if (tab === 'tab:inspector-video') check(`${theme}/${width}: video keyframe controls exist`, state.seats.length > 0, state.seats);
    for (const port of state.scrollports.filter(p => p.visible)) {
      check(`${theme}/${width}/${tab}/${port.marker ?? port.className}: horizontal overflow`, port.scrollWidth <= port.clientWidth, port);
    }
    for (const marker of state.seats) {
      const controls = await page(marker => {
        const root = document.querySelector('[data-akari-ui="panel:inspector"]');
        const seat = [...root.querySelectorAll('[data-akari-ui]')].find(e => e.getAttribute('data-akari-ui') === marker);
        const group = seat.closest('.akari-inspector-kf-controls');
        group.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        // A horizontal scroll must never conceal a layout failure in BEFORE.
        for (let e = group; e; e = e.parentElement) { e.scrollLeft = 0; if (e === root) break; }
        const rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const inside = (a, b) => a.width > 0 && a.height > 0 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
        const parent = rect(group), inspector = rect(root);
        const buttons = [...group.children].map(e => { const r = rect(e); return { tag: e.tagName,
          marker: e.getAttribute('data-akari-ui'), label: e.getAttribute('aria-label'), disabled: e.disabled,
          rect: r, insideControls: inside(r, parent), insideInspector: inside(r, inspector) }; });
        return { marker, parent, inspector, buttons };
      }, marker);
      observation.controls.push(controls);
      check(`${theme}/${width}/${tab}/${marker}: four contained buttons`, controls.buttons.length === 4 &&
        controls.buttons.every(b => b.tag === 'BUTTON' && b.insideControls && b.insideInspector), controls);
    }
    await save();
  }
  async function framePoints() {
    const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
    const item = edit.tracks.flatMap(track => track.items).find(item => item.id === 'clip-a');
    assert.ok(item && Array.isArray(item.keyframes), 'clip-a inline keyframes missing in saved edit.json');
    return { all: item.keyframes.length, points: item.keyframes.filter(point => typeof point.transform?.x === 'number') };
  }
  async function keyframeMenu() {
    const more = `[data-akari-ui="inspector-kf-more:${FIELD}"]`;
    const hasMore = await page(selector => Boolean(document.querySelector(selector)), more);
    check('more button exists', hasMore, { label: options.label });
    if (hasMore) await click(more);
    // BEFORE has the same jump marker on its fourth direct button.
    const jump = `[data-akari-ui="inspector-kf-jump:${FIELD}"]`;
    const menu = await page(selector => {
      const item = document.querySelector(selector), menu = item?.closest('[role="menu"]');
      return { itemRole: item?.getAttribute('role'), menuRole: menu?.getAttribute('role'),
        visible: Boolean(menu?.getBoundingClientRect().height) };
    }, jump);
    check('jump appears in opened menu', menu.itemRole === 'menuitem' && menu.menuRole === 'menu' && menu.visible, menu);
    return jump;
  }
  async function escape() {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await settle();
  }

  try {
    await mkdir(options.out, { recursive: true });
    await rm(path.join(options.out, 'failure.png'), { force: true });
    await ensureFreePort(options.port);
    const electronRoot = path.join(options.shell, 'node_modules/electron');
    const executable = (await readFile(path.join(electronRoot, 'path.txt'), 'utf8')).trim();
    const electron = path.resolve(electronRoot, 'dist', executable);
    assert.ok(executable && existsSync(electron), 'Electron executable missing under --shell/node_modules/electron');
    iso = await mkdtemp(path.join(os.tmpdir(), 'inspector-refresh-l1-'));
    project = path.join(iso, 'project');
    await cp(path.join(shellRepo, 'templates/project-default'), project, { recursive: true });
    for (const dir of ['akari-home', 'theia-config', 'user-data', 'project/assets/video']) await mkdir(path.join(iso, dir), { recursive: true });
    const vendored = path.join(shellRepo, 'packages/media-bin/vendor', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffmpeg = process.env.FFMPEG || (existsSync(vendored) ? vendored : 'ffmpeg');
    for (const [name, source] of [['a', 'testsrc=size=640x360:rate=30'], ['b', 'testsrc2=size=640x360:rate=30']]) {
      await runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
        '-t', '3', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, 'assets/video', `${name}.mp4`)]);
    }
    const edit = fixtureEdit();
    await writeFile(path.join(project, 'edit.json'), `${S(edit)}\n`);
    await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
    await writeFile(path.join(project, 'review.json'), S({ version: 0, annotations: [
      { id: 'a-0001', createdAt: '2026-09-22T00:00:00Z', src: 'video-a', sourceT: 1, sourceRange: null,
        timelineT: null, target: 'cut:0', targetKind: 'instant', region: null, strokes: null, refs: null,
        insertPosition: null, intent: null, text: 'タイトルの位置を確認する', input: 'typed', audio: null,
        transcript: null, session: null, poses: null, status: 'open', response: null }
    ] }));
    result.fixture = { project, edit, ffmpeg, electron };
    await save();
    const env = { ...process.env, AKARI_HOME: path.join(iso, 'akari-home'), THEIA_CONFIG_DIR: path.join(iso, 'theia-config') };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(electron, [options.shell, project, `--remote-debugging-port=${options.port}`,
      `--user-data-dir=${path.join(iso, 'user-data')}`, '--no-sandbox', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'],
    { cwd: options.shell, env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.once('error', error => { launchError = error; });
    const appendLog = chunk => { electronLog = (electronLog + chunk).slice(-20_000); };
    child.stdout.on('data', appendLog); child.stderr.on('data', appendLog);
    result.pid = child.pid;
    console.log(`[L1] owned Electron PID: ${child.pid}`);
    await save();
    const target = await waitFor(async () => (await listTargets(options.port)).find(t => t.type === 'page' && !t.url.startsWith('devtools:')), 'CDP workbench page', 600_000);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    // Page-target WebSocket has no Browser domain in Electron. Set the renderer viewport.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000,
      deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 1000 });
    await waitFor(() => page(() => Boolean(window.theia?.container && document.getElementById('theia-app-shell'))), 'Theia ready', 600_000);
    await page(() => {
      const container = window.theia.container;
      const keys = [...container._bindingDictionary._map.keys()];
      const service = (...methods) => {
        const key = keys.find(k => typeof k === 'function' && methods.every(m => typeof k.prototype?.[m] === 'function'));
        if (!key) throw new Error(`Missing Theia service: ${methods.join(', ')}`);
        return container.get(key);
      };
      const shell = service('resize', 'getWidgets', 'activateWidget');
      window.__inspectorL1 = { shell, commands: service('executeCommand', 'getCommand'),
        themes: service('setCurrentTheme', 'getCurrentTheme', 'getThemes'),
        timeline: () => {
          const widget = shell.widgets.find(w => w.node?.classList.contains('akari-annotations-widget') && w.isVisible);
          if (!widget) throw new Error('Visible timeline widget unavailable');
          return widget;
        } };
    });
    await waitFor(() => page(() => {
      const preload = document.querySelector('.theia-preload');
      if (!preload) return true;
      const style = getComputedStyle(preload);
      return style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none';
    }), 'preload overlay dismissed (not altered by this script)', 600_000);
    await command('akari.annotations.open');
    await waitFor(() => page(() => Boolean(document.querySelector('[data-akari-ui="timeline:cut:1"]'))), 'both fixture clips loaded', UI_TIMEOUT_MS);
    await page(async () => {
      const shell = window.__inspectorL1.shell;
      shell.resize(440, 'bottom');
      await shell.bottomPanelState.pendingUpdate;
    });
    for (const theme of ['dark', 'light']) {
      await scenario(`theme-${theme}`, async () => {
        const chosen = await page(async type => {
          const service = window.__inspectorL1.themes;
          await service.initialized;
          const theme = service.getThemes().find(t => t.type === type);
          if (!theme) throw new Error(`No ${type} theme registered`);
          service.setCurrentTheme(theme.id, true); // Normal API, persists workbench.colorTheme in isolated config.
          return { id: theme.id, type: theme.type };
        }, theme);
        await waitFor(() => page(type => window.__inspectorL1.themes.getCurrentTheme().type === type, theme), 'theme applied');
        await settle();
        result.themes.push({ requested: theme, ...chosen, tokens: await page(() => {
          const s = getComputedStyle(document.documentElement);
          return Object.fromEntries(['--akari-bg', '--akari-card', '--akari-ink', '--akari-accent'].map(k => [k, s.getPropertyValue(k)]));
        }) });
        await selectClip(0);
        await resize(360);
        await expandSections();
        await page(selector => { document.querySelector(selector).scrollTop = 0; }, INSPECTOR);
        await capture(`${theme}-inspector.png`, INSPECTOR);
        await capture(`${theme}-inspector-workbench.png`);
        check(`${theme}: selection header present`, await page(() => Boolean(document.querySelector('.akari-inspector-selection-header'))));
        await command('akari.review.open');
        await waitFor(() => visible(REVIEW), 'review panel visible');
        if (await visible(INSPECTOR)) {
          await capture(`${theme}-inspector-and-annotations.png`);
          result.interactions.push({ name: 'panel-comparison', theme, mode: 'simultaneous' });
        } else {
          await capture(`${theme}-annotations.png`, REVIEW);
          await capture(`${theme}-annotations-workbench.png`);
          result.interactions.push({ name: 'panel-comparison', theme, mode: 'separate-tabs',
            files: [`${theme}-inspector.png`, `${theme}-annotations.png`] });
        }
        await openInspector();
        for (const width of [240, 300, 360, 420]) {
          const dimensions = await resize(width);
          const tabs = await page(selector => [...document.querySelector(selector).querySelectorAll('[data-akari-ui^="tab:inspector-"]')]
            .map(e => ({ marker: e.getAttribute('data-akari-ui'), label: e.textContent, disabled: e.disabled })), INSPECTOR);
          assert.ok(tabs.length, 'No inspector tabs found');
          result.interactions.push({ name: 'tab-inventory', theme, width, dimensions, tabs });
          for (const tab of tabs) {
            if (tab.disabled) {
              result.measurements.push({ theme, width, tab: tab.marker, skipped: 'disabled by the application; no selectable contents' });
              continue;
            }
            await scenario(`${theme}/${width}/${tab.marker}`, async () => {
              await selectTab(tab.marker);
              await measure(theme, width, tab.marker);
            });
          }
        }
      });
    }
    await openInspector(); await resize(420);
    await scenario('no-keyframes-reveal-disabled', async () => {
      await selectClip(1); await expandSections();
      const selector = await keyframeMenu();
      const actual = await page(selector => { const e = document.querySelector(selector); return { exists: Boolean(e), disabled: e?.disabled, marker: e?.getAttribute('data-akari-ui') }; }, selector);
      check('clip-b jump disabled', actual.exists && actual.disabled, actual);
      await escape();
    });
    await scenario('toggle-and-navigation', async () => {
      await selectClip(0); await expandSections();
      // Drag the real playhead handle: ruler clicks clear selection and reopening a
      // preview can race its initial time. The handle's production handler keeps selection.
      const positions = await waitFor(() => page(() => {
        const t = window.__inspectorL1.timeline();
        const strip = t.strip.getBoundingClientRect(), handle = t.playheadHandle.getBoundingClientRect();
        const x = handle.left + handle.width / 2, y = handle.top + handle.height / 2;
        const hit = document.elementFromPoint(x, y);
        const targetX = strip.left + (1.5 - t.viewStart) / t.visibleDuration() * strip.width;
        if (!handle.width || !handle.height || !hit || !(hit === t.playheadHandle || t.playheadHandle.contains(hit))
            || targetX < strip.left || targetX > strip.right) return null;
        return { x, y, targetX, expectedSeconds: 1.5 };
      }), 'visible playhead drag handle');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: positions.x, y: positions.y, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: positions.x, y: positions.y, button: 'left', buttons: 1, clickCount: 1 });
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved',
          x: positions.x + (positions.targetX - positions.x) * fraction, y: positions.y, button: 'left', buttons: 1 });
        await sleep(40);
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: positions.targetX, y: positions.y, button: 'left', buttons: 0, clickCount: 1 });
      let stableSince;
      await waitFor(async () => {
        const seconds = await command('akari.timeline.playhead');
        if (Math.abs(seconds - positions.expectedSeconds) > 1 / FPS) { stableSince = undefined; return false; }
        stableSince ??= Date.now();
        return Date.now() - stableSince >= 500;
      }, 'playhead settled between fixture keyframes');
      const initialTime = await command('akari.timeline.playhead');
      result.interactions.push({ name: 'prepare-toggle', method: 'real-playhead-handle-drag', positions, actualSeconds: initialTime });
      const initial = await framePoints();
      const frame = Math.round(initialTime * FPS);
      assert.ok(!initial.points.some(p => p.t === frame), `Toggle precondition: click landed on existing keyframe ${frame}`);
      const seat = `[data-akari-ui="inspector-kf-seat:${FIELD}"]`;
      const toggle = { name: 'toggle', initialTime, frame, initial };
      result.interactions.push(toggle);
      await click(seat);
      const added = await waitFor(async () => { const p = toggle.added = await framePoints(); return p.all === initial.all + 1 && p.points.some(p => p.t === frame) ? p : false; }, 'saved keyframe addition');
      await waitFor(() => page(frame => {
        const model = window.__inspectorL1.timeline().selectionModel;
        return model.keyframeSelection?.itemId === 'clip-a' && model.keyframeSelection.property === 'transform.x'
          && model.keyframeSelection.times.includes(frame) && model.snapshot?.keyframes?.some(p => p.t === frame);
      }, frame), 'added keyframe reflected in selection and inspector');
      await settle();
      await click(seat);
      const removed = await waitFor(async () => { const p = toggle.removed = await framePoints(); return p.all === initial.all && !p.points.some(p => p.t === frame) ? p : false; }, 'saved keyframe removal');
      await waitFor(() => page(frame => {
        const model = window.__inspectorL1.timeline().selectionModel;
        return !model.keyframeSelection && model.snapshot?.keyframes && !model.snapshot.keyframes.some(p => p.t === frame);
      }, frame), 'removed keyframe reflected in selection and inspector');
      await settle();
      check('saved keyframe count increases and decreases', added.all === initial.all + 1 && removed.all === initial.all, toggle);
      const controls = `${INSPECTOR} [data-akari-ui="field:inspector-${FIELD}"] .akari-inspector-kf-controls`;
      for (const [direction, label] of [['previous', '前のキーフレームへ'], ['next', '次のキーフレームへ']]) {
        const from = await command('akari.timeline.playhead');
        const frames = (await framePoints()).points.map(p => p.t).sort((a, b) => a - b);
        const current = Math.round(from * FPS);
        const target = direction === 'previous' ? frames.filter(t => t < current).at(-1) : frames.find(t => t > current);
        assert.notEqual(target, undefined, `No ${direction} fixture point`);
        const navigation = { name: direction, from, expected: target / FPS };
        result.interactions.push(navigation);
        await click(`${controls} button[aria-label=${S(label)}]`);
        await waitFor(async () => {
          const value = navigation.actual = await command('akari.timeline.playhead');
          const selected = navigation.selection = await page(() => window.__inspectorL1.timeline().selectionModel.keyframeSelection);
          return Math.abs(value - target / FPS) <= 1 / FPS && selected?.itemId === 'clip-a'
            && selected.property === 'transform.x' && selected.times.length === 1 && selected.times[0] === target;
        }, `${direction} playhead and selected keyframe`);
        await settle();
      }
      check('toggle and navigation', true);
    });
    await scenario('reveal-existing-keyframes', async () => {
      await selectClip(0); await expandSections();
      const selector = await keyframeMenu();
      const enabled = await page(selector => { const e = document.querySelector(selector); return Boolean(e && !e.disabled); }, selector);
      check('clip-a jump enabled', enabled);
      const theme = await page(() => window.__inspectorL1.themes.getCurrentTheme().type);
      await capture(`${theme}-reveal-menu.png`);
      await click(selector);
      const readReveal = () => page(() => {
        const t = window.__inspectorL1.timeline();
        const row = t.node.querySelector('[data-akari-keyframe-property-row="clip-a:transform.x"]');
        const r = row?.getBoundingClientRect(), viewport = t.stripScroll.getBoundingClientRect();
        const selection = t.selectionModel.keyframeSelection;
        return { exists: Boolean(row), highlighted: row?.classList.contains('akari-timeline-keyframe-property-selected'),
          inViewport: Boolean(r?.height && r.top >= viewport.top - 1 && r.bottom <= viewport.bottom + 1),
          rect: r?.toJSON(), viewport: viewport.toJSON(), selection, focusRootId: t.focusScope.rootId,
          scrollTop: t.stripScroll.scrollTop };
      });
      const observation = { name: 'reveal' };
      result.interactions.push(observation);
      const reveal = await waitFor(async () => { const r = observation.actual = await readReveal(); return r.exists && r.highlighted && r.inViewport &&
        r.selection?.itemId === 'clip-a' && r.selection.property === 'transform.x' && r.selection.times.length > 0 && r.focusRootId === 'clip-a' ? r : false; }, 'revealed selected keyframe row');
      check('reveal row visible and selected', true, reveal);
      await capture(`${theme}-reveal-timeline.png`);
    });
    const failed = result.checks.filter(c => c.enforced && !c.passed);
    assert.equal(failed.length, 0, `${failed.length} AFTER checks failed; see results.json checks and measurements`);
    result.status = options.label === 'before' ? 'observed' : 'pass';
  } catch (error) {
    result.status = 'fail';
    result.error = error.stack ?? String(error);
    console.error(`[L1] failed: ${scrub(error.message)}`);
    process.exitCode = 1;
    if (cdp) await capture('failure.png').catch(error => { result.failureScreenshotError = error.message; });
    else result.failureScreenshotError = 'Renderer CDP unavailable; no real screenshot can be captured.';
  } finally {
    cdp?.close();
    // Only this ChildProcess / PID. Never pkill, process-name matching or process-group kill.
    const alive = () => Boolean(child?.pid && child.exitCode === null && child.signalCode === null && !launchError);
    if (alive()) {
      child.kill('SIGTERM');
      for (let i = 0; i < 300 && alive(); i++) await sleep(100);
      if (alive()) child.kill('SIGKILL');
      for (let i = 0; i < 300 && alive(); i++) await sleep(100);
    }
    result.cleanup = { pid: child?.pid ?? null, alive: alive(), isolatedDirectory: iso, removed: false };
    if (alive()) {
      result.status = 'fail'; result.cleanup.error = 'Owned Electron did not stop'; process.exitCode = 1;
    } else if (iso) {
      try { await rm(iso, { recursive: true, force: true }); result.cleanup.removed = true; }
      catch (error) { result.status = 'fail'; result.cleanup.error = error.message; process.exitCode = 1; }
    }
    if (result.status === 'fail') result.electronLogTail = electronLog;
    result.durationMs = Date.now() - started;
    result.finishedAt = new Date().toISOString();
    await mkdir(options.out, { recursive: true });
    await save();
    console.log(`[L1] ${result.status}; ${result.measurements.length} measurements; ${result.checks.filter(c => c.enforced && !c.passed).length} failed checks`);
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
  return result;
}

// Both sides are canonicalized, including invocation through a symlink.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
