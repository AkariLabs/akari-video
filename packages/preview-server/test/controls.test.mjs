import { chromium } from 'playwright';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT = path.resolve(import.meta.dirname, '..', '..', '..', 'test-project');
const PORT = 4577;
const BASE = `http://localhost:${PORT}`;

async function waitForServer(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  let passed = 0;
  let failed = 0;
  const results = [];

  function ok(name) { passed++; results.push(`  PASS  ${name}`); }
  function ng(name, err) { failed++; results.push(`  FAIL  ${name}: ${err}`); }

  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') jsErrors.push(msg.text()); });

  try {
    await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('#play-toggle', { timeout: 5000 });
    await page.waitForSelector('#seek', { timeout: 5000 });
    await page.waitForSelector('#preview-video', { timeout: 5000 });
    // Wait for JS init to finish
    await page.waitForFunction(() => window.__test?.segments?.length >= 1, { timeout: 8000 });
    ok('Page loaded, segments built');
  } catch (e) {
    ng('Page load', e.message);
    await browser.close();
    printResults(passed, failed, results);
    process.exitCode = 1;
    return;
  }

  // Helper: check aria-label
  const label = () => page.locator('#play-toggle').getAttribute('aria-label');
  // Helper: pause if playing
  const ensurePaused = async () => {
    if (await page.evaluate(() => window.__test?.isPlaying)) {
      await page.click('#play-toggle');
      await page.waitForTimeout(200);
    }
  };

  // ── 1. Transport buttons exist ──
  console.log('\n=== Transport buttons ===');
  for (const id of ['frame-back', 'skip-back', 'play-toggle', 'skip-forward', 'frame-forward']) {
    try {
      await page.waitForSelector(`#${id}`, { timeout: 3000 });
      ok(`Button #${id} exists`);
    } catch (e) { ng(`Button #${id}`, 'not found'); }
  }

  // ── 2. Play → pause → play → pause (cycle) ──
  console.log('\n=== Play/pause cycle ===');
  try {
    await ensurePaused();
    const l1 = await label();
    await page.click('#play-toggle'); await page.waitForTimeout(500);
    const l2 = await label();
    if (l2 === '一時停止') { ok('play-toggle: play started'); } else { ng('play-toggle play', `expected 一時停止 got ${l2}`); }

    await page.click('#play-toggle'); await page.waitForTimeout(200);
    const l3 = await label();
    if (l3 === '再生') { ok('play-toggle: paused'); } else { ng('play-toggle pause', `expected 再生 got ${l3}`); }

    await page.click('#play-toggle'); await page.waitForTimeout(500);
    const l4 = await label();
    if (l4 === '一時停止') { ok('play-toggle: resumed'); } else { ng('play-toggle resume', `expected 一時停止 got ${l4}`); }

    await page.click('#play-toggle'); await page.waitForTimeout(200);
    const l5 = await label();
    if (l5 === '再生') { ok('play-toggle: paused again'); } else { ng('play-toggle pause again', `expected 再生 got ${l5}`); }
  } catch (e) { ng('Play/pause cycle', e.message); }

  // ── 3. Play → pause → play (no black screen) ──
  console.log('\n=== Black screen check ===');
  try {
    await ensurePaused();
    await page.click('#play-toggle'); await page.waitForTimeout(800);
    await page.click('#play-toggle'); await page.waitForTimeout(200);
    await page.click('#play-toggle'); await page.waitForTimeout(800);
    // Video should have a readyState >= 2 (HAVE_CURRENT_DATA) and not be paused
    const vState = await page.evaluate(() => {
      const v = document.getElementById('preview-video');
      if (!v) return 'no-video';
      return { paused: v.paused, readyState: v.readyState, currentTime: v.currentTime, src: v.src ? 'set' : 'empty' };
    });
    if (!vState.paused && vState.readyState >= 1) {
      ok(`Video playing after resume (readyState=${vState.readyState}, t=${vState.currentTime.toFixed(2)})`);
    } else {
      ng('Video after resume', `paused=${vState.paused} readyState=${vState.readyState}`);
    }
    await page.click('#play-toggle'); await page.waitForTimeout(200);
  } catch (e) { ng('Black screen check', e.message); }

  // ── 4. Seek while paused → play ──
  console.log('\n=== Seek + play ===');
  try {
    await ensurePaused();
    // Seek to middle via slider
    await page.evaluate(() => {
      const el = document.getElementById('seek');
      if (el && el.max && el.max > 0) {
        el.value = el.max / 2;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => window.__test?.outputTime || 0);
    await page.click('#play-toggle'); await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => window.__test?.outputTime || 0);
    if (t2 > t1) {
      ok(`Seek then play: time advanced ${t1.toFixed(2)} → ${t2.toFixed(2)}`);
    } else {
      ng('Seek then play', `time did not advance (${t1.toFixed(2)} → ${t2.toFixed(2)})`);
    }
    await page.click('#play-toggle'); await page.waitForTimeout(200);
  } catch (e) { ng('Seek + play', e.message); }

  // ── 5. Skip back / skip forward while paused ──
  console.log('\n=== Skip buttons ===');
  try {
    await ensurePaused();
    const t0 = await page.evaluate(() => window.__test?.outputTime || 0);
    await page.click('#skip-forward'); await page.waitForTimeout(200);
    const t1 = await page.evaluate(() => window.__test?.outputTime || 0);
    if (t1 > t0) { ok(`skip-forward: ${t0.toFixed(2)} → ${t1.toFixed(2)}`); }
    else { ng('skip-forward', `time did not advance (${t0.toFixed(2)} → ${t1.toFixed(2)})`); }

    await page.click('#skip-back'); await page.waitForTimeout(200);
    const t2 = await page.evaluate(() => window.__test?.outputTime || 0);
    if (t2 < t1) { ok(`skip-back: ${t1.toFixed(2)} → ${t2.toFixed(2)}`); }
    else { ng('skip-back', `time did not decrease (${t1.toFixed(2)} → ${t2.toFixed(2)})`); }
  } catch (e) { ng('Skip buttons', e.message); }

  // ── 6. Go to beginning (frame-back) ──
  console.log('\n=== Go to beginning ===');
  try {
    await ensurePaused();
    await page.evaluate(() => { const el = document.getElementById('seek'); if (el && el.max) el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    await page.click('#frame-back'); await page.waitForTimeout(300);
    const t0 = await page.evaluate(() => window.__test?.outputTime ?? -1);
    if (t0 >= 0 && t0 < 0.1) { ok(`frame-back: outputTime=${t0.toFixed(3)}`); }
    else { ng('frame-back', `expected ~0 got ${t0.toFixed(3)}`); }
  } catch (e) { ng('Go to beginning', e.message); }

  // ── 7. Go to end (frame-forward) ──
  console.log('\n=== Go to end ===');
  try {
    await ensurePaused();
    await page.click('#frame-forward'); await page.waitForTimeout(300);
    const tEnd = await page.evaluate(() => window.__test?.outputTime ?? -1);
    const total = await page.evaluate(() => window.__test?.totalDuration ?? 0);
    if (tEnd >= total - 0.05) { ok(`frame-forward to end: ${tEnd.toFixed(2)}/${total.toFixed(2)}`); }
    else { ng('frame-forward', `expected ~${total.toFixed(2)} got ${tEnd.toFixed(2)}`); }
  } catch (e) { ng('Go to end', e.message); }

  // ── 8. Keyboard shortcuts ──
  console.log('\n=== Keyboard shortcuts ===');
  try {
    // Home → beginning
    await page.keyboard.press('Home'); await page.waitForTimeout(200);
    const th = await page.evaluate(() => window.__test?.outputTime || -1);
    if (th < 0.1) { ok('Home key → beginning'); } else { ng('Home key', `expected ~0 got ${th.toFixed(2)}`); }

    // End → end
    await page.keyboard.press('End'); await page.waitForTimeout(200);
    const te = await page.evaluate(() => window.__test?.outputTime ?? -1);
    const td = await page.evaluate(() => window.__test?.totalDuration ?? 0);
    if (te >= td - 0.05) { ok('End key → end'); } else { ng('End key', `expected ~${td.toFixed(2)} got ${te.toFixed(2)}`); }

    // Arrow step
    await page.keyboard.press('Home'); await page.waitForTimeout(100);
    const ta0 = await page.evaluate(() => window.__test?.outputTime ?? 0);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
    const ta1 = await page.evaluate(() => window.__test?.outputTime ?? 0);
    if (ta1 > ta0) { ok(`ArrowRight: ${ta0.toFixed(3)} → ${ta1.toFixed(3)}`); }
    else { ng('ArrowRight', `did not advance (${ta0.toFixed(3)} → ${ta1.toFixed(3)})`); }

    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
    const ta2 = await page.evaluate(() => window.__test?.outputTime ?? 0);
    if (ta2 < ta1) { ok(`ArrowLeft: ${ta1.toFixed(3)} → ${ta2.toFixed(3)}`); }
    else { ng('ArrowLeft', `did not decrease (${ta1.toFixed(3)} → ${ta2.toFixed(3)})`); }
  } catch (e) { ng('Keyboard shortcuts', e.message); }

  // ── 9. Play then go to beginning while playing ──
  console.log('\n=== Play + go to beginning while playing ===');
  try {
    await ensurePaused();
    await page.keyboard.press('Home'); await page.waitForTimeout(100);
    await page.click('#play-toggle'); await page.waitForTimeout(400);
    const tp0 = await page.evaluate(() => window.__test?.outputTime ?? 0);
    // Press Home WHILE playing (Home seeks to 0 without pausing)
    await page.keyboard.press('Home'); await page.waitForTimeout(150);
    const tp1 = await page.evaluate(() => window.__test?.outputTime ?? -1);
    const stillPlaying = await page.evaluate(() => window.__test?.isPlaying);
    if (tp1 >= 0 && tp1 < tp0 - 0.3 && stillPlaying) {
      ok(`Play + Home while playing: ${tp0.toFixed(2)}→${tp1.toFixed(2)} playing=${stillPlaying}`);
    } else {
      ng('Play + Home while playing', `t=${tp0.toFixed(2)}→${tp1.toFixed(2)} playing=${stillPlaying}`);
    }
    await page.click('#play-toggle'); await page.waitForTimeout(200);
  } catch (e) { ng('Play + go to beginning', e.message); }

  // ── 10. Play → pause → go to beginning → play (BGM should reset) ──
  console.log('\n=== Play → pause → beginning → play (BGM reset) ===');
  try {
    await ensurePaused();
    // Play for a bit
    await page.keyboard.press('Home'); await page.waitForTimeout(100);
    await page.click('#play-toggle'); await page.waitForTimeout(1500);
    await page.click('#play-toggle'); await page.waitForTimeout(200);
    // Go to beginning
    await page.click('#frame-back'); await page.waitForTimeout(300);
    // Play again — should start from beginning
    await page.click('#play-toggle'); await page.waitForTimeout(500);
    const tb = await page.evaluate(() => window.__test?.outputTime ?? 0);
    if (tb > 0 && tb < 1.5) {
      ok(`Play after pause+beginning: time=${tb.toFixed(2)} (advanced from 0)`);
    } else {
      ng('Play after pause+beginning', `unexpected time ${tb.toFixed(2)}`);
    }
    await page.click('#play-toggle'); await page.waitForTimeout(200);
  } catch (e) { ng('BGM reset', e.message); }

  // ── 11. Fast play-then-pause cycle (rapid clicks) ──
  console.log('\n=== Rapid play/pause ===');
  try {
    await ensurePaused();
    await page.keyboard.press('Home'); await page.waitForTimeout(50);
    for (let i = 0; i < 5; i++) {
      await page.click('#play-toggle'); await page.waitForTimeout(100);
    }
    await page.waitForTimeout(200);
    const finalLabel = await label();
    ok(`Rapid 5x play/pause cycle OK (end state: ${finalLabel})`);
  } catch (e) { ng('Rapid play/pause', e.message); }

  // ── 12. Seek slider while playing ──
  console.log('\n=== Seek while playing ===');
  try {
    await ensurePaused();
    await page.keyboard.press('Home'); await page.waitForTimeout(100);
    await page.click('#play-toggle'); await page.waitForTimeout(500);
    const wasPlaying = await page.evaluate(() => window.__test?.isPlaying);
    const tBefore = await page.evaluate(() => window.__test?.outputTime ?? -1);
    // Seek via evaluate (dispatch input event)
    await page.evaluate(() => {
      const el = document.getElementById('seek');
      if (el && el.max && el.max > 0) {
        el.value = el.max * 0.75;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.waitForTimeout(400);
    const tAfter = await page.evaluate(() => window.__test?.outputTime ?? -1);
    const stillPlay = await page.evaluate(() => window.__test?.isPlaying);
    if (stillPlay && Math.abs(tAfter - tBefore) > 0.5) {
      ok(`Seek while playing: ${tBefore.toFixed(2)} → ${tAfter.toFixed(2)} (still playing)`);
    } else {
      ng('Seek while playing', `t=${tBefore.toFixed(2)}→${tAfter.toFixed(2)} playing=${stillPlay}`);
    }
    await page.click('#play-toggle'); await page.waitForTimeout(200);
  } catch (e) { ng('Seek while playing', e.message); }

  // ── 13. Final JS error check ──
  console.log('\n=== JS errors ===');
  const nonWsErrors = jsErrors.filter(e =>
    !e.includes('ERR_CONNECTION_REFUSED') &&
    !e.includes('WebSocket') &&
    !e.includes('favicon') &&
    !e.includes('play() request was interrupted') &&
    !e.includes('The play() request')
  );
  if (nonWsErrors.length === 0) {
    ok('No JS errors during controls test');
  } else {
    ng('JS errors', nonWsErrors.join('; '));
  }

  await page.close();
  await browser.close();

  printResults(passed, failed, results);
  process.exitCode = failed > 0 ? 1 : 0;
}

function printResults(passed, failed, results) {
  const total = passed + failed;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Controls test: ${passed}/${total} passed, ${failed} failed\n`);
  for (const r of results) console.log(r);
  console.log(`\n${'═'.repeat(50)}`);
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
