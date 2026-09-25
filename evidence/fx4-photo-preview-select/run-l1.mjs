#!/usr/bin/env node
// L1（検証専用）: プレビューで写真を押したときに何が選ばれるかを、本物の Electron シェルで記録する。
// 下に動画 1 本・上に写真 2 枚（重なり・後ろの写真の左 1/4 は透明）・図形 1 個・キャンバスの中の写真 1 枚。
//
// 使い方（呼び出し側が heavy-slot の枠を持つ）:
//   node evidence/fx4-photo-preview-select/run-l1.mjs --shell <apps/shell> --tag before --out <dir> [--only a,b]
// CDP 9567 / HTTP 48941。一時ディレクトリはタスク slug を含む。
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { CDP, PreviewFinder, evaluate } from '../c0a-group-media-render/cdp-preview.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const shell = resolve(arg('shell', join(repo, 'apps/shell')));
const tag = arg('tag', 'run');
const out = resolve(arg('out', join(here, tag)));
const only = (arg('only', '') || '').split(',').filter(Boolean);
const templateRoot = resolve(shell, '../..');
const electronBinary = join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const scratch = '/private/tmp/libcanvas-fx4-photo-preview-select-l1-' + tag;
const workspace = join(scratch, 'workspace');
const port = 9567;
const OUT_W = 1920, OUT_H = 1080;
const ffmpeg = process.env.AKARI_FFMPEG_BIN || 'ffmpeg';
const env = { ...process.env, AKARI_HOME: join(scratch, 'akari-home'), THEIA_CONFIG_DIR: join(scratch, 'config'),
  AKARI_FFMPEG_BIN: ffmpeg, AKARI_FFPROBE_BIN: process.env.AKARI_FFPROBE_BIN || 'ffprobe' };
const result = { tag, steps: {}, errors: [] };
const clean = value => String(value).replaceAll(repo, '<repo>').replaceAll(templateRoot, '<repo>').replaceAll(scratch, '<scratch>')
  .replace(/\/(Users|private)\/[^\s"']+/g, '<local>');
const step = (name, data) => { result.steps[name] = data; console.log(name, clean(JSON.stringify(data)).slice(0, 600)); };
const run = (command, args, cwd = repo) => {
  const proc = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  return { code: proc.status, signal: proc.signal, stderr: clean(proc.stderr ?? '').slice(-2000) };
};
const readEdit = async () => JSON.parse(await readFile(join(workspace, 'edit.json'), 'utf8'));
const findItem = (edit, id) => {
  const walk = items => { for (const item of items ?? []) { if (item.id === id) return item;
    const hit = walk([...(item.items ?? []), ...(item.source?.tracks?.flatMap(t => t.items) ?? []), ...(item.tracks?.flatMap(t => t.items) ?? [])]); if (hit) return hit; } };
  return walk((edit.tracks ?? []).flatMap(t => t.items ?? []));
};
const historyCount = async () => { try { return (await readdir(join(workspace, '.akari', 'history'), { recursive: true })).length; } catch { return 0; } };
const wanted = name => !only.length || only.includes(name);

let electron, browser, cdp, page, preview, finderRef;
let electronStderr = '';
const pv = async expression => {
  for (let attempt = 0; ; attempt++) {
    try { return await evaluate(cdp, expression, preview.contextId, preview.sessionId); }
    catch (error) {
      if (attempt >= 3 || !/Session with given id not found|Cannot find context|context/i.test(String(error))) throw error;
      await sleep(1500);
      preview = await finderRef.find(60000);
    }
  }
};
async function frameBox() {
  return page.locator('iframe[src*="akari-output-preview"]').first().boundingBox();
}
async function stageBox() {
  const clip = await pv(`(() => { const r = document.getElementById('preview-stage').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const host = await frameBox();
  return { x: host.x + clip.x, y: host.y + clip.y, width: clip.width, height: clip.height, fx: clip.x, fy: clip.y };
}
const toPage = (box, x, y) => ({ x: box.x + x * box.width / OUT_W, y: box.y + y * box.height / OUT_H });
async function shot(name, pad = 30) {
  const box = await stageBox();
  const bytes = await page.screenshot({ clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } });
  await writeFile(join(out, name + '.png'), bytes);
  return box;
}
async function waitEdit(predicate, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const edit = await readEdit(); if (predicate(edit)) return edit; } catch { /* partial write */ }
    await sleep(200);
  }
  return undefined;
}
async function execCommand(id, ...args) {
  return page.evaluate(async ({ id, args }) => {
    const dictionary = window.theia?.container?._bindingDictionary;
    const keys = dictionary?._map ? [...dictionary._map.keys()] : [];
    const key = keys.find(k => typeof k === 'function' && k.prototype
      && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
    if (!key) return 'not ready';
    try { const value = await window.theia.container.get(key).executeCommand(id, ...args); return value === undefined ? 'ok' : String(value); }
    catch (error) { return 'error: ' + String(error); }
  }, { id, args }).catch(error => 'error: ' + String(error));
}

// 画面の点（webview 内座標）に何が当たっているか・プレビューとタイムラインで何が選ばれているか
const LAYER_IDS = ['photo-a', 'photo-b', 'photo-in-canvas', 'photo-lib', 'box', 'cut-1', 'canvas-1'];
async function observe(point) {
  const inside = await pv(`(() => {
    const vis = n => { const b = n.getBoundingClientRect(); const cs = getComputedStyle(n);
      return b.width > 0 && b.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !n.hidden && Number(cs.opacity) > 0; };
    const rect = n => { const b = n.getBoundingClientRect(); return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
    const pt = ${JSON.stringify(point ?? null)};
    let hit = null;
    if (pt) {
      const h = document.elementFromPoint(pt.x, pt.y);
      const chain = []; let n = h; while (n && chain.length < 8) { chain.push((n.tagName || '') + (n.id ? '#' + n.id : '') + '.' + String(n.className?.baseVal ?? n.className ?? '').split(' ').filter(Boolean).slice(0, 2).join('.')); n = n.parentElement; }
      hit = { chain, overlay: h?.closest?.('[data-overlay-id]')?.getAttribute('data-overlay-id') ?? null,
        layer: h?.closest?.('[data-akari-layer-id]')?.getAttribute('data-akari-layer-id') ?? null };
    }
    const layers = {};
    for (const id of ${JSON.stringify(LAYER_IDS)}) {
      const node = document.querySelector('[data-akari-layer-id=' + JSON.stringify(id) + ']') || document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']');
      if (node) layers[id] = { ...rect(node), tag: node.tagName, pe: getComputedStyle(node).pointerEvents };
    }
    const selectionUi = [...document.querySelectorAll('#layer-select-box, [id*="select-box"], .akari-interaction-selection-frame, [class*="cut-handle"], [class*="layer-handle"], [class*="select-handle"], [data-akari-selected], [aria-selected="true"]')]
      .filter(vis).map(n => ({ sel: (n.id ? '#' + n.id : '') + '.' + String(n.className?.baseVal ?? n.className ?? '').split(' ').filter(Boolean).slice(0, 3).join('.'),
        data: Object.fromEntries(Object.entries(n.dataset ?? {}).slice(0, 6)), ...rect(n) })).slice(0, 30);
    const handles = [...document.querySelectorAll('[class*="handle"], [data-akari-handle], [class*="interaction-action"]')].filter(vis)
      .map(n => ({ cls: String(n.className?.baseVal ?? n.className ?? '').slice(0, 90), ...rect(n) })).slice(0, 40);
    const brush = {
      stageCursor: getComputedStyle(document.getElementById('preview-stage')).cursor,
      layersCursor: getComputedStyle(document.getElementById('preview-layers') ?? document.body).cursor,
      badges: [...document.querySelectorAll('body *')].filter(n => vis(n) && n.children.length === 0 && /消しゴム|Esc/.test(n.textContent ?? '')).map(n => (n.textContent ?? '').trim().slice(0, 60)).slice(0, 6),
      brushNodes: [...document.querySelectorAll('[class*="brush"], [id*="brush"], [data-akari-brush]')].filter(vis).map(n => ({ sel: (n.id ? '#' + n.id : '') + '.' + String(n.className?.baseVal ?? n.className ?? '').slice(0, 60), ...rect(n) })).slice(0, 10),
    };
    return { hit, layers, selectionUi, handles, brush };
  })()`);
  const timeline = await page.evaluate(() => [...document.querySelectorAll('.akari-annotations-selected[data-akari-item-id]')]
    .map(n => `${n.dataset.akariItemKind}:${n.dataset.akariItemId}`)).catch(() => []);
  const inspector = await page.evaluate(() => {
    const title = document.querySelector('[class*="inspector"] h2, [class*="inspector"] [class*="title"]')?.textContent?.trim();
    const fields = [...document.querySelectorAll('[data-akari-field]')].map(n => n.getAttribute('data-akari-field')).slice(0, 60);
    return { title, fields };
  }).catch(() => ({}));
  return { ...inside, timeline, inspector };
}

async function pressEscape() { await page.keyboard.press('Escape').catch(() => {}); await sleep(300); }
async function clickStage(outPoint, label, { escape = true } = {}) {
  const box = await stageBox();
  const p = toPage(box, outPoint.x, outPoint.y);
  if (escape) await pressEscape();
  // 空の所を押して選択を外してから押す
  await page.mouse.move(p.x, p.y);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await sleep(1100);
  const inner = { x: p.x - box.x + box.fx, y: p.y - box.y + box.fy };
  const observed = await observe(inner);
  await shot(label);
  return { outPoint, pagePoint: { x: +p.x.toFixed(1), y: +p.y.toFixed(1) }, ...observed };
}

try {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(templateRoot, 'templates/project-default'), workspace, { recursive: true });
  await mkdir(join(workspace, 'assets'), { recursive: true });
  const enc = (args, file) => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args, join(workspace, 'assets', file)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg ${file}: ${r.stderr}`);
  };
  // 下の動画（灰色の縞）・写真 A（橙・不透明）・写真 B（青・左 1/4 が透明）・キャンバスの中の写真（緑）
  enc(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:d=10:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30'], 'base.mp4');
  // 写真 A は被写体のある写真（背景を消すの確認用。リポジトリの既存の検証用画像を使う）
  await cp(join(repo, 'evidence/c0a-group-media-render/fixture/assets/garden.jpg'), join(workspace, 'assets', 'photo-a.jpg'));
  enc(['-f', 'lavfi', '-i', 'color=c=0x2563eb:s=800x600:d=1', '-vf', "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,200),0,255)'", '-frames:v', '1'], 'photo-b.png');
  enc(['-f', 'lavfi', '-i', 'color=c=0x16a34a:s=600x600:d=1', '-frames:v', '1'], 'photo-c.png');
  // ライブラリの写真（プロジェクトの assets には無く、ライブラリの置き場にだけある。参照台帳で読み替える）
  const libDir = join(scratch, 'akari-home', 'assets', 'still', 'fx4-photo');
  await mkdir(libDir, { recursive: true });
  enc(['-f', 'lavfi', '-i', 'color=c=0xeab308:s=600x400:d=1', '-frames:v', '1'], 'photo-lib-tmp.png');
  await cp(join(workspace, 'assets', 'photo-lib-tmp.png'), join(libDir, 'photo.png'));
  await rm(join(workspace, 'assets', 'photo-lib-tmp.png'));
  await mkdir(join(workspace, '.akari'), { recursive: true });
  await writeFile(join(workspace, '.akari', 'asset-references.json'), JSON.stringify({ version: 0, references: [{ id: 'fx4-photo', category: 'still' }] }, null, 2) + '\n');
  const edit = {
    version: 2,
    output: { width: OUT_W, height: OUT_H, fps: 30 },
    sources: [{ id: 'base', path: 'assets/base.mp4' }, { id: 'pa', path: 'assets/photo-a.jpg' },
      { id: 'pb', path: 'assets/photo-b.png' }, { id: 'pc', path: 'assets/photo-c.png' },
      { id: 'plib', path: 'assets/still/fx4-photo/photo.png' }],
    tracks: [
      { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: 270,
        source: { kind: 'media', src: 'base', in: 0, out: 9 } }] },
      { id: 'v-a', lane: 'visual', name: '写真 A', items: [{ id: 'photo-a', at: 0, duration: 270, transform: { x: -250, y: -50, scale: 1.125 },
        source: { kind: 'media', src: 'pa', in: 0, out: 9 } }] },
      { id: 'v-b', lane: 'visual', name: '写真 B', items: [{ id: 'photo-b', at: 0, duration: 270, transform: { x: 100, y: 100, scale: 0.9 },
        source: { kind: 'media', src: 'pb', in: 0, out: 9 } }] },
      { id: 'v-box', lane: 'visual', name: '図形', items: [{ id: 'box', at: 0, duration: 270, transform: { x: 1500, y: 80 },
        source: { kind: 'shape', shape: 'rect', params: { width: 300, height: 200, fill: '#a855f7' } } }] },
      { id: 'v-lib', lane: 'visual', name: 'ライブラリの写真', items: [{ id: 'photo-lib', at: 0, duration: 270, transform: { x: -500, y: -330, scale: 0.6 },
        source: { kind: 'media', src: 'plib', in: 0, out: 9 } }] },
      { id: 'v-canvas', lane: 'visual', name: 'キャンバス', items: [{ id: 'canvas-1', at: 0, duration: 270, source: { kind: 'group' },
        transform: { x: -700, y: 330, scale: 0.5 },
        items: [{ id: 'photo-in-canvas', at: 0, duration: 270, source: { kind: 'media', src: 'pc', in: 0, out: 9 }, transform: { x: 0, y: 0, scale: 1 } }] }] },
    ]
  };
  await writeFile(join(workspace, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await mkdir(join(workspace, '.akari'), { recursive: true });
  run('git', ['init', '-q'], workspace);
  run('git', ['add', '-A'], workspace);
  run('git', ['-c', 'user.name=l1', '-c', 'user.email=l1@example.invalid', 'commit', '-qm', 'fixture'], workspace);

  const pre = run(electronBinary, ['--version'], shell);
  if (pre.code !== 0) throw new Error('Electron preflight failed');
  electron = spawn(electronBinary, [shell, workspace, `--remote-debugging-port=${port}`, '--hostname=127.0.0.1', '--port=48941',
    `--user-data-dir=${join(scratch, 'profile')}`, '--no-sandbox', '--force-color-profile=srgb'],
  { cwd: shell, stdio: ['ignore', 'ignore', 'pipe'], env, detached: true });
  result.electronPid = electron.pid;
  electron.stderr?.on('data', chunk => { electronStderr = (electronStderr + String(chunk)).slice(-6000); });
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (electron.exitCode !== null || electron.signalCode !== null) throw new Error('Electron exited early');
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await sleep(500); }
  }
  if (!browser) throw new Error('CDP did not start');
  for (let i = 0; i < 120 && !page; i++) { page = browser.contexts()[0]?.pages()[0]; if (!page) await sleep(500); }
  if (!page) throw new Error('no page');
  await page.setViewportSize({ width: 1800, height: 1200 });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = new CDP(version.webSocketDebuggerUrl); await cdp.connect();
  const runtimeMessages = [];
  cdp.on('Runtime.exceptionThrown', event => runtimeMessages.push(clean(
    event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? '').slice(0, 400)));
  const finder = new PreviewFinder(cdp); await finder.initialize(); finderRef = finder;
  const editUri = pathToFileURL(join(workspace, 'edit.json')).href;
  let opened = false;
  for (let i = 0; i < 100 && !opened; i++) {
    await page.getByRole('button', { name: '開くだけ' }).click({ timeout: 100 }).catch(() => {});
    const state = await execCommand('akari.preview.ensureVisible', { editUri });
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
  for (const s of finder.sessions.values()) await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s.sessionId).catch(() => {});
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await page.bringToFront().catch(() => {});
  for (let i = 0; i < 80; i++) {
    if (await pv(`Number(document.getElementById('seek')?.max || 0) >= 3.5
      && document.getElementById('preview-stage')?.getBoundingClientRect().width > 0
      && Boolean(document.querySelector('[data-akari-layer-id="photo-b"]'))`).catch(() => false)) break;
    await sleep(250);
  }
  await sleep(2000);
  await pv(`(() => { const seek = document.getElementById('seek'); seek.value = 2;
    seek.dispatchEvent(new Event('input', { bubbles: true })); seek.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(1500);
  await writeFile(join(out, 'page-00.png'), await page.screenshot());
  await shot('00-initial');
  const initial = await observe(null);
  step('initial', { stage: await stageBox(), layers: initial.layers });

  // 写真の位置は DOM から測る（出力座標へ直す）
  const box = await stageBox();
  const k = box.width / OUT_W;
  const L = initial.layers;
  const outRect = id => L[id] ? { x: (L[id].x - box.fx) / k, y: (L[id].y - box.fy) / k, w: L[id].w / k, h: L[id].h / k } : null;
  const A = outRect('photo-a'), Bp = outRect('photo-b');
  step('photo-rects-out', { A, B: Bp });
  const inRect = (r, fx, fy) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy });
  const points = {
    bOnly: inRect(Bp, 0.8, 0.8),
    overlapOpaque: { x: (Bp.x + Bp.w * 0.25 + Math.min(A.x + A.w, Bp.x + Bp.w)) / 2, y: (Math.max(A.y, Bp.y) + Math.min(A.y + A.h, Bp.y + Bp.h)) / 2 },
    overlapTransparent: { x: (Math.max(A.x, Bp.x) + Bp.x + Bp.w * 0.25) / 2, y: (Math.max(A.y, Bp.y) + Math.min(A.y + A.h, Bp.y + Bp.h)) / 2 },
    aOnly: inRect(A, 0.3, 0.6),
    outside: { x: 1700, y: 1000 },
    canvasPhoto: { x: 260, y: 870 },
    libPhoto: { x: 330, y: 150 },
    shape: { x: 1650, y: 180 },
  };
  step('points-out', points);

  if (wanted('clicks')) {
    step('click-b-only', await clickStage(points.bOnly, '01-click-b-only'));
    step('click-overlap-opaque', await clickStage(points.overlapOpaque, '02-click-overlap-opaque'));
    step('click-overlap-transparent', await clickStage(points.overlapTransparent, '03-click-overlap-transparent'));
    step('click-a-only', await clickStage(points.aOnly, '04-click-a-only'));
    step('click-outside', await clickStage(points.outside, '05-click-outside'));
    step('click-shape', await clickStage(points.shape, '06-click-shape'));
    step('click-lib-photo', await clickStage(points.libPhoto, '06a-click-lib-photo'));
    step('click-canvas-photo', await clickStage(points.canvasPhoto, '06b-click-canvas-photo'));
    // カット（下の動画）を選んだ状態から写真を押す（Escape なし）
    step('preselect-cut', await clickStage(points.outside, '06c-preselect-cut'));
    step('click-b-after-cut', await clickStage(points.bOnly, '06d-click-b-after-cut', { escape: false }));
    step('click-a-after-b', await clickStage(points.aOnly, '06e-click-a-after-b', { escape: false }));
    await writeFile(join(out, 'page-06.png'), await page.screenshot());
  }

  if (wanted('handles')) {
    // 写真 B を押して選ぶ → つまみ（右下の角・右の辺）・移動・回転 → undo 1 回
    const cs = await page.context().newCDPSession(page);
    const undo = async () => {
      await cs.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4, commands: ['undo'] });
      await cs.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
      await sleep(1800);
    };
    const handleRects = async () => {
      const o = await observe(null);
      const map = {};
      for (const h of o.handles) {
        const m = /akari-layer-handle-([a-z]+)/.exec(h.cls) || /is-(nw|ne|sw|se|n|s|e|w|rotate|move)\b/.exec(h.cls);
        if (m && !map[m[1]]) map[m[1]] = { x: h.x + h.w / 2, y: h.y + h.h / 2, w: h.w };
      }
      return { map, box: o.selectionUi.find(u => u.sel.startsWith('#layer-select-box')) ?? null, timeline: o.timeline, all: o.handles.map(h => h.cls) };
    };
    const host = await frameBox();
    const toPg = pt => ({ x: host.x + pt.x, y: host.y + pt.y });
    const drag = async (from, dx, dy, steps = 14) => {
      const a = toPg(from);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await sleep(80);
      for (let i = 1; i <= steps; i++) { await page.mouse.move(a.x + dx * i / steps, a.y + dy * i / steps); await sleep(30); }
      await sleep(200); await page.mouse.up(); await sleep(1600);
    };
    let target = 'photo-b';
    let targetPoint = points.bOnly;
    const itemT = async () => findItem(await readEdit(), target)?.transform ?? null;
    const run1 = async (name, handle, dx, dy, fixed) => {
      await clickStage(targetPoint, `h-${name}-select`);
      const h0 = await handleRects();
      const t0 = await itemT(); const hist0 = await historyCount(); const text0 = await readFile(join(workspace, 'edit.json'), 'utf8');
      if (!h0.map[handle]) return { error: `handle ${handle} not found`, handles: h0.all, timeline: h0.timeline };
      await drag(h0.map[handle], dx, dy);
      const h1 = await handleRects();
      const t1 = await itemT(); const hist1 = await historyCount();
      await shot(`h-${name}-after`);
      const moved = fixed && h0.map[fixed] && h1.map[fixed] ? { x: +(h1.map[fixed].x - h0.map[fixed].x).toFixed(2), y: +(h1.map[fixed].y - h0.map[fixed].y).toFixed(2) } : null;
      const boxBefore = h0.box, boxAfter = h1.box;
      await undo();
      const t2 = await itemT();
      const undone = (await readFile(join(workspace, 'edit.json'), 'utf8')) === text0;
      return { timelineOnSelect: h0.timeline, handlesOnSelect: h0.all, transformBefore: t0, transformAfter: t1, historyDelta: hist1 - hist0,
        fixedCornerMovePx: moved, aspectBefore: boxBefore ? +(boxBefore.w / boxBefore.h).toFixed(4) : null, aspectAfter: boxAfter ? +(boxAfter.w / boxAfter.h).toFixed(4) : null,
        boxBefore, boxAfter, transformAfterUndo: t2, undoRestoredBytes: undone };
    };
    step('handle-se', await run1('se', 'se', 40, 30, 'nw'));
    step('handle-e', await run1('e', 'e', 40, 0, 'w'));
    step('handle-move', await run1('move', 'move', -30, -20, null));
    step('handle-rotate', await run1('rotate', 'rotate', 40, -30, null));
    step('handle-w', await run1('w', 'w', -30, 0, 'e'));
    step('handle-s', await run1('s', 's', 0, 25, 'n'));
    // キャンバスの中の写真: 移動と右下の角
    target = 'photo-in-canvas'; targetPoint = points.canvasPhoto;
    step('canvas-move', await run1('canvas-move', 'move', 20, -15, null));
    step('canvas-se', await run1('canvas-se', 'se', 20, 20, 'nw'));
    step('canvas-timeline-dom', await page.evaluate(() => [...document.querySelectorAll('[data-akari-item-id]')]
      .filter(n => /canvas|photo-in/.test(n.dataset.akariItemId)).map(n => ({ kind: n.dataset.akariItemKind, id: n.dataset.akariItemId,
        cls: n.className.slice(0, 120), visible: n.getBoundingClientRect().width > 0 })).slice(0, 12)));
    await clickStage(points.canvasPhoto, 'h-canvas-inspector');
    for (const name of ['映像', '編集']) {
      if (await page.locator('[data-akari-field="photo-brush-start"]').count()) break;
      const tab = page.locator('[role="tab"], [class*="inspector"] [class*="tab"]').filter({ hasText: new RegExp('^' + name + '$') }).first();
      if (await tab.count()) { await tab.click({ timeout: 2000 }).catch(() => {}); await sleep(600); }
    }
    step('canvas-inspector', await page.evaluate(() => ({ photoFields: [...document.querySelectorAll('[data-akari-field^="photo-"]')].map(n => n.getAttribute('data-akari-field')),
      timeline: [...document.querySelectorAll('.akari-annotations-selected[data-akari-item-id]')].map(n => `${n.dataset.akariItemKind}:${n.dataset.akariItemId}`) })));
    await writeFile(join(out, 'page-canvas-photo-selected.png'), await page.screenshot());
  }

  if (wanted('crop')) {
    // F-1a の経路: 写真をダブルクリック → 切り抜きモード（押して選んだ写真と同じ写真に入る）
    await clickStage(points.bOnly, 'c-select-b');
    const p = toPage(await stageBox(), points.bOnly.x, points.bOnly.y);
    await page.mouse.dblclick(p.x, p.y); await sleep(1500);
    const state = await pv(`({ active: document.getElementById('photo-crop-controls')?.classList.contains('is-active') ?? false,
      photoCropBox: document.getElementById('layer-crop-box')?.classList.contains('is-photo-crop') ?? false })`);
    await shot('c-crop-mode');
    await pressEscape();
    const after = await pv(`({ active: document.getElementById('photo-crop-controls')?.classList.contains('is-active') ?? false })`);
    step('crop-dblclick', { state, afterEscape: after, timeline: (await observe(null)).timeline });
    // 消しゴムのボタンのトグル（もう一度押すと終わる）
    await page.locator('[data-akari-item-id="photo-b"]').first().click({ timeout: 4000 }).catch(() => {});
    await sleep(1500);
    for (const name of ['映像', '編集']) {
      if (await page.locator('[data-akari-field="photo-brush-start"]').count()) break;
      const tab = page.locator('[role="tab"], [class*="inspector"] [class*="tab"]').filter({ hasText: new RegExp('^' + name + '$') }).first();
      if (await tab.count()) { await tab.click({ timeout: 2000 }).catch(() => {}); await sleep(600); }
    }
    const btn = page.locator('[data-akari-field="photo-brush-start"] button').first();
    const pressed = async () => page.evaluate(() => document.querySelector('[data-akari-field="photo-brush-start"] button')?.getAttribute('aria-pressed') ?? null);
    await btn.click({ timeout: 4000 }).catch(() => {}); await sleep(1000);
    const on = { pressed: await pressed(), badges: (await observe(null)).brush.badges };
    await writeFile(join(out, 'page-eraser-on.png'), await page.screenshot());
    await btn.click({ timeout: 4000 }).catch(() => {}); await sleep(1000);
    const off = { pressed: await pressed(), badges: (await observe(null)).brush.badges };
    step('eraser-toggle', { on, off });
  }

  if (wanted('inspector')) {
    // タイムラインで写真 B を押して選ぶ → インスペクターの「背景を消す」と「消しゴム」
    await pressEscape();
    const chip = page.locator('[data-akari-item-id="photo-b"]').first();
    step('timeline-select-b', { clicked: await chip.click({ timeout: 4000 }).then(() => true).catch(e => clean(e.message).slice(0, 200)) });
    await sleep(1500);
    step('after-timeline-select-b', await observe(null));
    await writeFile(join(out, 'page-07-timeline-select-b.png'), await page.screenshot());
    step('inspector-tabs', await page.evaluate(() => [...document.querySelectorAll('[role="tab"], [class*="inspector"] [class*="tab"]')]
      .filter(n => n.getBoundingClientRect().width > 0).map(n => n.textContent.trim().slice(0, 20)).slice(0, 30)));
    for (const name of ['映像', '編集', '動き', '色', '情報']) {
      const tab = page.locator('[role="tab"], [class*="inspector"] [class*="tab"]').filter({ hasText: new RegExp('^' + name + '$') }).first();
      if (await tab.count()) { await tab.click({ timeout: 2000 }).catch(() => {}); await sleep(600); }
      if (await page.locator('[data-akari-field="photo-brush-start"]').count()) break;
    }
    const fieldTexts = await page.evaluate(() => [...document.querySelectorAll('[data-akari-field^="photo-"]')]
      .map(x => ({ field: x.getAttribute('data-akari-field'), text: x.textContent.trim().slice(0, 60),
        pressed: x.querySelector('button')?.getAttribute('aria-pressed') ?? null, cls: x.querySelector('button')?.className ?? null })));
    step('inspector-photo-fields', fieldTexts);
    // 背景を消す（写真 A = 被写体のある写真）
    await page.locator('[data-akari-item-id="photo-a"]').first().click({ timeout: 4000 }).catch(() => {});
    await sleep(1500);
    for (const name of ['映像', '編集', '動き', '色', '情報']) {
      if (await page.locator('[data-akari-field="photo-mask-generate"]').count()) break;
      const tab = page.locator('[role="tab"], [class*="inspector"] [class*="tab"]').filter({ hasText: new RegExp('^' + name + '$') }).first();
      if (await tab.count()) { await tab.click({ timeout: 2000 }).catch(() => {}); await sleep(600); }
    }
    const mask = page.locator('[data-akari-field="photo-mask-generate"] button').first();
    const before = await readFile(join(workspace, 'edit.json'), 'utf8');
    step('mask-click', { clicked: await mask.click({ timeout: 4000 }).then(() => true).catch(e => clean(e.message).slice(0, 200)) });
    for (let i = 0; i < 60; i++) { await sleep(500); if ((await readFile(join(workspace, 'edit.json'), 'utf8')) !== before) break; }
    await sleep(1000);
    const notices = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(n => n.children.length === 0 && /Mac|背景を消|準備|しました/.test(n.textContent ?? '') && n.getBoundingClientRect().width > 0)
      .map(n => n.textContent.trim().slice(0, 80)).slice(0, 12));
    const afterMask = await readEdit();
    step('mask-result', { notices, editChanged: JSON.stringify(afterMask) !== JSON.stringify(JSON.parse(before)),
      mask: findItem(afterMask, 'photo-a')?.mask ?? null, masks: await readdir(join(workspace, 'assets', 'masks')).catch(() => []), historyCount: await historyCount() });
    await shot('08-mask');
    // 消しゴムは写真 B で
    await page.locator('[data-akari-item-id="photo-b"]').first().click({ timeout: 4000 }).catch(() => {});
    await sleep(1500);
    await writeFile(join(out, 'page-08-mask.png'), await page.screenshot());
    // 消しゴム
    const eraser = page.locator('[data-akari-field="photo-brush-start"] button').first();
    step('eraser-click', { clicked: await eraser.click({ timeout: 4000 }).then(() => true).catch(e => clean(e.message).slice(0, 200)) });
    await sleep(1200);
    const eraserState = await page.evaluate(() => { const b = document.querySelector('[data-akari-field="photo-brush-start"] button');
      return b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), cls: b.className, bg: getComputedStyle(b).backgroundColor } : null; });
    const bCenter = toPage(await stageBox(), Bp.x + Bp.w * 0.6, Bp.y + Bp.h * 0.5);
    await page.mouse.move(bCenter.x, bCenter.y); await sleep(400);
    const inner = await stageBox();
    step('eraser-state', { button: eraserState, preview: await observe({ x: bCenter.x - inner.x + inner.fx, y: bCenter.y - inner.y + inner.fy }) });
    await writeFile(join(out, 'page-09-eraser-on.png'), await page.screenshot());
    await shot('09-eraser-on');
    // 写真 B の上をなぞる（1 本）
    const h0 = await historyCount();
    const text0 = await readFile(join(workspace, 'edit.json'), 'utf8');
    const s = toPage(await stageBox(), Bp.x + Bp.w * 0.45, Bp.y + Bp.h * 0.3);
    const e = toPage(await stageBox(), Bp.x + Bp.w * 0.85, Bp.y + Bp.h * 0.7);
    await page.mouse.move(s.x, s.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) { await page.mouse.move(s.x + (e.x - s.x) * i / 16, s.y + (e.y - s.y) * i / 16); await sleep(25); }
    await page.mouse.up(); await sleep(2000);
    const afterStroke = await readEdit();
    step('eraser-stroke-1', { editChanged: JSON.stringify(afterStroke) !== JSON.stringify(JSON.parse(text0)),
      erase: findItem(afterStroke, 'photo-b')?.erase ?? null, historyDelta: (await historyCount()) - h0,
      timelineSel: (await observe(null)).timeline });
    await shot('10-eraser-stroke-1');
    // 2 本目 → undo 1 回で 1 本に戻る → もう 1 回で 0 本
    const s2 = toPage(await stageBox(), Bp.x + Bp.w * 0.45, Bp.y + Bp.h * 0.8);
    const e2 = toPage(await stageBox(), Bp.x + Bp.w * 0.9, Bp.y + Bp.h * 0.8);
    await page.mouse.move(s2.x, s2.y); await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(s2.x + (e2.x - s2.x) * i / 12, s2.y + (e2.y - s2.y) * i / 12); await sleep(25); }
    await page.mouse.up(); await sleep(2000);
    const strokes2 = (findItem(await readEdit(), 'photo-b')?.erase ?? []).length;
    await shot('11-eraser-stroke-2');
    const cs2 = await page.context().newCDPSession(page);
    const undo2 = async () => {
      await cs2.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4, commands: ['undo'] });
      await cs2.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 4 });
      await sleep(1800);
    };
    await undo2();
    const strokesU1 = (findItem(await readEdit(), 'photo-b')?.erase ?? []).length;
    await shot('12-eraser-undo-1');
    await undo2();
    const strokesU2 = (findItem(await readEdit(), 'photo-b')?.erase ?? []).length;
    step('eraser-undo', { strokes2, strokesU1, strokesU2 });
    await pressEscape();
    step('eraser-after-escape', { button: await page.evaluate(() => document.querySelector('[data-akari-field="photo-brush-start"] button')?.getAttribute('aria-pressed') ?? null),
      preview: (await observe(null)).brush });
  }
  step('runtime-exceptions', runtimeMessages.slice(0, 20));
} catch (error) {
  result.errors.push(clean(error?.stack ?? error).slice(0, 2000));
  console.error(error);
} finally {
  result.electronStderrTail = clean(electronStderr).slice(-1500);
  await writeFile(join(out, `${tag}.json`), clean(JSON.stringify(result, null, 2)) + '\n').catch(() => {});
  try { await browser?.close(); } catch { /* closed */ }
  cdp?.close();
  if (electron?.pid) {
    try { process.kill(-electron.pid, 'SIGTERM'); } catch { /* exited */ }
    await sleep(2500);
    try { process.kill(-electron.pid, 'SIGKILL'); } catch { /* exited */ }
  }
  // 自分が起動した Electron の子（別のプロセスグループへ逃げた backend）も、一時ディレクトリの名前で拾って止める
  const leftover = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .filter(line => line.includes(scratch) || line.includes(shell + '/node_modules/electron/dist'))
    .map(line => Number(line.trim().split(/\s+/)[0])).filter(pid => pid > 0 && pid !== process.pid);
  for (const pid of leftover) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  result.leftoverKilled = leftover.length;
  process.exit(result.errors.length ? 1 : 0);
}
