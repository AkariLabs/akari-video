import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 総尺の期待値は Web UI と同じ共有カーネルで計算する（P2-7 テスト用）
const { buildTimelineMap } = require('../../edit-store/lib/timeline-map.js');

// リポ内 test-project を直接使うと PUT テストが edit.json を汚すため、
// 一時ディレクトリへコピーしてから回す（リポは読み取りのみ）。
const SRC_PROJECT = path.resolve(import.meta.dirname, '..', '..', '..', 'test-project');
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-test-run-'));
fs.cpSync(SRC_PROJECT, PROJECT, { recursive: true });
const PORT = 4567;
const BASE = `http://localhost:${PORT}`;
const OUT_JSON = path.join(PROJECT, 'edit.output.json');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);

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

  const browser = await chromium.launch({
    headless: true,
    ...(SYSTEM_CHROME && fs.existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
  });
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
    const failedResponses = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('response', response => {
      if (response.status() >= 400) failedResponses.push(`HTTP ${response.status()} ${response.url()}`);
    });

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
    const nonWsErrors = [...failedResponses, ...errors.filter(e => !e.includes('ERR_CONNECTION_REFUSED')
      && !e.includes('WebSocket')
      // Chromium emits this anonymous console line for a speculative resource request;
      // HTTP/API/media/font responses are asserted independently in this suite.
      && !(failedResponses.length === 0
        && e === 'Failed to load resource: the server responded with a status of 404 (Not Found)'))];
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

  // ── P1-2: レターボックス時のステージ＝ビデオ枠一致 ──
  // 横長ペインでは wrapper の aspect-ratio が max-height で破れる。stage は出力フレーム矩形
  // （出力アスペクトで中央フィット）に一致し、論理サイズは出力 px でなければならない
  console.log('\n🖥️  Stage/letterbox alignment (P1-2)');
  try {
    const wide = await context.newPage();
    await wide.setViewportSize({ width: 1600, height: 500 });
    await wide.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await wide.waitForTimeout(1200);
    const geom = await wide.evaluate(() => {
      const wrapperEl = document.getElementById('preview-wrapper');
      const stageEl = document.getElementById('overlay-stage');
      const w = wrapperEl.getBoundingClientRect();
      const s = stageEl.getBoundingClientRect();
      return {
        wrapper: { x: w.x, y: w.y, width: w.width, height: w.height },
        stage: { x: s.x, y: s.y, width: s.width, height: s.height },
        logicalWidth: stageEl.clientWidth,
        logicalHeight: stageEl.clientHeight,
        output: (window.akari && window.akari.outputSize) ? window.akari.outputSize() : null
      };
    });
    const os = geom.output || { width: 1280, height: 720 };
    const aspectExpected = os.width / os.height;
    const aspectActual = geom.stage.width / geom.stage.height;
    Math.abs(aspectActual - aspectExpected) < 0.02
      ? ok(`Stage keeps output aspect under letterbox (${aspectActual.toFixed(3)})`)
      : ng('Stage aspect', `expected ${aspectExpected.toFixed(3)} got ${aspectActual.toFixed(3)}`);
    (geom.logicalWidth === os.width && geom.logicalHeight === os.height)
      ? ok('Stage logical size equals output px')
      : ng('Stage logical size', JSON.stringify({ logical: [geom.logicalWidth, geom.logicalHeight], output: os }));
    const centered = Math.abs((geom.stage.x - geom.wrapper.x) - (geom.wrapper.width - geom.stage.width) / 2) < 2;
    const fitsBox = geom.stage.width <= geom.wrapper.width + 1 && geom.stage.height <= geom.wrapper.height + 1;
    (centered && fitsBox)
      ? ok('Stage centered inside wrapper frame rect')
      : ng('Stage placement', JSON.stringify(geom));
    await wide.close();
  } catch (e) { ng('Stage/letterbox alignment', e.message); }

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

  // ── P2-7: 編集適用の差分化（location.reload しない・再生位置を保持） ──
  console.log('\n🔁 Soft reload on edit apply (P2-7)');
  try {
    const editPath = path.join(PROJECT, 'edit.json');
    const originalEdit = fs.readFileSync(editPath, 'utf8');
    // ページ再読込されたら消えるマーカー + 既知の再生位置に合わせる
    await page.evaluate(() => {
      window.__softReloadMarker = 'alive';
      const el = document.getElementById('seek');
      el.value = 3;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // 末尾カットの out を 1 秒縮める（総尺が変わる観測可能な編集）を PUT で適用。
    // 先行テストが edit.json を書き換えている可能性があるため、期待総尺は
    // 変更後 cuts から共有カーネルで計算する
    const modified = JSON.parse(originalEdit);
    const lastCut = modified.cuts[modified.cuts.length - 1];
    lastCut.out = lastCut.out - 1;
    const expectedTotal = buildTimelineMap(modified.cuts).totalDuration;
    const putRes = await fetch(`${BASE}/api/edit.json`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modified, null, 2)
    });
    if (!putRes.ok) throw new Error(`PUT failed: HTTP ${putRes.status}`);
    await page.waitForTimeout(2000);

    const state = await page.evaluate(() => ({
      marker: window.__softReloadMarker || null,
      seekMax: parseFloat(document.getElementById('seek').max),
      t: parseFloat(document.getElementById('seek').value)
    }));
    state.marker === 'alive'
      ? ok('Edit apply does not reload the page (marker survives)')
      : ng('Soft reload', `page reloaded (marker=${state.marker})`);
    Math.abs(state.seekMax - expectedTotal) < 0.05
      ? ok(`New total duration applied in place (seek.max=${state.seekMax})`)
      : ng('Soft reload duration', `expected seek.max ~${expectedTotal} got ${state.seekMax}`);
    Math.abs(state.t - 3) < 0.2
      ? ok(`Playback position preserved (t=${state.t.toFixed(2)})`)
      : ng('Soft reload position', `expected t ~3 got ${state.t}`);

    // 元に戻す（後続の実行やサーバ状態を汚さない）
    await fetch(`${BASE}/api/edit.json`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: originalEdit
    });
    await page.waitForTimeout(800);
  } catch (e) {
    ng('Soft reload on edit apply', e.message);
  }

  await page.close();
  await browser.close();
  if (!hadOutput) fs.unlinkSync(OUT_JSON);

  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`結果: ${passed}/${total} passed, ${failed} failed\n`);
  for (const r of results) console.log(r);
  console.log(`\n${'═'.repeat(50)}`);
  // ここで process.exit すると finally（srv.kill）が走らずサーバが残骸化し、
  // 次回実行が古いサーバへ接続してしまう。失敗数を返して呼び出し側で exit する。
  return failed;
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

let failedCount = 1;
try {
  await waitForServer(`http://localhost:${PORT}/api/codec-info`);
  failedCount = await main();
} finally {
  srv.kill();
  fs.rmSync(PROJECT, { recursive: true, force: true });
  console.log('\n[cleanup] server stopped');
}
process.exit(failedCount > 0 ? 1 : 0);
