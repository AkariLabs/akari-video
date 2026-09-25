#!/usr/bin/env node
// L1 AFTER（検証専用）: 図形タイル → 棚（暗い・明るい）→ 星を押す → undo → ハート（中心の指定・タイムラインへ落とす）
// → ラインの「すべて表示」→ 破線 + 両端の三角 → 漫画の吹き出し（叫び）→ 最近使用 → 検索 → 書き出し（render-cut）と比較。
// 使い方: node evidence/s1-shape-shelf/run-after.mjs --shell <apps/shell> --repo <リポジトリ root> --out <出力 dir>
// 環境変数 AKARI_CDP_PORT（既定 9553）

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  clickSelector, evaluate, executeCommand, findPreviewView, hover, launchShell, makeScratch, rectOf, screenshot,
  scrub, setTheme, sleep, waitFor
} from './cdp-lib.mjs';
import { writeFixtureProject } from './fixture.mjs';

const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const shellDir = path.resolve(argument('shell'));
const repo = path.resolve(argument('repo'));
const outDir = path.resolve(argument('out', '.'));
const port = Number(process.env.AKARI_CDP_PORT ?? 9553);
await mkdir(outDir, { recursive: true });

const dirs = await makeScratch('libcanvas-s1-after-');
const editPath = await writeFixtureProject(dirs.project);
const editUri = pathToFileURL(editPath).href;
await setTheme(dirs.config, 'dark');
const report = { label: 'after', port, steps: {} };
const out = name => path.join(outDir, name);
const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));
const shapeItems = edit => edit.tracks.flatMap(track => (track.items ?? []).map(item => ({ ...item, track: track.id })))
  .filter(item => item.source?.kind === 'shape');
const summarize = item => item && ({
  id: item.id, track: item.track, at: item.at, duration: item.duration, transform: item.transform,
  shape: item.source.shape, preset: item.source.params.preset,
  width: item.source.params.width, height: item.source.params.height,
  fill: item.source.params.fill, stroke: item.source.params.stroke, strokeWidth: item.source.params.strokeWidth,
  dash: item.source.params.dash, startCap: item.source.params.startCap, endCap: item.source.params.endCap,
  style: item.source.params.style, cornerRadius: item.source.params.cornerRadius,
  center: item.transform && { x: item.transform.x + item.source.params.width / 2, y: item.transform.y + item.source.params.height / 2 },
});

let shell;
let view;
async function panelRect(main, selector) {
  return evaluate(main, `(() => {
    // いちばん近い縦スクロールの箱（左のパネル）の見えている範囲を撮る。
    let node = document.querySelector(${JSON.stringify(selector)});
    while (node && !(/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.clientHeight > 200)) node = node.parentElement;
    const r = node?.getBoundingClientRect();
    if (!r) return null;
    const top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom);
    return { x: Math.max(0, r.left), y: top, width: Math.min(innerWidth, r.right) - Math.max(0, r.left), height: bottom - top };
  })()`);
}
async function shotPanel(main, name, selector = '[data-akari-shape-shelf]') {
  const rect = await panelRect(main, selector);
  return rect ? screenshot(main, out(name), rect) : undefined;
}
async function previewFrameOffset(main) {
  return evaluate(main, `(() => {
    const frames = [...document.querySelectorAll('iframe')].map(f => f.getBoundingClientRect()).filter(r => r.width > 50 && r.height > 50);
    frames.sort((a, b) => b.width * b.height - a.width * a.height);
    return frames[0] ? { x: frames[0].x, y: frames[0].y } : { x: 0, y: 0 };
  })()`);
}
/** プレビューの図形の SVG の矩形を出力 px に直す。 */
async function observe(ids) {
  if (!view) return undefined;
  const { browser } = shell;
  return evaluate(browser, `(() => {
    const stage = document.getElementById('preview-layers').getBoundingClientRect();
    const k = 1920 / stage.width;
    const items = {};
    for (const id of ${JSON.stringify(ids)}) {
      const node = document.querySelector('[data-overlay-id=' + JSON.stringify(id) + ']');
      const svg = node?.querySelector('svg');
      const visible = node && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
      if (!svg || !visible) { items[id] = { mounted: Boolean(node), visible: Boolean(visible) }; continue; }
      const r = svg.getBoundingClientRect();
      items[id] = { mounted: true, visible: true,
        output: { x: +((r.left - stage.x) * k).toFixed(1), y: +((r.top - stage.y) * k).toFixed(1),
          width: +(r.width * k).toFixed(1), height: +(r.height * k).toFixed(1),
          centerX: +((r.left + r.width / 2 - stage.x) * k).toFixed(1), centerY: +((r.top + r.height / 2 - stage.y) * k).toFixed(1) },
        fillAttr: svg.querySelector('path, line')?.getAttribute('fill'), strokeAttr: svg.querySelector('path, line')?.getAttribute('stroke') };
    }
    return { stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height }, items };
  })()`, view.contextId, view.sessionId);
}
async function shotStage(main, name) {
  const observed = await observe([]);
  if (!observed) return undefined;
  const outer = await previewFrameOffset(main);
  return screenshot(main, out(name), { x: outer.x + observed.stage.x, y: outer.y + observed.stage.y,
    width: observed.stage.width, height: observed.stage.height });
}
async function seek(main, seconds) {
  const result = await executeCommand(main, 'akari.timeline.seek', { seconds });
  await sleep(1800);
  return result;
}
async function waitShape(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const items = shapeItems(await readEdit());
    const hit = predicate(items);
    if (hit) return hit;
    await sleep(300);
  }
  return undefined;
}
async function setSearch(main, value) {
  return evaluate(main, `(() => {
    const input = [...document.querySelectorAll('input')].find(node => (node.placeholder ?? '').startsWith('ライブラリを'));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
async function tileColor(main) {
  return evaluate(main, `(() => {
    const tile = document.querySelector('[data-akari-shape-tile]');
    return tile ? { color: getComputedStyle(tile).color, background: getComputedStyle(tile).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      panelBackground: getComputedStyle(document.querySelector('[data-akari-shape-shelf]').parentElement).backgroundColor } : null;
  })()`);
}

const compareTimes = [];
try {
  shell = await launchShell({ shellDir, dirs, port });
  const { main, browser } = shell;
  await sleep(10000);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
  report.steps.openTimeline = await executeCommand(main, 'akari.annotations.open');
  const deadline = Date.now() + 120000;
  while (!view && Date.now() < deadline) {
    const opened = await executeCommand(main, 'akari.preview.ensureVisible', { editUri });
    if (!opened.ok) { await sleep(3000); continue; }
    await sleep(4000);
    view = await findPreviewView(browser, 15000);
  }
  report.previewBuilt = Boolean(view);
  report.steps.openLibrary = await executeCommand(main, 'akari.catalog.open', { tab: 'library' });
  await waitFor(main, `(document.querySelector('[data-akari-library-primary-tile="shapes"]')?.getBoundingClientRect().width ?? 0) > 0`, 60000);
  await sleep(1000);
  report.steps.tile = await evaluate(main, `(() => { const n = document.querySelector('[data-akari-library-primary-tile="shapes"]');
    return { disabled: n.disabled, soon: n.getAttribute('data-akari-library-soon'), title: n.title }; })()`);
  await shotPanel(main, 'after-library-home.png', '[data-akari-library-primary-tile="shapes"]');

  // 1. 棚（暗い）。起動直後は描画が遅れることがあるので、棚が出るまで押し直す
  for (let attempt = 0; attempt < 5; attempt++) {
    await clickSelector(main, '[data-akari-library-primary-tile="shapes"]').catch(() => undefined);
    if (await waitFor(main, `document.querySelectorAll('[data-akari-shape-tile]').length > 50`, 10000)) break;
  }
  await sleep(800);
  report.steps.shelf = await evaluate(main, `(() => {
    const rows = [...document.querySelectorAll('[data-akari-shape-row]')].map(row => ({
      key: row.getAttribute('data-akari-shape-row'), label: row.querySelector('strong')?.textContent,
      tiles: row.querySelectorAll('[data-akari-shape-tile]').length, total: Number(row.getAttribute('data-akari-shape-row-total')),
      showAll: Boolean(row.querySelector('[data-akari-shape-show-all]')) }));
    const tiles = [...document.querySelectorAll('[data-akari-shape-tile]')];
    return { rows, tileTextChars: tiles.reduce((n, t) => n + (t.textContent ?? '').trim().length, 0),
      tileTitlesSample: tiles.slice(0, 3).map(t => t.title) };
  })()`);
  report.steps.shelfDarkColor = await tileColor(main);
  await shotPanel(main, 'after-shelf-dark.png');

  // 2. 行ごとの左右スライド（‹ › はホバーで出る）
  const basic = await rectOf(main, '[data-akari-shape-row="basic"] [data-akari-shape-track]');
  await hover(main, basic.x + basic.width / 2, basic.y + basic.height / 2);
  await sleep(400);
  const scrollBefore = await evaluate(main, `document.querySelector('[data-akari-shape-track="basic"]').scrollLeft`);
  const next = await rectOf(main, '[data-akari-shape-row="basic"] [data-akari-shape-nav="next"]');
  await shell.main.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: next.x + 12, y: next.y + 12 });
  await sleep(400);
  const nextOpacity = await evaluate(main, `getComputedStyle(document.querySelector('[data-akari-shape-row="basic"] [data-akari-shape-nav="next"]')).opacity`);
  await shell.main.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: next.x + 12, y: next.y + 12, button: 'left', clickCount: 1 });
  await shell.main.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: next.x + 12, y: next.y + 12, button: 'left', clickCount: 1 });
  await sleep(900);
  const scrollAfter = await evaluate(main, `document.querySelector('[data-akari-shape-track="basic"]').scrollLeft`);
  // トラックパッドの横スクロール（wheel の deltaX）
  const star = await rectOf(main, '[data-akari-shape-track="star"]');
  await shell.main.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: star.x + star.width / 2, y: star.y + star.height / 2, deltaX: 160, deltaY: 0 });
  await sleep(900);
  const wheelScroll = await evaluate(main, `document.querySelector('[data-akari-shape-track="star"]').scrollLeft`);
  report.steps.slide = { scrollBefore, nextOpacityOnHover: nextOpacity, scrollAfterNext: scrollAfter, starRowScrollAfterWheel: wheelScroll };
  await hover(main, basic.x + basic.width / 2, basic.y + basic.height / 2);
  await sleep(300);
  await shotPanel(main, 'after-shelf-slide-dark.png');
  await evaluate(main, `document.querySelectorAll('[data-akari-shape-track]').forEach(t => { t.style.scrollBehavior = 'auto'; t.scrollLeft = 0; t.style.scrollBehavior = ''; })`);

  // 3. 棚（明るい）
  await setTheme(dirs.config, 'light');
  report.steps.lightApplied = Boolean(await waitFor(main, `getComputedStyle(document.documentElement).colorScheme === 'light'`, 20000));
  await sleep(1500);
  report.steps.shelfLightColor = await tileColor(main);
  await shotPanel(main, 'after-shelf-light.png');
  await clickSelector(main, '[data-akari-shape-show-all="line"]');
  await waitFor(main, `Boolean(document.querySelector('[data-akari-shape-grid="lines"]'))`, 10000);
  await sleep(500);
  await shotPanel(main, 'after-lines-all-light.png');
  await clickSelector(main, '[data-akari-shape-back]');
  await setTheme(dirs.config, 'dark');
  report.steps.darkRestored = Boolean(await waitFor(main, `getComputedStyle(document.documentElement).colorScheme === 'dark'`, 20000));
  await sleep(1500);

  // 4. 星を押す → プレイヘッドの時刻・中央に灰色の星 → undo 1 回で消える
  report.steps.seekStar = await seek(main, 1);
  await clickSelector(main, '[data-akari-shape-tile="star-5"]');
  const starItem = await waitShape(items => items.find(item => item.source.params.preset === 'star-5'));
  report.steps.star = summarize(starItem);
  await sleep(2500);
  report.steps.starPreview = await observe([starItem?.id ?? 'shape-1']);
  report.steps.starSelected = await evaluate(main, `(() => { const n = document.querySelector('[data-akari-item-id="${starItem?.id ?? 'shape-1'}"]');
    return n ? { className: n.className, selected: n.classList.contains('akari-annotations-selected') } : null; })()`);
  await shotStage(main, 'after-star-stage.png');
  report.steps.undo = await executeCommand(main, 'akari.timeline.undo');
  const afterUndo = await waitShape(items => (items.every(item => item.source.params.preset !== 'star-5') ? { gone: true, count: items.length } : undefined));
  report.steps.starAfterUndo = afterUndo ?? { gone: false };
  await sleep(2000);
  report.steps.starPreviewAfterUndo = await observe([starItem?.id ?? 'shape-1']);
  await shotStage(main, 'after-star-undo-stage.png');

  // 5. ハート: プレビューの左下へ落としたときの呼び出し（P-1 の層がつなぐ先）= center 指定
  const heartCommand = await executeCommand(main, 'akari.timeline.addShapeAt', { preset: 'heart-heart', t: 1, center: { x: 320, y: 810 } });
  report.steps.heartCommand = heartCommand;
  const heartItem = await waitShape(items => items.find(item => item.id === heartCommand.value));
  report.steps.heart = summarize(heartItem);
  await sleep(2000);
  report.steps.heartPreview = await observe([heartCommand.value]);
  await shotStage(main, 'after-heart-center-stage.png');

  // 6. ラインの「すべて表示」→ 破線 + 両端の三角 → 黒い線
  await clickSelector(main, '[data-akari-shape-show-all="line"]');
  await waitFor(main, `Boolean(document.querySelector('[data-akari-shape-grid="lines"]'))`, 10000);
  await sleep(500);
  report.steps.linesAll = await evaluate(main, `({ tiles: document.querySelectorAll('[data-akari-shape-grid="lines"] [data-akari-shape-tile]').length,
    title: document.querySelector('[data-akari-shape-shelf] strong')?.textContent })`);
  await shotPanel(main, 'after-lines-all-dark.png');
  await seek(main, 1);
  await clickSelector(main, '[data-akari-shape-tile="line-dash-tri-tri"]');
  const lineItem = await waitShape(items => items.find(item => item.source.params.preset === 'line-dash-tri-tri'));
  report.steps.line = summarize(lineItem);
  await sleep(2500);
  report.steps.linePreview = await observe([lineItem?.id]);
  await shotStage(main, 'after-line-stage.png');
  await clickSelector(main, '[data-akari-shape-back]');
  await sleep(500);

  // 7. ハートをタイムラインへ落とす（落とした時刻・出力の中央）
  const drop = await evaluate(main, `(() => {
    const tile = document.querySelector('[data-akari-shape-tile="heart-heart"]');
    const strip = document.querySelector('.akari-annotations-strip');
    if (!tile || !strip) return { ok: false, reason: !tile ? 'no tile' : 'no strip' };
    const dt = new DataTransfer();
    tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const r = strip.getBoundingClientRect();
    const x = r.left + r.width * 0.3, y = r.top + Math.min(40, r.height / 2);
    const target = document.elementFromPoint(x, y) ?? strip;
    for (const type of ['dragenter', 'dragover']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    const dropped = target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { ok: true, prevented: !dropped, payload: dt.getData('application/x-akari-library-item') };
  })()`);
  report.steps.timelineDrop = drop;
  const droppedHeart = await waitShape(items => items.find(item => item.source.params.preset === 'heart-heart' && item.id !== heartCommand.value));
  report.steps.timelineDropHeart = summarize(droppedHeart);

  // 8. 漫画の吹き出し（叫び）→ 白塗り + 黒枠
  await seek(main, 12);
  await clickSelector(main, '[data-akari-shape-tile="manga-shout"]');
  const shoutItem = await waitShape(items => items.find(item => item.source.params.preset === 'manga-shout'));
  report.steps.shout = summarize(shoutItem);
  await sleep(2500);
  report.steps.shoutPreview = await observe([shoutItem?.id]);
  await shotStage(main, 'after-shout-stage.png');

  // 9. 最近使用した項目（置いた順・新しいものが先頭）
  await evaluate(main, `document.querySelector('[data-akari-shape-shelf]')?.scrollIntoView({ block: 'start' })`);
  await sleep(600);
  report.steps.recent = await evaluate(main, `[...document.querySelectorAll('[data-akari-shape-track="recent"] [data-akari-shape-tile]')].map(t => t.getAttribute('data-akari-shape-tile'))`);
  report.steps.recentStorage = await evaluate(main, `localStorage.getItem('akari.library.shapes.recent')`);
  await shotPanel(main, 'after-recent-dark.png');
  // 棚の最後（漫画の吹き出しの行）まで送ったとき、ライブラリの「追加」ボタンに隠れないこと
  report.steps.shelfEnd = await evaluate(main, `(() => {
    let box = document.querySelector('[data-akari-shape-shelf]');
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    if (!box) return null;
    box.scrollTop = box.scrollHeight;
    const fab = document.querySelector('.akari-library-import-add')?.getBoundingClientRect();
    const tiles = [...document.querySelectorAll('[data-akari-shape-track="manga"] [data-akari-shape-tile]')].map(t => t.getBoundingClientRect())
      .filter(r => r.right > box.getBoundingClientRect().left && r.left < box.getBoundingClientRect().right);
    const lastBottom = Math.max(...tiles.map(r => r.bottom));
    return { fabTop: fab?.top, lastRowBottom: lastBottom, clear: fab ? lastBottom <= fab.top : true };
  })()`);
  await sleep(300);
  await shotPanel(main, 'after-shelf-end-dark.png');

  // 10. 検索（棚の中 / ライブラリのホーム）
  await setSearch(main, 'ハート');
  await sleep(800);
  report.steps.searchShelf = await evaluate(main, `({ results: document.querySelector('[data-akari-shape-search-results]')?.getAttribute('data-akari-shape-search-results'),
    tiles: [...document.querySelectorAll('[data-akari-shape-shelf] [data-akari-shape-tile]')].map(t => t.title) })`);
  await shotPanel(main, 'after-search-shelf-dark.png');
  await setSearch(main, '');
  await sleep(500);
  for (let attempt = 0; attempt < 5; attempt++) {
    await clickSelector(main, '[data-akari-library-back]').catch(() => undefined);
    if (await waitFor(main, `Boolean(document.querySelector('[data-akari-library-primary-tile="shapes"]'))`, 5000)) break;
  }
  await setSearch(main, '星');
  await sleep(800);
  report.steps.searchHome = await evaluate(main, `({ total: Number(document.querySelector('[data-akari-library-home]')?.getAttribute('data-akari-library-search-results')),
    shapes: [...document.querySelectorAll('[data-akari-library-search-kind="shape"]')].map(n => n.textContent) })`);
  await shotPanel(main, 'after-search-home-dark.png', '[data-akari-library-home]');
  await setSearch(main, '');

  // 11. 書き出しとの比較用にプレビューを撮る
  // 選択の枠（つまみ）はプレビューだけに出るので、外してから撮る
  report.steps.clearSelection = await executeCommand(main, 'akari.timeline.clearSelection');
  await sleep(800);
  const times = [1.5, 12.5];
  if (droppedHeart) times.push(+(droppedHeart.at / 30 + 0.5).toFixed(2));
  for (const t of times) {
    await seek(main, t);
    await sleep(1200);
    const name = `compare-preview-${String(t).replace('.', '_')}s.png`;
    await shotStage(main, name);
    compareTimes.push({ t, preview: name });
  }
  report.consoleErrors = [...new Set(shell.consoleErrors.map(scrub))].filter(line => /shape|図形|TypeError|library/i.test(line)).slice(-10);
} catch (error) {
  report.error = scrub(error?.stack ?? error);
} finally {
  await shell?.stop();
  await sleep(800);
}

// 12. 書き出し（render-cut --engine auto）→ 同じ時刻のフレームをプレビューの寸法に縮めて SSIM
try {
  const finalEdit = await readEdit();
  report.finalShapes = shapeItems(finalEdit).map(summarize);
  await writeFile(out('after-edit.json'), `${JSON.stringify(finalEdit, null, 2)}\n`);
  // render-cut は書き出し先をプロジェクトの中に限る。
  await mkdir(path.join(dirs.project, 'exports'), { recursive: true });
  const video = path.join(dirs.project, 'exports', 'export.mp4');
  let exportLog = '';
  try {
    exportLog = execFileSync('node', [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), dirs.project, '--engine', 'auto',
      '--out', video, '--force'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    report.exportExit = 0;
  } catch (error) {
    report.exportExit = error.status ?? 'error';
    exportLog = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  }
  await writeFile(out('export-log.txt'), scrub(exportLog).split('\n').filter(line => line && !line.startsWith('PROGRESS')).slice(-30).join('\n') + '\n');
  report.compare = [];
  for (const entry of compareTimes) {
    const frame = out(`compare-export-${String(entry.t).replace('.', '_')}s.png`);
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(entry.t), '-i', video, '-frames:v', '1', frame]);
      const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out(entry.preview)], { encoding: 'utf8' }).trim();
      const [w, h] = probe.split(',').map(Number);
      const ssim = spawnSync('ffmpeg', ['-hide_banner', '-i', out(entry.preview), '-i', frame, '-lavfi',
        `[1:v]scale=${w}:${h}:flags=area,format=rgb24[b];[0:v]format=rgb24[a];[a][b]ssim`, '-f', 'null', '-'], { encoding: 'utf8' });
      report.compare.push({ ...entry, export: path.basename(frame), ssim: `${ssim.stderr}`.match(/All:([\d.]+)/)?.[1] });
    } catch (error) {
      const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      const all = text.match(/All:([\d.]+)/)?.[1];
      report.compare.push({ ...entry, export: path.basename(frame), ...(all ? { ssim: all } : { error: scrub(text).slice(-300) }) });
    }
  }
} catch (error) {
  report.exportError = scrub(error?.stack ?? error);
}
await dirs.dispose();
await writeFile(out('after.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
