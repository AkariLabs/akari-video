#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../../src/browser/akari-preview-open-handler.ts');
const interactionPath = path.resolve(here, '../../../../../../packages/overlay-runtime/src/interaction.js');
const interactionCssPath = path.resolve(here, '../../../../../../packages/overlay-runtime/src/interaction.css');
const evidenceDir = process.argv[2] || path.join(tmpdir(), 'akari-preview-zoom-evidence');
const results = { assertions: [] };

async function resolveChromePath() {
  if (process.env.AKARI_CHROME_PATH) return process.env.AKARI_CHROME_PATH;
  const playwrightCache = path.join(homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const entries = (await readdir(playwrightCache)).filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const entry of entries) {
      const candidates = [
        path.join(playwrightCache, entry, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(playwrightCache, entry, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(playwrightCache, entry, 'chrome-mac', 'headless_shell')
      ];
      for (const candidate of candidates) {
        try {
          if ((await stat(candidate)).isFile()) return candidate;
        } catch { /* try the next Playwright cache layout */ }
      }
    }
  } catch { /* fall through to the system browser */ }
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function assert(condition, message, detail = {}) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
  results.assertions.push({ message, ...detail });
}

function cssRule(source, selector) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`CSS rule not found: ${selector}`);
  const end = source.indexOf('\n', start);
  return source.slice(start, end).replaceAll('${width}', '1280').replaceAll('${height}', '720');
}

function zoomSource(source) {
  const start = source.indexOf('            const zoomToSlider = value => {');
  const end = source.indexOf('            const formatTime = value => {', start);
  if (start < 0 || end < 0) throw new Error('zoom implementation source not found');
  return source.slice(start, end) + `
    window.__zoomHarness = {
      setZoom,
      setPan(value) { pan = clampPan(value); renderZoom(); },
      state() { return { zoom, pan: { ...pan }, limits: panLimits() }; }
    };
  `;
}

async function samplePixels(imagePath, points) {
  const code = [
    'import json,sys',
    'from PIL import Image',
    'im=Image.open(sys.argv[1]).convert("RGBA")',
    'pts=json.loads(sys.argv[2])',
    'print(json.dumps({k:list(im.getpixel((round(v[0]),round(v[1])))) for k,v in pts.items()}))'
  ].join(';');
  const { stdout } = await execFileAsync('/usr/bin/python3', ['-c', code, imagePath, JSON.stringify(points)]);
  return JSON.parse(stdout);
}

const source = await readFile(sourcePath, 'utf8');
const interactionJs = await readFile(interactionPath, 'utf8');
const interactionCss = await readFile(interactionCssPath, 'utf8');
const css = [
  ':root{--akari-preview-pasteboard:#2b2d30}',
  '*{box-sizing:border-box}',
  'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#141414}',
  '.workspace{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);width:100%;height:100%}',
  cssRule(source, '.preview-pane'),
  '.preview-pane{width:100%;height:100%}',
  cssRule(source, '#preview-wrapper'),
  cssRule(source, '.preview-pane.is-draggable'),
  cssRule(source, '.preview-pane.is-dragging'),
  cssRule(source, '#zoom-layer'),
  cssRule(source, '#preview-stage'),
  cssRule(source, '#zoom-minimap'),
  cssRule(source, '#zoom-minimap[hidden]'),
  cssRule(source, '#zoom-minimap-viewport'),
  '#preview-layers{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0;overflow:hidden}',
  '#overlay-stage{position:absolute;left:0;top:0;width:1280px;height:720px;overflow:hidden}',
  '[data-overlay-id]{position:absolute;inset:0;--x:120px;--y:100px;--scale:1;--rotate:0deg;transform:translate(var(--x),var(--y)) scale(var(--scale)) rotate(var(--rotate));transform-origin:50% 50%}',
  '[data-akari-fragment]{position:absolute;left:80px;top:80px;width:360px;height:120px;display:grid;place-items:center;background:#ffcc00;color:#111;font:700 36px system-ui}',
  interactionCss
].join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<main class="workspace"><section class="preview-pane"><div id="preview-wrapper"><div id="zoom-layer"><div id="preview-stage">
<div id="preview-layers"><div id="overlay-stage"><div data-overlay-id="cap-a"><div data-akari-fragment>DIRECT EDIT</div></div></div></div>
</div></div></div><div id="zoom-minimap" hidden><div id="zoom-minimap-viewport"></div></div></section></main>
<input id="zoom-slider" type="range"><span id="zoom-value"></span>
<script>
window.akari={state:{editPath:'fixture/edit.json'},stageScale:()=>window.__frameScale||1,engine:{
  overlayWrite:async(...args)=>{(window.__writes||(window.__writes=[])).push(args)},
  overlayHtmlWrite:async(...args)=>{(window.__htmlWrites||(window.__htmlWrites=[])).push(args)}
}};
</script><script>${interactionJs.replaceAll('</script', '<\\/script')}</script><script>
const summary={output:{width:1280,height:720}};
const previewPane=document.querySelector('.preview-pane');
const wrapper=document.getElementById('preview-wrapper');
const zoomLayer=document.getElementById('zoom-layer');
const previewStage=document.getElementById('preview-stage');
const zoomSlider=document.getElementById('zoom-slider');
const zoomValue=document.getElementById('zoom-value');
const zoomMinimap=document.getElementById('zoom-minimap');
const zoomMinimapViewport=document.getElementById('zoom-minimap-viewport');
const ZOOM_MIN=0.25,ZOOM_MAX=8,SNAP_TOLERANCE=0.025;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
let zoom=1,pan={x:0,y:0};
${zoomSource(source)}
function layoutStage(){
  window.__frameScale=previewStage.getBoundingClientRect().width/(1280*window.__zoomHarness.state().zoom);
  document.getElementById('preview-layers').style.transform='scale('+window.__frameScale+')';
}
new ResizeObserver(layoutStage).observe(previewStage);layoutStage();window.__zoomHarness.setZoom(1);
</script></body></html>`;

await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, 'harness.html'), html);
const chromePath = await resolveChromePath();
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  pipe: true,
  args: ['--no-sandbox', '--disable-gpu', '--single-process', '--no-zygote']
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 640, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__frameScale > 0);

  const stateFor = zoom => page.evaluate(value => {
    window.__zoomHarness.setZoom(value);
    const plain = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
    const pane = document.querySelector('.preview-pane');
    const stage = document.getElementById('preview-stage');
    const minimap = document.getElementById('zoom-minimap');
    const viewport = document.getElementById('zoom-minimap-viewport');
    return {
      pane: plain(pane.getBoundingClientRect()), stage: plain(stage.getBoundingClientRect()),
      paneBackground: getComputedStyle(pane).backgroundColor,
      stageBackground: getComputedStyle(stage).backgroundColor,
      wrapperBackground: getComputedStyle(document.getElementById('preview-wrapper')).backgroundColor,
      minimap: plain(minimap.getBoundingClientRect()), minimapHidden: minimap.hidden,
      viewport: { left: parseFloat(viewport.style.left), top: parseFloat(viewport.style.top), width: parseFloat(viewport.style.width), height: parseFloat(viewport.style.height) },
      transform: document.getElementById('zoom-layer').style.transform
    };
  }, zoom);

  const z059 = await stateFor(0.59);
  const z059Path = path.join(evidenceDir, 'zoom-059.png');
  await page.screenshot({ path: z059Path });
  const pixels = await samplePixels(z059Path, {
    outside: [z059.pane.left + 4, z059.pane.top + z059.pane.height / 2],
    stage: [z059.stage.left + z059.stage.width / 2, z059.stage.top + z059.stage.height / 2]
  });
  assert(z059.paneBackground === 'rgb(43, 45, 48)' && z059.stageBackground === 'rgb(0, 0, 0)', '59% uses themed pasteboard and black stage only', { z059 });
  assert(pixels.outside.slice(0, 3).every((v, i) => v === [43, 45, 48][i]), '59% outside pixel is #2b2d30 and not #000000', { pixels });
  assert(pixels.stage.slice(0, 3).every(v => v === 0), '59% stage pixel is #000000', { pixels });

  const z100 = await stateFor(1);
  assert(Math.abs(z100.stage.width * 0.59 - z059.stage.width) < 0.5, '100% fit box is unchanged by viewport split', { z059: z059.stage, z100: z100.stage });

  const z200 = await stateFor(2);
  assert(Math.abs(z200.pane.right - z200.minimap.right - 8) < 0.1 && Math.abs(z200.pane.bottom - z200.minimap.bottom - 8) < 0.1,
    'minimap is fixed 8px from pane bottom-right', { z200 });
  const cornerPlans = [
    ['top-left', 1, 1], ['top-right', -1, 1], ['bottom-right', -1, -1], ['bottom-left', 1, -1]
  ];
  const corners = [];
  for (const [name, sx, sy] of cornerPlans) {
    const corner = await page.evaluate(({ sx, sy }) => {
      const limits = window.__zoomHarness.state().limits;
      window.__zoomHarness.setPan({ x: limits.x * sx, y: limits.y * sy });
      const plain = rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
      const pane = plain(document.querySelector('.preview-pane').getBoundingClientRect());
      const stage = plain(document.getElementById('preview-stage').getBoundingClientRect());
      const vp = document.getElementById('zoom-minimap-viewport');
      return { pane, stage, viewport: { left: parseFloat(vp.style.left), top: parseFloat(vp.style.top), width: parseFloat(vp.style.width), height: parseFloat(vp.style.height) } };
    }, { sx, sy });
    assert(Math.abs((sx > 0 ? corner.stage.left - corner.pane.left : corner.stage.right - corner.pane.right)) <= 1,
      `${name} horizontal edge reaches pane edge`, corner);
    assert(Math.abs((sy > 0 ? corner.stage.top - corner.pane.top : corner.stage.bottom - corner.pane.bottom)) <= 1,
      `${name} vertical edge reaches pane edge`, corner);
    corners.push({ name, ...corner });
  }

  const interactionResults = [];
  for (const value of [0.59, 1, 2]) {
    await page.evaluate(zoom => {
      window.__zoomHarness.setZoom(zoom); window.__zoomHarness.setPan({ x: 0, y: 0 });
      const container = document.querySelector('[data-overlay-id]');
      container.style.setProperty('--x', '120px'); container.style.setProperty('--y', '100px');
      container.style.setProperty('--scale', '1'); container.style.setProperty('--rotate', '0deg');
      window.__writes = []; window.__htmlWrites = [];
    }, value);
    const fragment = await page.$('[data-akari-fragment]');
    const before = await fragment.boundingBox();
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    const moved = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-overlay-id]')).getPropertyValue('--x')));
    const displayScale = await page.evaluate(() => document.getElementById('overlay-stage').getBoundingClientRect().width / 1280);
    assert(Math.abs(moved - (120 + 30 / displayScale)) < 0.05, `overlay drag maps client px at zoom ${value}`, { moved, displayScale });

    const nwBefore = await fragment.boundingBox();
    const handle = await page.$('.akari-interaction-handle.is-se');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.down(); await page.mouse.move(handleBox.x + handleBox.width / 2 + 24, handleBox.y + handleBox.height / 2 + 24, { steps: 4 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    const nwAfter = await fragment.boundingBox();
    const scaleAfter = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-overlay-id]')).getPropertyValue('--scale')));
    assert(scaleAfter > 1 && Math.hypot(nwAfter.x - nwBefore.x, nwAfter.y - nwBefore.y) < 1,
      `SE resize keeps opposite corner at zoom ${value}`, { scaleAfter, drift: Math.hypot(nwAfter.x - nwBefore.x, nwAfter.y - nwBefore.y) });

    await page.evaluate(() => {
      const editable = document.querySelector('[data-akari-fragment]');
      const rect = editable.getBoundingClientRect();
      editable.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
    });
    const editing = await page.evaluate(() => document.querySelector('[data-akari-fragment]').getAttribute('contenteditable'));
    assert(editing === 'true', `double click enters text editing at zoom ${value}`, { editing });
    await page.keyboard.press('Escape');
    interactionResults.push({ zoom: value, moved, displayScale, scaleAfter, resizeAnchorDrift: Math.hypot(nwAfter.x - nwBefore.x, nwAfter.y - nwBefore.y) });
  }

  await page.setViewport({ width: 1180, height: 700, deviceScaleFactor: 1 });
  await page.waitForFunction(() => document.querySelector('.preview-pane').clientWidth === 1180);
  const resized = await stateFor(2);
  assert(Math.abs(resized.pane.right - resized.minimap.right - 8) < 0.1 && Math.abs(resized.pane.bottom - resized.minimap.bottom - 8) < 0.1,
    'minimap remains fixed after viewport resize', { resized });
  await page.screenshot({ path: path.join(evidenceDir, 'zoom-200-resized.png') });

  Object.assign(results, { z059, pixels, z100, z200, corners, interactionResults, resized });
  await writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ status: 'PASS', assertions: results.assertions.length, pixels, interactionResults }, null, 2));
} finally {
  await browser.close();
}
