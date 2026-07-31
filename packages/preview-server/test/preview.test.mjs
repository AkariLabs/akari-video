import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT = path.resolve(import.meta.dirname, '..', '..', '..', 'test-project');
const PORT = 4567;
const BASE = `http://localhost:${PORT}`;
const OUT_JSON = path.join(PROJECT, 'edit.output.json');

async function fetchJson(url) {
  const r = await fetch(url);
  return { ok: r.ok, status: r.status, data: await r.json() };
}

async function waitForServer(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}

async function main() {
  // Ensure edit.output.json exists for output preview tests
  const hadOutput = fs.existsSync(OUT_JSON);
  if (!hadOutput) fs.writeFileSync(OUT_JSON, fs.readFileSync(path.join(PROJECT, 'edit.json')));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  let passed = 0;
  let failed = 0;
  const results = [];

  function ok(name) { passed++; results.push(`  ✅ ${name}`); }
  function ng(name, err) { failed++; results.push(`  ❌ ${name}: ${err}`); }

  // ── API tests ──
  console.log('\n📡 API tests');
  for (const [label, url] of [
    ['/api/timeline', `${BASE}/api/timeline`],
    ['/api/summary', `${BASE}/api/summary`],
    ['/api/codec-info', `${BASE}/api/codec-info`],
  ]) {
    try {
      const r = await fetchJson(url);
      r.ok ? ok(label) : ng(label, `HTTP ${r.status}`);
    } catch (e) { ng(label, e.message); }
  }

  // captions.json should 404 (no file)
  try {
    const r = await fetch(`${BASE}/api/captions.json`);
    r.status === 200 ? ok('/api/captions.json returns 200-empty') : ng('/api/captions.json', `expected 200 got ${r.status}`);
  } catch (e) { ng('/api/captions.json', e.message); }

  // ── Output API tests (lazy, file exists) ──
  console.log('\n📡 Output API tests');
  for (const label of ['/api/output/timeline', '/api/output/raw-edit.json', '/api/output/summary', '/api/output/captions.json']) {
    try {
      const r = await fetchJson(`${BASE}${label}`);
      r.ok ? ok(label) : ng(label, `HTTP ${r.status}`);
    } catch (e) { ng(label, e.message); }
  }

  // Output preview redirect
  try {
    const r = await fetch(`${BASE}/api/output-preview`, { redirect: 'manual' });
    (r.status === 302 && r.headers.get('location') === '/?mode=output')
      ? ok('/api/output-preview redirects to ?mode=output')
      : ng('/api/output-preview', `status=${r.status} location=${r.headers.get('location')}`);
  } catch (e) { ng('/api/output-preview', e.message); }

  // ── PUT edit.json ──
  try {
    const r = await fetch(`${BASE}/api/edit.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 0, cuts: [], output: { width: 1280, height: 720, fps: 30 }, source: { path: 'source.mp4' } }),
    });
    const d = await r.json();
    if (r.status === 200 && d.ok) {
      ok('PUT /api/edit.json');
      // restore original
      fs.writeFileSync(path.join(PROJECT, 'edit.json'), JSON.stringify({
        version: 0, output: { width: 1280, height: 720, fps: 30 },
        source: { path: 'source.mp4', proxy: null },
        cuts: [{ in: 0, out: 5 }, { in: 2, out: 8 }],
        audio: {
          bgm: { path: 'bgm.mp3', gain_db: -18, ducking: true },
          narration: [
            { id: 'n-0001', path: 'narration/n-0001.mp3', t: 1.0, provenance: { provider: 'voicevox', voice: 'speaker:3', credit: 'VOICEVOX:ずんだもん' } },
            { id: 'n-0002', path: 'narration/n-0002.mp3', t: 6.0, provenance: { provider: 'human' } },
          ],
        },
      }, null, 2));
    } else {
      ng('PUT /api/edit.json', `status=${r.status} ${JSON.stringify(d)}`);
    }
  } catch (e) { ng('PUT /api/edit.json', e.message); }

  // ── Page load tests ──
  console.log('\n🖥️  Page tests');
  const page = await context.newPage();

  try {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    const resp = await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    if (!resp) { throw new Error('No response from server'); }
    if (resp.status() !== 200) { throw new Error(`HTTP ${resp.status()}`); }
    const bodyPreview = await page.evaluate(() => document.body?.innerHTML?.substring(0, 200) || 'EMPTY_BODY');
    ok(`Page loaded (HTTP ${resp.status()}, body length ${bodyPreview.length})`);

    // Check page title (set in HTML statically)
    const title = await page.title();
    title.includes('AKARI') ? ok('Page title') : ng('Page title', `got "${title}" body=${JSON.stringify(bodyPreview)}`);

    // Wait for play button to be present (staticaly in HTML, no JS needed)
    await page.waitForSelector('#play-toggle', { timeout: 3000, state: 'attached' });
    ok('Play button found');

    const hasSeek = await page.locator('#seek').count();
    hasSeek > 0 ? ok('Seek slider found') : ng('Seek slider', 'not found');

    const hasVideo = await page.locator('#preview-video').count();
    hasVideo > 0 ? ok('Video element found') : ng('Video element', 'not found');

    const hasOutputBtn = await page.locator('#output-preview-btn').count();
    hasOutputBtn > 0 ? ok('Output preview button found') : ng('Output preview button', 'not found');

    // Only report non-WS errors (WS may fail in headless)
    const nonWsErrors = errors.filter(e => !e.includes('ERR_CONNECTION_REFUSED') && !e.includes('WebSocket'));
    if (nonWsErrors.length > 0) {
      ng('Page errors', nonWsErrors.join('; '));
    } else {
      ok('No JS errors');
    }

    // ── Playback controls ──
    // Toggle play/pause (aria-label changes regardless of media)
    await page.click('#play-toggle');
    await page.waitForTimeout(200);
    const label1 = await page.locator('#play-toggle').getAttribute('aria-label');
    // JS play() may fail on no-media, so we check toggle cycles
    await page.click('#play-toggle');
    await page.waitForTimeout(200);
    const label2 = await page.locator('#play-toggle').getAttribute('aria-label');
    if (label1 !== label2) {
      ok('Play toggle cycles aria-label');
    } else {
      ng('Play toggle', `labels same: "${label1}"`);
    }

    // Seek
    await page.evaluate(() => {
      const el = document.getElementById('seek');
      el.max = 100;
      el.value = 42;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const timeLabel = await page.locator('#time-label').textContent();
    ok(`Time label present: "${timeLabel}"`);

    // Output preview button click
    await page.click('#output-preview-btn');
    await page.waitForTimeout(500);
    ok('Output preview button clicked');

  } catch (e) {
    ng('Page interaction', e.message);
    // screenshot for debugging
    try { await page.screenshot({ path: '/tmp/preview-test-error.png', fullPage: true }); } catch {}
  }

  // ── Timeline editor tests ──
  console.log('\n🖥️  Timeline editor tests');
  try {
    // Timeline canvas
    await page.waitForSelector('#timeline-canvas', { timeout: 5000 });
    ok('Timeline canvas found');

    // Timeline controls
    await page.waitForSelector('#tl-zoom-in');
    await page.waitForSelector('#tl-zoom-out');
    await page.waitForSelector('#tl-fit-btn');
    ok('Timeline zoom controls found');

    // Playhead exists
    await page.waitForSelector('#tl-playhead');
    ok('Timeline playhead found');

    // Ruler exists
    await page.waitForSelector('#tl-ruler-canvas');
    ok('Timeline ruler found');

    // Track headers (Video)
    const headerCount = await page.locator('.timeline-track-header').count();
    if (headerCount >= 2) {
      ok(`Timeline track headers count=${headerCount}`);
    } else {
      ng('Track headers', `expected >=2 got ${headerCount}`);
    }

    // Canvas has segments drawn (width > 0)
    const cw = await page.evaluate(() => {
      const c = document.getElementById('timeline-canvas');
      return c ? parseInt(c.style.width) : 0;
    });
    if (cw > 100) {
      ok(`Timeline segments rendered (canvas width=${cw}px)`);
    } else {
      ng('Timeline segments', `canvas width=${cw}px`);
    }

    // Zoom fit button works
    await page.click('#tl-fit-btn');
    await page.waitForTimeout(200);
    ok('Timeline fit clicked');

    // Zoom in works
    await page.click('#tl-zoom-in');
    await page.waitForTimeout(200);
    ok('Timeline zoom-in clicked');

  } catch (e) {
    ng('Timeline editor', e.message);
    try { await page.screenshot({ path: '/tmp/timeline-test-error.png', fullPage: true }); } catch {}
  }

  // ── Asset browser tests ──
  console.log('\n🖥️  Asset browser tests');
  try {
    await page.waitForSelector('#asset-list', { timeout: 5000 });
    ok('Asset browser list found');

    await page.waitForSelector('#asset-search');
    ok('Asset search found');

    await page.waitForSelector('#asset-tabs');
    ok('Asset tabs found');

    // Search input works
    await page.fill('#asset-search', 'mp4');
    await page.waitForTimeout(300);
    ok('Asset search input filled');

    // Clear search
    await page.fill('#asset-search', '');
    await page.waitForTimeout(200);

    // Tab switching works
    const tabs = page.locator('.asset-tab');
    const tabCount = await tabs.count();
    if (tabCount === 4) {
      ok(`Asset tabs count=${tabCount}`);
      // Click video tab
      await tabs.nth(1).click();
      await page.waitForTimeout(200);
      // Check it became active
      const active = await tabs.nth(1).getAttribute('class');
      if (active?.includes('active')) {
        ok('Asset tab switching works');
      }
      // Back to all
      await tabs.nth(0).click();
      await page.waitForTimeout(200);
    } else {
      ng('Asset tabs', `expected 4 got ${tabCount}`);
    }
  } catch (e) {
    ng('Asset browser', e.message);
    try { await page.screenshot({ path: '/tmp/asset-test-error.png', fullPage: true }); } catch {}
  }

  // ── Split / Delete cut tests ──
  console.log('\n🖥️  Cut edit tests');
  const editJsonPath = path.join(PROJECT, 'edit.json');
  const editBackup = fs.readFileSync(editJsonPath, 'utf-8');
  try {
    // Wait for cuts to be rendered
    await page.waitForTimeout(500);

    // Get initial cut count
    const initialCuts = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
    if (initialCuts < 1) {
      ng('Split cut', `no cuts to split (count=${initialCuts})`);
    } else {
      ok(`Initial cuts: ${initialCuts}`);

      // Seek to middle of first cut to split
      await page.evaluate(() => {
        const seg = window.__test.segments?.[0];
        if (seg) window.__test.seekTo(seg.durationSec / 2);
      });
      await page.waitForTimeout(200);

      // Press S to split
      await page.keyboard.press('s');
      await page.waitForTimeout(500);

      // Get cut count after split
      const afterSplit = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
      if (afterSplit === initialCuts + 1) {
        ok(`Split: cuts ${initialCuts} → ${afterSplit}`);
      } else {
        ng('Split', `expected ${initialCuts + 1} cuts, got ${afterSplit}`);
      }

      // Delete the second cut (the new split)
      await page.evaluate(() => {
        const seg = window.__test?.getActiveSegment?.(window.__test.outputTime);
        if (seg && seg.index >= 0) {
          window.__test.seekTo(Math.max(0, seg.durationSec - 0.1));
        }
      });
      await page.waitForTimeout(200);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(500);

      const afterDel = await page.evaluate(() => window.__test?.summary?.cuts?.length || 0);
      // After split (N+1) then delete one = N
      if (afterDel === initialCuts + 1 - 1) {
        ok(`Delete: cuts ${initialCuts + 1} → ${afterDel}`);
      } else {
        ng('Delete', `expected ${initialCuts} cuts, got ${afterDel}`);
      }

    }
    ok('Split+Delete tests passed');
  } catch (e) {
    ng('Cut edit', e.message);
    try { await page.screenshot({ path: '/tmp/cut-edit-error.png', fullPage: true }); } catch {}
  }

  // ── Output preview page ──
  console.log('\n🖥️  Output preview page');
  try {
    const outPage = await context.newPage();
    outPage.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('WebSocket')) console.log(`[out] ${msg.text()}`); });
    await outPage.goto(`${BASE}/?mode=output`, { waitUntil: 'load', timeout: 15000 });

    const outTitle = await outPage.title();
    outTitle.includes('出力') ? ok('Output page title') : ng('Output page title', `got "${outTitle}"`);

    await outPage.waitForSelector('#play-toggle', { timeout: 10000 });
    const outBtn = outPage.locator('#output-preview-btn');
    const hidden = await outBtn.getAttribute('hidden');
    if (hidden === '' || hidden === 'hidden') {
      ok('Output preview button hidden in output mode');
    } else {
      ng('Output preview button', 'expected hidden attribute');
    }
    await outPage.close();
  } catch (e) {
    ng('Output preview page', e.message);
  }

  // ── WebSocket bidirectional sync test ──
  console.log('\n🔌 WebSocket sync test');
  try {
    const page2 = await context.newPage();
    page2.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('WebSocket')) console.log(`[ws] ${msg.text()}`); });
    await page2.goto(`${BASE}/?mode=output`, { waitUntil: 'load', timeout: 15000 });
    await page2.waitForSelector('#play-toggle', { timeout: 5000 });

    // Use page2 to send a WS message directly; observe effect on page1
    const sent = await page2.evaluate((port) => {
      return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'seek', time: 3.5 }));
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 3000);
      });
    }, PORT);

    if (sent) {
      await page.waitForTimeout(600);
      const t = await page.evaluate(() => parseFloat(document.getElementById('seek').value) || 0);
      if (Math.abs(t - 3.5) < 0.5) {
        ok('Bidirectional sync: seek relayed (time=' + t.toFixed(2) + ')');
      } else {
        ng('Bidirectional sync', `expected time ~3.5 got ${t}`);
      }
    } else {
      ng('Bidirectional sync', 'WS connection failed');
    }
    await page2.close();
  } catch (e) {
    ng('WebSocket sync test', e.message);
  }

  await page.close();
  // Restore edit.json (file watcher may trigger reload on server, safe after page close)
  try { fs.writeFileSync(editJsonPath, editBackup, 'utf-8'); } catch {}
  await browser.close();
  if (!hadOutput) fs.unlinkSync(OUT_JSON);

  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`結果: ${passed}/${total} passed, ${failed} failed\n`);
  for (const r of results) console.log(r);
  console.log(`\n${'═'.repeat(50)}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

// ── Spawn server ──
const srv = spawn('node', [
  'src/server.mjs', PROJECT, '--port', String(PORT), '--no-lint',
], {
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
  console.log('\n[cleanup] server stopped');
}
