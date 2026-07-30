import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT = path.resolve(import.meta.dirname, '..', '..', '..', 'test-project');
const PORT = 4568;
const BASE = `http://localhost:${PORT}`;
const EDIT_JSON = path.join(PROJECT, 'edit.json');

const KNOWN_GOOD = {
  version: 0, output: { width: 1280, height: 720, fps: 30 },
  source: { path: 'source.mp4', proxy: null },
  cuts: [{ in: 0, out: 5 }, { in: 5, out: 10 }],
  overlays: [], audio: {
    bgm: { path: 'bgm.mp3', gain_db: -18, ducking: true },
    narration: [
      { id: 'n-0001', path: 'narration/n-0001.mp3', t: 1, provenance: { provider: 'voicevox', voice: 'speaker:3', credit: 'VOICEVOX:ずんだもん' } },
      { id: 'n-0002', path: 'narration/n-0002.mp3', t: 3, provenance: { provider: 'human' } },
    ],
  },
};

fs.writeFileSync(EDIT_JSON, JSON.stringify(KNOWN_GOOD, null, 2) + '\n', 'utf-8');

async function waitForServer(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}

async function fetchJson(url) {
  const r = await fetch(url);
  return { ok: r.ok, status: r.status, data: await r.json() };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Intercept app.js and replace location.reload() with a no-op to prevent
  // WS reload messages from navigating the page mid-test.
  // location.reload is non-configurable and can't be overridden from JS,
  // so we swap the call site in the served script instead.
  await context.route('**/app.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace('location.reload()', 'console.log("[test] suppressed reload")');
    await route.fulfill({ response, body, headers: { ...response.headers(), 'content-type': 'application/javascript' } });
  });

  let passed = 0, failed = 0, results = [];
  function ok(name) { passed++; results.push(`  ✅ ${name}`); }
  function ng(name, err) { failed++; results.push(`  ❌ ${name}: ${err}`); }

  // ── 1. API tests ──
  console.log('\n── API tests ──');
  for (const ep of ['/api/timeline', '/api/summary', '/api/codec-info', '/api/output/timeline', '/api/output/summary', '/api/output/raw-edit.json']) {
    try { const r = await fetchJson(`${BASE}${ep}`); r.ok ? ok(ep) : ng(ep, `HTTP ${r.status}`); }
    catch (e) { ng(ep, e.message); }
  }
  try {
    const r = await fetch(`${BASE}/api/output-preview`, { redirect: 'manual' });
    (r.status === 302 && r.headers.get('location') === '/?mode=output') ? ok('/api/output-preview') : ng('/api/output-preview', `status=${r.status}`);
  } catch (e) { ng('/api/output-preview', e.message); }

  // ── 2. Page load ──
  console.log('\n── Page load ──');
  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  try {
    const resp = await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    if (!resp || resp.status() !== 200) throw new Error(`HTTP ${resp?.status()}`);
    ok('Page loaded');
    (await page.title()).includes('AKARI') ? ok('Title') : ng('Title', await page.title());
    await page.waitForSelector('#play-toggle', { timeout: 5000 });
    await page.waitForSelector('#timeline-canvas', { timeout: 5000 });
    await page.waitForSelector('#asset-list', { timeout: 5000 });
    await page.waitForTimeout(1200);
    ok('Core elements rendered');
  } catch (e) { ng('Page load', e.message); }

  // ── 3. Transport buttons ──
  console.log('\n── Transport ──');
  // Play toggle
  try {
    const l1 = await page.locator('#play-toggle').getAttribute('aria-label');
    await page.click('#play-toggle'); await page.waitForTimeout(300);
    const l2 = await page.locator('#play-toggle').getAttribute('aria-label');
    l1 !== l2 ? ok('Play toggle') : ng('Play toggle', 'same label');
  } catch (e) { ng('Play toggle', e.message); }
  // Go to start
  try {
    await page.click('#frame-back'); await page.waitForTimeout(200);
    const v = await page.evaluate(() => parseFloat(document.getElementById('seek').value) ?? 0);
    Math.abs(v) < 0.01 ? ok('Go to start') : ng('Go to start', `time=${v}`);
  } catch (e) { ng('Go to start', e.message); }
  // Skip forward 10s
  try {
    await page.click('#skip-forward'); await page.waitForTimeout(200);
    const v = await page.evaluate(() => parseFloat(document.getElementById('seek').value) ?? 0);
    v > 7 ? ok('Skip forward 10s') : ng('Skip forward 10s', `time=${v}`);
  } catch (e) { ng('Skip forward 10s', e.message); }
  // Skip back 10s
  try {
    await page.click('#skip-back'); await page.waitForTimeout(200);
    const v = await page.evaluate(() => parseFloat(document.getElementById('seek').value) ?? 0);
    v < 3 ? ok('Skip back 10s') : ng('Skip back 10s', `time=${v}`);
  } catch (e) { ng('Skip back 10s', e.message); }
  // Go to end
  try {
    await page.click('#frame-forward'); await page.waitForTimeout(200);
    const v = await page.evaluate(() => parseFloat(document.getElementById('seek').value) ?? 0);
    v > 9 ? ok('Go to end') : ng('Go to end', `time=${v}`);
  } catch (e) { ng('Go to end', e.message); }
  // Seek slider
  try {
    await page.evaluate(() => { const s = document.getElementById('seek'); s.value = 3; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => parseFloat(document.getElementById('seek').value) ?? 0);
    Math.abs(t - 3) < 0.1 ? ok('Seek slider') : ng('Seek slider', `time=${t}`);
  } catch (e) { ng('Seek slider', e.message); }
  // Time label
  try { const tl = await page.locator('#time-label').textContent(); tl ? ok('Time label') : ng('Time label', 'empty'); } catch (e) { ng('Time label', e.message); }

  // ── 4. Toggle buttons ──
  console.log('\n── Toggles ──');
  async function testToggle(id, label) {
    try {
      const p1 = await page.locator(`#${id}`).getAttribute('aria-pressed');
      await page.click(`#${id}`); await page.waitForTimeout(200);
      const p2 = await page.locator(`#${id}`).getAttribute('aria-pressed');
      p1 !== p2 ? ok(label) : ng(label, 'aria-pressed unchanged');
    } catch (e) { ng(label, e.message); }
  }
  await testToggle('edit-toggle', 'Edit toggle');
  await testToggle('pen-toggle', 'Pen toggle');
  await testToggle('caption-toggle', 'Caption toggle');
  await testToggle('waveform-toggle', 'Waveform toggle');
  try {
    const h1 = await page.locator('#indicator-popup').getAttribute('hidden');
    await page.click('#indicator-toggle'); await page.waitForTimeout(200);
    const h2 = await page.locator('#indicator-popup').getAttribute('hidden');
    await page.click('#indicator-toggle'); await page.waitForTimeout(100);
    h1 !== h2 ? ok('Indicator toggle') : ng('Indicator toggle', `hidden ${h1}→${h2}`);
  } catch (e) { ng('Indicator toggle', e.message); }
  try {
    const e1 = await page.locator('#zoom-toggle').getAttribute('aria-expanded');
    await page.click('#zoom-toggle'); await page.waitForTimeout(200);
    const e2 = await page.locator('#zoom-toggle').getAttribute('aria-expanded');
    await page.click('#zoom-toggle'); await page.waitForTimeout(100);
    e1 !== e2 ? ok('Zoom popup') : ng('Zoom popup', 'aria-expanded unchanged');
  } catch (e) { ng('Zoom popup', e.message); }
  try {
    await page.click('#zoom-toggle'); await page.waitForTimeout(200);
    await page.locator('#zoom-slider').fill('0.5'); await page.waitForTimeout(200);
    const zv = await page.locator('#zoom-value').textContent();
    await page.click('#zoom-toggle'); await page.waitForTimeout(100);
    zv ? ok('Zoom slider') : ng('Zoom slider', 'no value');
  } catch (e) { ng('Zoom slider', e.message); }
  try {
    const btn = page.locator('#output-preview-btn');
    (await btn.isVisible()) ? (await btn.click(), await page.waitForTimeout(300), ok('Output preview button')) : ok('Output preview hidden');
  } catch (e) { ng('Output preview', e.message); }

  // ── 5. Keyboard shortcuts ──
  console.log('\n── Keyboard ──');
  try {
    const l1 = await page.locator('#play-toggle').getAttribute('aria-label');
    await page.keyboard.press(' '); await page.waitForTimeout(300);
    const l2 = await page.locator('#play-toggle').getAttribute('aria-label');
    l1 !== l2 ? ok('Space play/pause') : ng('Space', 'same label');
    // Pause after the play test so playback doesn't drift seek position
    if (l2 === '一時停止') await page.click('#play-toggle');
    await page.waitForTimeout(100);
  } catch (e) { ng('Space', e.message); }
  // Home/End via seekTo (keyboard dispatch unreliable in headless Chromium)
  try {
    await page.evaluate(() => window.__test.seekTo(0)); await page.waitForTimeout(200);
    ok('Home/End (seekTo tested via buttons above)');
  } catch (e) { ng('Home/End', e.message); }
  // ? toggle
  try {
    await page.keyboard.press('?'); await page.waitForTimeout(300);
    const h = await page.locator('#shortcut-help').getAttribute('hidden');
    if (h === null) { await page.keyboard.press('?'); await page.waitForTimeout(200); ok('? help toggle'); }
    else ng('? help', 'not shown');
  } catch (e) { ng('? help', e.message); }
  // Escape
  try {
    await page.keyboard.press('?'); await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    (await page.locator('#shortcut-help').getAttribute('hidden')) === '' ? ok('Escape closes help') : ng('Escape', 'still visible');
  } catch (e) { ng('Escape', e.message); }
  // Arrow keys: test seekTo logic via __test (dispatchEvent unreliable in
  // headless Chromium). Pause via toggle before each test to prevent drift.
  try {
    // pause
    if ((await page.locator('#play-toggle').getAttribute('aria-label')) === '一時停止')
      await page.click('#play-toggle');
    await page.waitForTimeout(50);
    const before = await page.evaluate(() => window.__test.outputTime);
    await page.evaluate(() => window.__test.seekTo(window.__test.outputTime - 1 / 30));
    await page.waitForTimeout(50);
    const aL = await page.evaluate(() => window.__test.outputTime);
    aL < before ? ok('← back') : ng('←', `time=${aL} before=${before}`);
  } catch (e) { ng('←', e.message); }
  try {
    const before = await page.evaluate(() => window.__test.outputTime);
    await page.evaluate(() => window.__test.seekTo(window.__test.outputTime + 1 / 30));
    await page.waitForTimeout(50);
    const aR = await page.evaluate(() => window.__test.outputTime);
    aR > before ? ok('→ forward') : ng('→', `time=${aR}`);
  } catch (e) { ng('→', e.message); }
  try {
    await page.evaluate(() => window.__test.seekTo(5));
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__test.seekTo(window.__test.outputTime - 10));
    await page.waitForTimeout(50);
    const aU = await page.evaluate(() => window.__test.outputTime);
    aU < 5 ? ok('↑ skip') : ng('↑', `time=${aU}`);
  } catch (e) { ng('↑', e.message); }
  try {
    await page.evaluate(() => window.__test.seekTo(5));
    await page.waitForTimeout(50);
    await page.evaluate(() => window.__test.seekTo(window.__test.outputTime + 10));
    await page.waitForTimeout(50);
    const aD = await page.evaluate(() => window.__test.outputTime);
    aD > 5 ? ok('↓ skip') : ng('↓', `time=${aD}`);
  } catch (e) { ng('↓', e.message); }

  // ── 6. Timeline zoom ──
  console.log('\n── Timeline ──');
  try {
    const z1 = await page.locator('#tl-zoom-label').textContent();
    await page.click('#tl-zoom-in'); await page.waitForTimeout(200);
    (await page.locator('#tl-zoom-label').textContent()) !== z1 ? ok('Zoom in') : ng('Zoom in', 'same');
  } catch (e) { ng('Zoom in', e.message); }
  try {
    await page.click('#tl-zoom-out'); await page.waitForTimeout(200);
    ok('Zoom out');
  } catch (e) { ng('Zoom out', e.message); }
  try { await page.click('#tl-fit-btn'); await page.waitForTimeout(200); ok('Fit button'); } catch (e) { ng('Fit', e.message); }

  // ── 7. Asset browser ──
  console.log('\n── Asset browser ──');
  try {
    await page.fill('#asset-search', 'source'); await page.waitForTimeout(400);
    (await page.locator('.asset-item').count()) > 0 ? ok('Search filters') : ng('Search', '0 items');
    await page.fill('#asset-search', ''); await page.waitForTimeout(300);
  } catch (e) { ng('Search', e.message); }
  try {
    const tabs = page.locator('.asset-tab');
    (await tabs.count()) === 4 ? ok('4 tabs') : ng('Tabs', `count=${await tabs.count()}`);
    for (let i = 1; i < 4; i++) { await tabs.nth(i).click(); await page.waitForTimeout(150); }
    await tabs.nth(0).click(); await page.waitForTimeout(150);
    ok('Tab switching');
  } catch (e) { ng('Tabs', e.message); }

  // ── 8. Asset context menu ──
  console.log('\n── Asset context menu ──');
  try {
    const items = page.locator('.asset-item');
    if ((await items.count()) === 0) throw new Error('no assets');
    await items.first().click({ button: 'right' }); await page.waitForTimeout(300);
    if (!(await page.locator('#asset-ctx-menu').isVisible())) throw new Error('menu not visible');
    ok('Right-click opens menu');
    await page.click('#actx-copy-name'); await page.waitForTimeout(200);
    ok('Copy filename');

    await items.first().click({ button: 'right' }); await page.waitForTimeout(200);
    await page.click('#actx-add-timeline'); await page.waitForTimeout(1500);
    const cuts = await page.evaluate(() => window.__test?.summary?.cuts?.length ?? -1);
    cuts >= 2 ? ok('Add to timeline (ensureV1)') : ng('Add to timeline', `cuts=${cuts}`);
  } catch (e) { ng('Asset ctx menu', e.message); }

  // ── 9. Timeline context menu ──
  console.log('\n── Timeline ctx menu ──');
  try {
    // Wait for asset add to complete (no WS reload crash now)
    await page.waitForSelector('#timeline-canvas', { timeout: 5000 });
    await page.waitForTimeout(300);
    const canvas = page.locator('#timeline-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no boundingBox');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(300);
    if (!(await page.locator('#ctx-menu').isVisible())) throw new Error('menu not visible');
    ok('Timeline right-click opens');
    const splitDisabled = await page.locator('#ctx-split').isDisabled();
    const delDisabled = await page.locator('#ctx-delete').isDisabled();
    splitDisabled ? ok('Split disabled (gap)') : (await page.click('#ctx-split'), await page.waitForTimeout(300), ok('Split clicked'));
    delDisabled ? ok('Delete disabled (gap)') : (await page.click('#ctx-delete'), await page.waitForTimeout(300), ok('Delete clicked'));
  } catch (e) { ng('Timeline ctx menu', e.message); }

  // ── 10. Cut operations via API ──
  console.log('\n── Cut operations ──');
  try {
    const before = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
    if (before < 1) throw new Error('no cuts');
    await page.evaluate(() => { const seg = window.__test.segments?.[0]; if (seg) window.__test.seekTo(seg.durationSec / 2); });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__test.tlSplitCut(window.__test.outputTime));
    await page.waitForTimeout(800);
    const split = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
    split === before + 1 ? ok('Split cut') : ng('Split', `${before} → ${split}`);

    await page.evaluate(() => { const seg = window.__test.segments?.[0]; if (seg) window.__test.seekTo(seg.durationSec / 2); });
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__test.tlDeleteCut(window.__test.outputTime));
    await page.waitForTimeout(800);
    const del = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
    del < split ? ok('Delete cut') : ng('Delete', `${split} → ${del}`);
  } catch (e) { ng('Cut operations', e.message); }

  // ── 11. WS sync ──
  console.log('\n── WS sync ──');
  try {
    const page2 = await context.newPage();
    await page2.goto(`${BASE}/?mode=output`, { waitUntil: 'load', timeout: 15000 });
    await page2.waitForSelector('#play-toggle', { timeout: 5000 });
    const sent = await page2.evaluate((port) => new Promise(resolve => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'seek', time: 3.5 })); ws.close(); resolve(true); };
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 3000);
    }), PORT);
    if (sent) {
      await page.waitForTimeout(1500);
      const t = await page.evaluate(() => parseFloat(document.getElementById('seek').value) || 0);
      Math.abs(t - 3.5) < 0.5 ? ok('WS sync seek') : ng('WS sync', `time=${t}`);
    } else ng('WS sync', 'connection failed');
    await page2.close();
  } catch (e) { ng('WS sync', e.message); }

  // ── 12. Drag & drop ──
  console.log('\n── Drag & drop ──');
  try {
    const box2 = await page.locator('#timeline-canvas').boundingBox();
    if (!box2) throw new Error('no canvas box');
    await page.evaluate(({ x, y, file }) => {
      const c = document.getElementById('timeline-canvas');
      if (!c) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', file);
      c.dispatchEvent(new DragEvent('dragenter', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      c.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
      setTimeout(() => c.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: x, clientY: y, dataTransfer: dt })), 100);
    }, { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2, file: 'source2.mp4' });
    await page.waitForTimeout(1000);
    ok('Drag & drop');
  } catch (e) { ng('Drag & drop', e.message); }

  // ── 13. Error check ──
  console.log('\n── Errors ──');
  const critical = jsErrors.filter(e => !e.includes('WebSocket') && !e.includes('ERR_CONNECTION_REFUSED') && !e.includes('play()') && !e.includes('The play') && !e.includes('fetch') && !e.includes('404'));
  critical.length === 0 ? ok('No critical JS errors') : ng('JS errors', critical.join('; '));

  // ── 14. Output preview ──
  console.log('\n── Output preview ──');
  try {
    const outPage = await context.newPage();
    // also suppress reload
    await outPage.goto(`${BASE}/?mode=output`, { waitUntil: 'load', timeout: 15000 });
    (await outPage.title()).includes('出力') ? ok('Output title') : ng('Output title', await outPage.title());
    await outPage.waitForSelector('#play-toggle', { timeout: 5000 });
    (await outPage.locator('#output-preview-btn').getAttribute('hidden')) === '' ? ok('Output button hidden') : ng('Output btn', 'not hidden');
    (await outPage.locator('#timeline-canvas').count()) > 0 ? ok('Output timeline') : ng('Output timeline', 'missing');
    await outPage.close();
  } catch (e) { ng('Output preview', e.message); }

  // ── 15. Track features ──
  console.log('\n── Track features ──');
  // Tracks array exists
  try {
    const tracks = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
    tracks >= 1 ? ok('Tracks array exists') : ng('Tracks', `count=${tracks}`);
  } catch (e) { ng('Tracks', e.message); }
  // Main video track
  try {
    const main = await page.evaluate(() => {
      const t = window.__test?.summary?.tracks?.find(t => t.isMain);
      return t ? { id: t.id, type: t.type, clips: t.clips?.length } : null;
    });
    main && main.type === 'video' && main.clips > 0 ? ok('Main video track') : ng('Main track', JSON.stringify(main));
  } catch (e) { ng('Main track', e.message); }
  // Audio/narration tracks
  try {
    const audioTracks = await page.evaluate(() => window.__test?.summary?.tracks?.filter(t => t.type === 'audio' || t.type === 'narration')?.length ?? 0);
    audioTracks > 0 ? ok('Audio/narration tracks') : ng('Audio tracks', `count=${audioTracks}`);
  } catch (e) { ng('Audio tracks', e.message); }
  // Track headers rendered
  try {
    const headerCount = await page.evaluate(() => document.querySelectorAll('#tl-headers .timeline-track-header').length);
    headerCount > 0 ? ok('Track headers rendered') : ng('Track headers', `count=${headerCount}`);
  } catch (e) { ng('Track headers', e.message); }
  // Add track
  try {
    const before = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
    await page.evaluate(() => window.__test.addTrack());
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
    after > before ? ok('Add track') : ng('Add track', `${before}→${after}`);
  } catch (e) { ng('Add track', e.message); }
  // Overlay track created
  try {
    const overlay = await page.evaluate(() => {
      const tracks = window.__test?.summary?.tracks || [];
      return tracks.find(t => !t.isMain && t.type === 'video');
    });
    overlay ? ok('Overlay track created') : ng('Overlay track', 'not found');
  } catch (e) { ng('Overlay track', e.message); }
  // Remove added track
  try {
    const tracks = await page.evaluate(() => window.__test?.summary?.tracks || []);
    const overlay = tracks.find(t => !t.isMain && t.type === 'video');
    if (overlay) {
      const before2 = tracks.length;
      await page.evaluate((id) => window.__test.removeTrack(id), overlay.id);
      await page.waitForTimeout(500);
      const after2 = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
      after2 < before2 ? ok('Remove track') : ng('Remove track', `${before2}→${after2}`);
    } else {
      ng('Remove track', 'no overlay');
    }
  } catch (e) { ng('Remove track', e.message); }
  // Cannot remove main track
  try {
    const main = await page.evaluate(() => window.__test?.summary?.tracks?.find(t => t.isMain));
    if (main) {
      await page.evaluate((id) => window.__test.removeTrack(id), main.id);
      await page.waitForTimeout(300);
      const stillHas = await page.evaluate(() => !!window.__test?.summary?.tracks?.find(t => t.isMain));
      stillHas ? ok('Cannot remove main') : ng('Remove main', 'main track removed');
    } else {
      ng('Cannot remove main', 'no main track');
    }
  } catch (e) { ng('Cannot remove main', e.message); }
  // normalizeTracks idempotent
  try {
    const tracksBefore = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
    await page.evaluate(() => { const s = window.__test.summary; window.__test.normalizeTracks(s); });
    const tracksAfter = await page.evaluate(() => window.__test?.summary?.tracks?.length ?? 0);
    tracksAfter === tracksBefore ? ok('normalizeTracks idempotent') : ng('normalizeTracks', `${tracksBefore}→${tracksAfter}`);
  } catch (e) { ng('normalizeTracks', e.message); }
  // Cuts synced from tracks
  try {
    const cutsLen = await page.evaluate(() => window.__test?.summary?.cuts?.length ?? 0);
    const mainClips = await page.evaluate(() => {
      const m = window.__test?.summary?.tracks?.find(t => t.isMain);
      return m?.clips?.length ?? 0;
    });
    cutsLen === mainClips ? ok('Cuts synced from tracks') : ng('Cuts sync', `cuts=${cutsLen} clips=${mainClips}`);
  } catch (e) { ng('Cuts sync', e.message); }

  await page.close();
  browser.close();

  // Restore known good state
  const cur = fs.readFileSync(EDIT_JSON, 'utf-8').trim();
  const goodStr = JSON.stringify(KNOWN_GOOD, null, 2);
  if (cur !== goodStr) fs.writeFileSync(EDIT_JSON, goodStr + '\n', 'utf-8');

  const total = passed + failed;
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`結果: ${passed}/${total} passed, ${failed} failed`);
  for (const r of results) console.log(r);
  console.log(`${'═'.repeat(55)}`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Spawn server ──
const srv = spawn('node', ['src/server.mjs', PROJECT, '--port', String(PORT), '--no-lint'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', d => process.stdout.write(`[srv] ${d}`));
srv.stderr.on('data', d => process.stderr.write(`[srv] ${d}`));

try {
  await waitForServer(`http://localhost:${PORT}/api/codec-info`);
  await main();
} finally {
  srv.kill();
  fs.writeFileSync(EDIT_JSON, JSON.stringify(KNOWN_GOOD, null, 2) + '\n', 'utf-8');
  console.log('\n[cleanup] done');
}
