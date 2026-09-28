// L1 probe (#100): browser preview picks up a rebuilt 3D asset without touching edit.json.
// usage: node l1-probe.mjs <repoRoot> <label> <outDir> [port]
// Builds an isolated project (1 3D fragment + 1 glb), starts preview-server, drives Edge headless.
// Steps: (1) glb missing -> failure visible? (2) glb restored -> red plane drawn within timeout?
//        (3) glb swapped to green -> new look within timeout?
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const [repoRoot, label, outDir, portArg] = process.argv.slice(2);
const port = Number(portArg || 38731);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FIX = path.resolve(HERE, '../fixture-src');
const proj = path.resolve(HERE, `../proj-${label}`);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const WAIT_MS = 8000;
fs.mkdirSync(outDir, { recursive: true });

// --- isolated project ---
fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(path.join(proj, 'overlays'), { recursive: true });
fs.mkdirSync(path.join(proj, 'assets/models'), { recursive: true });
fs.writeFileSync(path.join(proj, 'edit.json'), JSON.stringify({
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [],
  tracks: [{ id: 'scene', lane: 'visual', items: [{ id: 's3d', at: 0, duration: 300, source: { kind: 'html', path: 'overlays/s3d.html' } }] }],
}, null, 2));
fs.writeFileSync(path.join(proj, 'overlays/s3d.html'),
  '<div style="position:absolute;inset:0;background:#162338"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>'
  + '<script type="application/json" data-akari-3d-scene>{"model":"assets/models/probe.glb","camera":{"position":[0,0,3],"lookAt":[0,0,0]}}</script></div>\n');
const glb = path.join(proj, 'assets/models/probe.glb');
// step 1 precondition: glb is parked under another name
const CONTROL = process.env.P3D_CONTROL === '1';
const CONTROL_GLB = process.env.P3D_CONTROL_GLB || 'red';
fs.copyFileSync(path.join(FIX, CONTROL ? `${CONTROL_GLB}.glb` : 'red.glb'), CONTROL ? glb : glb + '.parked');

const require = createRequire(path.join(repoRoot, 'packages/render-cut/'));
const puppeteer = require('puppeteer-core');

const server = spawn(process.execPath, [path.join(repoRoot, 'packages/preview-server/src/server.mjs'), proj, '--port', String(port), '--no-lint'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
const results = { label, steps: {} };
const flush = () => fs.writeFileSync(path.join(outDir, `${label}-results.json`), JSON.stringify(results, null, 2));
const t00 = Date.now(); const stamp = (m) => console.log(`[${Date.now() - t00}ms] ${m}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('server did not start');
}

async function sample(page) {
  // center pixel of the 3D canvas, read back from a real screenshot (independent of preserveDrawingBuffer)
  const rect = await page.evaluate(() => {
    const c = document.querySelector('[data-overlay-id="s3d"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!rect || rect.w < 4 || rect.h < 4) return { rect, rgb: null };
  const clip = { x: Math.round(rect.x + rect.w / 2) - 2, y: Math.round(rect.y + rect.h / 2) - 2, width: 4, height: 4 };
  const b64 = await page.screenshot({ clip, encoding: 'base64', type: 'png' });
  const rgb = await page.evaluate(async (data) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(1, 1, 1, 1).data; return [d[0], d[1], d[2]];
  }, b64);
  return { rect, rgb };
}
const isRed = rgb => rgb && rgb[0] > 150 && rgb[1] < 90 && rgb[2] < 90;
// green (0,1,0) unlit comes out tone-mapped as about (147,228,89) — calibrated by the green control run
const isGreen = rgb => rgb && rgb[1] > 150 && rgb[1] > rgb[0] + 50 && rgb[1] > rgb[2] + 50;

async function failureText(page) {
  return page.evaluate(() => {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        const t = (el.textContent || '').trim();
        if (!/3D/.test(t) || !/読み込め/.test(t)) continue;
        if (el.children.length && [...el.children].some(ch => /読み込め/.test(ch.textContent || ''))) continue;
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0 || el.hidden) continue;
        out.push(t.slice(0, 120));
      }
    };
    walk(document);
    return out;
  });
}

async function pollFor(page, pred, ms) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) {
    last = await sample(page);
    if (pred(last.rgb)) return { ok: true, ms: Date.now() - t0, rgb: last.rgb };
    await sleep(250);
  }
  return { ok: false, ms: Date.now() - t0, rgb: last?.rgb ?? null };
}

let browser;
try {
  await waitServer();
  browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1600,1000'] , defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const consoleLines = [];
  page.on('console', m => { const t = m.text(); if (/three|3D|reload|glb/i.test(t)) consoleLines.push(t.slice(0, 200)); });
  page.on('pageerror', e => consoleLines.push('pageerror: ' + String(e.message).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('[data-overlay-id="s3d"]', { timeout: 20000 });
  stamp("mounted"); await sleep(3000); stamp("sampling");

  // step 1: glb missing
  const s1 = await sample(page);
  const texts = await failureText(page);
  results.steps.missing = { failureVisible: texts.length > 0, texts, rgb: s1.rgb, notRed: !isRed(s1.rgb) };
  await page.screenshot({ path: path.join(outDir, `${label}-1-missing.png`) });

  flush();
  if (CONTROL) { const c = await pollFor(page, CONTROL_GLB === 'green' ? isGreen : isRed, WAIT_MS); results.steps.control = c; flush(); throw new Error('control-only run'); }
  // step 2: restore glb (edit.json untouched)
  fs.renameSync(glb + '.parked', glb);
  const r2 = await pollFor(page, isRed, WAIT_MS);
  results.steps.restored = { drawn: r2.ok, withinMs: r2.ms, rgb: r2.rgb, failureTextsAfter: await failureText(page) };
  await page.screenshot({ path: path.join(outDir, `${label}-2-restored.png`) });
  flush();

  // step 3: swap to a differently-looking glb
  fs.copyFileSync(path.join(FIX, 'green.glb'), glb);
  const r3 = await pollFor(page, isGreen, WAIT_MS);
  results.steps.swapped = { newLook: r3.ok, withinMs: r3.ms, rgb: r3.rgb };
  await page.screenshot({ path: path.join(outDir, `${label}-3-swapped.png`) });

  results.editJsonUntouched = true;
  results.console = consoleLines.slice(0, 40);
} catch (error) {
  results.error = String(error?.stack || error);
} finally {
  stamp('closing');
  await Promise.race([browser?.close().catch(() => {}), sleep(5000)]);
  server.kill();
  results.serverLog = serverLog.split('\n').filter(l => /watch|reload|error/i.test(l)).slice(0, 20).map(l => l.replace(/[A-Za-z]:[\\/][^\s]*/g, '<path>'));
  fs.writeFileSync(path.join(outDir, `${label}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ label, steps: results.steps, error: results.error }, null, 2));
  process.exit(0);
}
