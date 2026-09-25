#!/usr/bin/env node
// Wrapper L1 for photo crop / frame. Usage: node evidence/f1a-crop-and-frame/l1/run-l1.mjs <tag>
// The caller holds the heavy slot. Scratch paths contain the task slug; CDP 9560 / HTTP 48906.
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { CDP, PreviewFinder, evaluate } from '../../c0a-group-media-render/cdp-preview.mjs';

const tag = process.argv[2] ?? 'r1';
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const shell = join(repo, 'apps/shell');
const electronBinary = join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const out = join(here, tag);
const scratch = '/private/tmp/libcanvas-f1a-crop-and-frame-l1-' + tag;
const workspace = join(scratch, 'workspace');
const fixtures = '/tmp/libcanvas-f1a-crop-and-frame-fx';
const port = 9560;
const OUT_W = 1080, OUT_H = 1920, SRC_W = 1920, SRC_H = 1080;
const ffmpeg = process.env.AKARI_FFMPEG_BIN || 'ffmpeg';
const env = { ...process.env, AKARI_HOME: join(scratch, 'akari-home'), THEIA_CONFIG_DIR: join(scratch, 'config'),
  AKARI_FFMPEG_BIN: ffmpeg, AKARI_FFPROBE_BIN: process.env.AKARI_FFPROBE_BIN || 'ffprobe' };
const result = { tag, steps: [], errors: [] };
const clean = value => String(value).replaceAll(repo, '<repo>').replaceAll(scratch, '<scratch>')
  .replace(/\/Users\/[^\s"']+/g, '<local>');
const step = (name, data) => { result.steps.push({ name, ...data }); console.log(name, JSON.stringify(data).slice(0, 400)); };
const run = (command, args, cwd = repo) => {
  const proc = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  return { code: proc.status, signal: proc.signal, stderr: clean(proc.stderr ?? '').slice(-2000) };
};
const readEdit = async () => JSON.parse(await readFile(join(workspace, 'edit.json'), 'utf8'));
const photoItem = edit => edit.tracks.flatMap(track => track.items).find(item => item.id === 'photo');
const historyCount = async () => {
  const dir = join(workspace, '.akari', 'history');
  try { return (await readdir(dir, { recursive: true })).length; } catch { return 0; }
};

let electron, browser, cdp, page, preview;
let electronStderr = '';
let finderRef;
const refocus = async () => {
  for (const s of finderRef.sessions.values()) await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s.sessionId).catch(() => {});
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
};
const pv = async expression => {
  for (let attempt = 0; ; attempt++) {
    try { return await evaluate(cdp, expression, preview.contextId, preview.sessionId); }
    catch (error) {
      if (attempt >= 3 || !/Session with given id not found|Cannot find context|context/i.test(String(error))) throw error;
      result.previewReattach = (result.previewReattach ?? 0) + 1;
      await sleep(1500);
      preview = await finderRef.find(60000);
      await refocus();
      for (let i = 0; i < 40; i++) {
        const ready = await evaluate(cdp, `Boolean(document.querySelector('[data-akari-layer-id="photo"]'))`, preview.contextId, preview.sessionId).catch(() => false);
        if (ready) break;
        await sleep(250);
      }
    }
  }
};
async function stageBox() {
  const clip = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const host = await page.locator('iframe[src*="akari-output-preview"]').first().boundingBox();
  return { x: host.x + clip.x, y: host.y + clip.y, width: clip.width, height: clip.height };
}
const toPage = (box, x, y) => ({ x: box.x + x * box.width / OUT_W, y: box.y + y * box.height / OUT_H });
async function shot(name) {
  const box = await stageBox();
  const bytes = await page.screenshot({ clip: box });
  await writeFile(join(out, name + '.png'), bytes);
  return box;
}
async function seek(second) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await pv(`(() => { const seek = document.getElementById('seek'); seek.value = ${second};
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      seek.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(900);
    if (Math.abs(await pv(`Number(document.getElementById('seek')?.value)`) - second) < 0.04) return;
  }
}
async function waitEdit(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const edit = await readEdit(); if (predicate(edit)) return edit; } catch { /* partial write */ }
    await sleep(200);
  }
  return undefined;
}
const cropState = () => pv(`(() => ({
  active: document.getElementById('photo-crop-controls')?.classList.contains('is-active') ?? false,
  photoCropBox: document.getElementById('layer-crop-box')?.classList.contains('is-photo-crop') ?? false,
  ratio: document.querySelector('[data-photo-crop-ratio]')?.value,
  rotate: document.querySelector('[data-photo-crop-rotate]')?.value,
  status: document.querySelector('[data-photo-crop-status]')?.textContent,
  labels: [...document.querySelectorAll('#photo-crop-controls button, #photo-crop-controls label')].map(x => x.textContent.trim()),
  ratioOptions: [...document.querySelectorAll('[data-photo-crop-ratio] option')].map(x => x.textContent),
  dataset: (() => { const m = document.querySelector('[data-akari-layer-id="photo"]'); return m ? {
    x: m.dataset.akariCropX, y: m.dataset.akariCropY, w: m.dataset.akariCropW, h: m.dataset.akariCropH, rotate: m.dataset.akariCropRotate } : null; })(),
  ghost: (() => { const g = document.getElementById('photo-crop-ghost'); if (!g) return null; const r = g.getBoundingClientRect();
    return { display: getComputedStyle(g).display, opacity: getComputedStyle(g).opacity, w: r.width, h: r.height }; })()
}))()`);

try {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(repo, 'templates/project-default'), workspace, { recursive: true });
  await cp(join(fixtures, 'person-wide.png'), join(workspace, 'assets/person-wide.png'));
  await cp(join(fixtures, 'bg-green.png'), join(workspace, 'assets/bg-green.png'));
  const edit = {
    version: 2,
    output: { width: OUT_W, height: OUT_H, fps: 30 },
    sources: [{ id: 'bg', path: 'assets/bg-green.png' }, { id: 'person', path: 'assets/person-wide.png' }],
    tracks: [
      { id: 'base', lane: 'visual', items: [{ id: 'bg-item', at: 0, duration: 120,
        source: { kind: 'media', src: 'bg', in: 0, out: 4 } }] },
      { id: 'v2', lane: 'visual', items: [{ id: 'photo', at: 0, duration: 120, transform: { x: 0, y: 0, scale: 0.9 },
        erase: [{ mode: 'erase', points: [[0.74, 0.6], [0.78, 0.6]], size: 0.06, hardness: 1 }],
        source: { kind: 'media', src: 'person', in: 0, out: 4 } }] }
    ]
  };
  await writeFile(join(workspace, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  run('git', ['init', '-q'], workspace);
  run('git', ['add', '-A'], workspace);
  run('git', ['-c', 'user.name=l1', '-c', 'user.email=l1@example.invalid', 'commit', '-qm', 'fixture'], workspace);

  result.electronPreflight = run(electronBinary, ['--version'], shell);
  if (result.electronPreflight.code !== 0) throw new Error('Electron preflight failed');
  electron = spawn(electronBinary, [shell, workspace, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', '--port=48906',
    `--user-data-dir=${join(scratch, 'profile')}`, '--no-sandbox', '--force-color-profile=srgb'],
  { cwd: shell, stdio: ['ignore', 'ignore', 'pipe'], env });
  electron.stderr?.on('data', chunk => { electronStderr = (electronStderr + String(chunk)).slice(-6000); });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (electron.exitCode !== null || electron.signalCode !== null) throw new Error('Electron exited early');
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(500); }
  }
  if (!browser) throw new Error('CDP did not start');
  page = browser.contexts()[0]?.pages()[0];
  await page.setViewportSize({ width: 1800, height: 1200 });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new CDP(version.webSocketDebuggerUrl); await cdp.connect();
  const runtimeMessages = [];
  cdp.on('Runtime.exceptionThrown', event => runtimeMessages.push(clean(
    event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? '').slice(0, 400)));
  const finder = new PreviewFinder(cdp); await finder.initialize(); finderRef = finder;
  const editUri = pathToFileURL(join(workspace, 'edit.json')).href;
  const execCommand = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const key = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!key) return 'not ready';
    try { const value = await window.theia.container.get(key).executeCommand(id, ...args); return value === undefined ? 'ok' : String(value); }
    catch (error) { return 'error: ' + String(error); }
  }, { id, args }).catch(error => 'error: ' + String(error));
  let opened = false;
  for (let i = 0; i < 100 && !opened; i++) {
    await page.getByRole('button', { name: '開くだけ' }).click({ timeout: 100 }).catch(() => {});
    const state = await page.evaluate(async uri => {
      const dictionary = window.theia?.container?._bindingDictionary;
      const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
      const key = keys.find(k => typeof k === 'function' && k.prototype
        && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
      if (!key) return 'not ready';
      try { return await window.theia.container.get(key).executeCommand('akari.preview.ensureVisible', { editUri: uri }); }
      catch (error) { return String(error); }
    }, editUri).catch(() => undefined);
    opened = state === 'opened' || state === 'revealed';
    if (!opened) await sleep(700);
  }
  if (!opened) throw new Error('preview command unavailable');
  step('open-timeline', { annotations: await execCommand('akari.annotations.open') });
  await sleep(2500);
  step('open-inspector', { inspector: await execCommand('akari.inspector.open') });
  await sleep(1500);
  await execCommand('akari.preview.ensureVisible', { editUri });
  preview = await finder.find(60000);
  for (const session of [preview.sessionId, undefined]) {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session).catch(() => {});
  }
  for (const s of finder.sessions.values()) await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s.sessionId).catch(() => {});
  await page.bringToFront().catch(() => {});
  for (let i = 0; i < 60; i++) {
    if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 3.5
      && document.getElementById('preview-stage')?.getBoundingClientRect().width > 0
      && Boolean(document.querySelector('[data-akari-layer-id="photo"]'))`)) break;
    await sleep(250);
  }
  await sleep(1500);
  await seek(2);
  await writeFile(join(out, 'page-00.png'), await page.screenshot());
  const box0 = await shot('00-before');
  step('indicator', await pv(`(() => { document.getElementById('indicator-toggle')?.click();
    return [...document.querySelectorAll('[id*=indicator], .indicator, [class*=indicator]')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 6); })()`));
  await pv(`(() => { document.getElementById('indicator-toggle')?.click(); return true; })()`);
  step('stage', { box: box0 });

  // 1. Double click the photo -> crop mode.
  const beforeHistory = await historyCount();
  const beforeEditText = await readFile(join(workspace, 'edit.json'), 'utf8');
  const centre = toPage(box0, OUT_W / 2, OUT_H / 2 - 150);
  await page.mouse.dblclick(centre.x, centre.y);
  await sleep(800);
  step('dblclick', await cropState());
  await shot('01-crop-mode');

  // 2. 9:16.
  await pv(`(() => { const s = document.querySelector('[data-photo-crop-ratio]'); s.value = '9:16';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(700);
  step('ratio-9-16', await cropState());
  await shot('02-ratio-9-16');

  // 3. Drag the east edge handle inward.
  const handle = await pv(`(() => { const h = document.querySelector('#layer-crop-box [data-akari-crop-handle="e"]');
    if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2,
    visible: getComputedStyle(h).display !== 'none' && r.width > 0, pe: getComputedStyle(h).pointerEvents }; })()`);
  step('edge-handle', { handle });
  if (handle) {
    const host = await page.locator('iframe[src*="akari-output-preview"]').first().boundingBox();
    const hx = host.x + handle.x, hy = host.y + handle.y;
    await page.mouse.move(hx, hy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(hx - i * 10, hy); await sleep(40); }
    await page.mouse.up();
    await sleep(700);
  }
  step('edge-drag', await cropState());
  await shot('03-edge-narrowed');

  // 4. Rotate 5 degrees, then confirm with Enter from the rotate field.
  const rotateInput = await pv(`(() => { const r = document.querySelector('[data-photo-crop-rotate]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const hostBox = await page.locator('iframe[src*="akari-output-preview"]').first().boundingBox();
  await page.mouse.click(hostBox.x + rotateInput.x, hostBox.y + rotateInput.y);
  step('rotate-focus', await pv(`({ hasFocus: document.hasFocus(), active: document.activeElement?.outerHTML.slice(0, 120) })`));
  await pv(`(() => { document.querySelector('[data-photo-crop-rotate]').select(); return true; })()`);
  await page.keyboard.type('5');
  step('rotate-typed', await pv(`({ hasFocus: document.hasFocus(), value: document.querySelector('[data-photo-crop-rotate]').value, active: document.activeElement?.outerHTML.slice(0, 80) })`));
  await pv(`(() => { const r = document.querySelector('[data-photo-crop-rotate]'); r.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(700);
  step('rotate-5', await cropState());
  step('rotate-5-ghost', await pv(`(() => { const t = el => el ? getComputedStyle(el).transform : null;
    const photo = document.querySelector('[data-akari-layer-id="photo"]');
    return { ghost: t(document.getElementById('photo-crop-ghost')), photo: t(photo),
      ghostOutline: [...document.querySelectorAll('#photo-crop-ghost, #photo-crop-ghost *, [id^="photo-crop-"]')]
        .map(el => ({ id: el.id || el.className, transform: getComputedStyle(el).transform })).slice(0, 8) }; })()`));
  await shot('04-rotated-in-mode');
  const draftEdit = await readEdit();
  step('edit-before-confirm-unchanged', { unchanged: JSON.stringify(photoItem(draftEdit)) === JSON.stringify(photoItem(JSON.parse(beforeEditText))) });
  await page.keyboard.press('Enter');
  const confirmed = await waitEdit(value => photoItem(value)?.crop?.rotate === 5);
  await sleep(1200);
  const afterHistory = await historyCount();
  const confirmedItem = confirmed ? photoItem(confirmed) : photoItem(await readEdit());
  const aspect = confirmedItem?.crop ? confirmedItem.crop.w * SRC_W / (confirmedItem.crop.h * SRC_H) : null;
  step('confirm-enter', { crop: confirmedItem?.crop, transform: confirmedItem?.transform,
    transformHasRotateKey: Object.hasOwn(confirmedItem?.transform ?? {}, 'rotate'), aspectPx: aspect,
    historyDelta: afterHistory - beforeHistory, modeAfter: await cropState() });
  const afterCropText = await readFile(join(workspace, 'edit.json'), 'utf8');
  await writeFile(join(out, 'edit-after-crop.json'), afterCropText);
  await seek(2); await sleep(800);
  await shot('05-after-crop-preview');

  // 5. Undo once / redo once (timeline buttons).
  const undoClick = await execCommand('akari.timeline.undo');
  const undone = await waitEdit(value => photoItem(value)?.crop === undefined, 6000);
  const undoText = await readFile(join(workspace, 'edit.json'), 'utf8');
  await writeFile(join(out, 'edit-after-undo.json'), undoText);
  await writeFile(join(out, 'edit-before-crop.json'), beforeEditText);
  await sleep(1500);
  const redoButtonBefore = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(b => (b.title || '').startsWith('やり直す')).map(b => ({ disabled: b.disabled })));
  const redoClick = await execCommand('akari.timeline.redo');
  const redone = await waitEdit(value => photoItem(value)?.crop?.rotate === 5, 8000);
  step('redo-diagnostics', { redoButtonBefore, notices: await page.evaluate(() =>
    [...document.querySelectorAll('.theia-notification-message, [class*=footer]')].map(x => x.textContent.trim()).filter(Boolean).slice(-6)) });
  const redoText = await readFile(join(workspace, 'edit.json'), 'utf8');
  step('undo-redo', { undoClick, undoRestoresOriginal: Boolean(undone) && JSON.stringify(JSON.parse(undoText)) === JSON.stringify(JSON.parse(beforeEditText)),
    redoClick, redoRestoresCrop: Boolean(redone) && JSON.stringify(JSON.parse(redoText)) === JSON.stringify(JSON.parse(afterCropText)) });
  await sleep(2500);
  step('after-redo-preview-state', await pv(`(() => { const m = document.querySelector('[data-akari-layer-id="photo"]');
    const layer = (window.akari?.state?.summary?.layers ?? []).find(x => String(x.id) === 'photo');
    return { dataset: m ? { x: m.dataset.akariCropX, w: m.dataset.akariCropW, rotate: m.dataset.akariCropRotate } : null,
      summaryCrop: layer?.crop ?? null, summaryFrame: layer?.frame ?? null, tag: m?.tagName }; })()`));
  await seek(2); await sleep(900);
  await shot('05b-after-undo-redo-preview');

  // 6. Smart crop in a fresh crop session, then Esc must discard it.
  await seek(2); await sleep(500);
  const box1 = await stageBox();
  const t = confirmedItem?.transform ?? { x: 0, y: 0 };
  const photoCentre = toPage(box1, OUT_W / 2 + (t.x ?? 0), OUT_H / 2 + (t.y ?? 0) - 100);
  await page.mouse.click(photoCentre.x - 200, photoCentre.y - 600).catch(() => {});
  await sleep(400);
  await page.mouse.dblclick(photoCentre.x, photoCentre.y);
  await sleep(800);
  const smartEntry = await cropState();
  await pv(`(() => { const s = document.querySelector('[data-photo-crop-ratio]'); s.value = '9:16';
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(700);
  const smartClick = await pv(`(() => { const b = document.querySelector('[data-photo-crop-smart]'); if (!b) return false; b.click(); return true; })()`);
  let smartState;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    smartState = await cropState();
    if (smartState.status && !smartState.status.includes('調べています')) break;
  }
  // Person in the fixture: x 0.57..0.95 of the source, centroid x ~0.76 (source 0..1).
  const sx = Number(smartState?.dataset?.x), sw = Number(smartState?.dataset?.w);
  const rel = (0.76 - sx) / sw;
  const covered = Math.max(0, Math.min(0.95, sx + sw) - Math.max(0.57, sx)) / 0.38;
  step('smart-crop', { entry: smartEntry.active, smartClick, state: smartState,
    check: { windowX: sx, windowW: sw, centroidRel: rel, nearestThirdDist: Math.min(Math.abs(rel - 1 / 3), Math.abs(rel - 2 / 3)),
      personWidthCovered: covered, aspectPx: sw * SRC_W / (Number(smartState?.dataset?.h) * SRC_H) } });
  await shot('06-smart-crop');
  await writeFile(join(out, 'page-06.png'), await page.screenshot());
  const smartBeforeEsc = await readFile(join(workspace, 'edit.json'), 'utf8');
  step('focus-before-esc', await pv(`({ hasFocus: document.hasFocus(), active: document.activeElement?.outerHTML.slice(0, 100) })`));
  await page.keyboard.press('Escape');
  await sleep(1200);
  step('esc-cancel', { unchanged: (await readFile(join(workspace, 'edit.json'), 'utf8')) === smartBeforeEsc,
    modeAfter: (await cropState()).active, datasetAfter: (await cropState()).dataset });

  // 7. Auto level on the same photo (reports the helper answer only; Esc discards it).
  await page.mouse.dblclick(photoCentre.x, photoCentre.y);
  await sleep(800);
  await pv(`(() => { document.querySelector('[data-photo-crop-auto]')?.click(); return true; })()`);
  let autoState;
  for (let i = 0; i < 60; i++) { await sleep(500); autoState = await cropState(); if (autoState.status && !autoState.status.includes('調べています')) break; }
  step('auto-level', { state: autoState });
  await page.keyboard.press('Escape');
  await sleep(800);

  // 8. Frame via the inspector: stroke 8px, radius 40.
  await page.mouse.click(photoCentre.x, photoCentre.y);
  await sleep(1200);
  const inspectorWrite = async (field, value) => {
    const input = page.locator(`[data-akari-field="${field}"] input`).first();
    try {
      await input.click({ timeout: 3000 });
      await input.fill(String(value));
      await input.press('Enter');
      return true;
    } catch (error) { return clean(error.message).slice(0, 200); }
  };
  const fields = await page.evaluate(() => [...document.querySelectorAll('[data-akari-field^="photo-"]')]
    .map(x => ({ field: x.getAttribute('data-akari-field'), text: x.textContent.trim().slice(0, 40) })));
  const widthWrite = await inspectorWrite('photo-frame-width', 8);
  await waitEdit(value => photoItem(value)?.frame?.stroke?.width === 8, 5000);
  const radiusWrite = await inspectorWrite('photo-frame-radius', 40);
  const framed = await waitEdit(value => photoItem(value)?.frame?.cornerRadius === 40, 5000);
  step('inspector-frame', { fields, widthWrite, radiusWrite, frame: photoItem(framed ?? await readEdit())?.frame });
  if (!framed) {
    const value = await readEdit();
    photoItem(value).frame = { stroke: { color: '#ffffff', width: 8 }, cornerRadius: 40 };
    await writeFile(join(workspace, 'edit.json'), JSON.stringify(value, null, 2) + '\n');
    step('frame-fallback-file-write', {});
  }
  await sleep(1000);
  await seek(2); await sleep(900);
  await shot('07-frame-uniform');
  await writeFile(join(out, 'page-07.png'), await page.screenshot());

  // 9. Stretch (non-uniform scale) by editing the file like an agent would.
  const stretched = await readEdit();
  const item = photoItem(stretched);
  const scale = item.transform?.scale ?? 1;
  // A window that contains the erase stroke (source x 0.74..0.78, y 0.6), rotated 5 degrees.
  item.crop = { x: 0.6, y: 0.35, w: 0.3, h: 0.5, rotate: 5 };
  item.transform = { ...item.transform, scaleX: scale * 1.35, scaleY: scale * 0.8 };
  delete item.transform.scale;
  await writeFile(join(workspace, 'edit.json'), JSON.stringify(stretched, null, 2) + '\n');
  await sleep(2500);
  await seek(2); await sleep(1200);
  await shot('08-frame-stretched-preview');
  step('hide-selection-chrome', await pv(`(() => { const s = document.createElement('style'); s.id = 'l1-hide-chrome';
    s.textContent = '#layer-crop-box, [id*="selection"], [class*="selection"], [class*="handle"], [id*="handle"], [id*="toolbar"], [class*="toolbar"], [class*="chip"] { visibility: hidden !important; }';
    document.head.append(s); return document.querySelectorAll('[data-akari-layer-id]').length; })()`));
  await sleep(500);
  await shot('08b-frame-stretched-preview-clean');
  const finalText = await readFile(join(workspace, 'edit.json'), 'utf8');
  await writeFile(join(out, 'edit-final.json'), finalText);
  result.runtimeMessages = runtimeMessages.slice(-20);

  await browser.close().catch(() => {}); browser = null;
  cdp.close(); cdp = null;
  if (electron?.pid) { electron.kill('SIGTERM'); await sleep(1500); electron.kill('SIGKILL'); electron = null; }

  // 10. Export both engines and extract the 2 s frame.
  for (const engine of ['gpu', 'osr']) {
    const mp4 = join(scratch, `${engine}.mp4`);
    const cli = join(repo, `packages/${engine}-export/bin/akari-${engine}-export.mjs`);
    const invocation = run(process.execPath, [cli, workspace, '--out', mp4, '--duration', '4', '--frames', '120',
      '--width', String(OUT_W), '--height', String(OUT_H), '--fps', '30', '--soft']);
    step(`export-${engine}`, invocation);
    if (invocation.code === 0) {
      step(`frame-${engine}`, run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', mp4,
        '-frames:v', '1', join(out, `09-${engine}-2s.png`)]));
    }
  }
} catch (error) { result.errors.push(clean(error?.stack ?? error)); }
finally {
  result.electronStderr = clean(electronStderr).slice(-1500);
  await browser?.close().catch(() => {});
  cdp?.close();
  if (electron?.pid) { electron.kill('SIGTERM'); await sleep(1500); electron.kill('SIGKILL'); }
  await writeFile(join(out, 'run.json'), JSON.stringify(result, null, 2) + '\n');
}
if (result.errors.length) process.exitCode = 1;
