import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';
// layers[].perspective パリティ実測（contract-2026-08-02-preview-parity.md §2.4.4）用の
// 参照計算（Web の実装そのもの — 同じ関数を独立に再インポートし、実ブラウザの
// videoWidth/videoHeight から導いた box で「app.js が実際に書き込んだ matrix3d」と突き合わせる）。
import { computeLayerPerspectiveVisual } from '../public/layer-perspective-visual.js';

const require = createRequire(import.meta.url);
// 総尺の期待値は Web UI と同じ共有カーネルで計算する（P2-7 テスト用）
const { buildTimelineMap } = require('../../edit-store/lib/timeline-map.js');

// リポ内 test-project を直接使うと PUT テストが edit.json を汚すため、
// 一時ディレクトリへコピーしてから回す（リポは読み取りのみ）。
const SRC_PROJECT = path.resolve(import.meta.dirname, '..', '..', '..', 'test-project');
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-test-run-'));
fs.cpSync(SRC_PROJECT, PROJECT, { recursive: true });
// ポートは固定しない。固定にすると、別セッションが同じポートで別プロジェクトを
// 配信していたときにテストがそちらへ接続し、偽の失敗（404 / 422 / 別プロジェクトの
// lint 結果）を出す（実際に起きた既知の罠）。毎回 OS から空きポートを借りる。
const PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
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

    // ── カット情報ポップアップはスクラブでは開かない（監査 P3 回帰）──
    // seek.max が実総尺のうち（下の Seek テストが max=100 に書き換える前）に実施する
    {
      const box = await page.locator('#seek').boundingBox();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const hiddenAfterScrub = await page.evaluate(() => document.getElementById('cut-info-popup').hidden);
      hiddenAfterScrub
        ? ok('Scrub drag keeps cut info popup closed')
        : ng('Scrub opened cut info popup', 'popup visible after drag');
      await page.evaluate(() => {
        const el = document.getElementById('seek');
        el.value = '0.5';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const hiddenAfterInput = await page.evaluate(() => document.getElementById('cut-info-popup').hidden);
      hiddenAfterInput
        ? ok('Programmatic seek input keeps cut info popup closed')
        : ng('Programmatic input opened cut info popup', 'popup visible after input event');
      await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
      await page.waitForTimeout(200);
      const openAfterClick = await page.evaluate(() => !document.getElementById('cut-info-popup').hidden);
      openAfterClick
        ? ok('Plain click on seek opens cut info popup')
        : ng('Plain click did not open cut info popup', 'popup still hidden');
      // 後続テストへ影響しないよう閉じる
      await page.evaluate(() => { document.getElementById('cut-info-popup').hidden = true; });
    }

    // ── シークバーにフォーカスが残っていても Space が再生トグルに届く（実機報告回帰:
    //    旧ガードは INPUT を無差別に除外していたため type=range で Space が飲まれた）──
    {
      await page.click('#seek'); // range にフォーカスを残す（開いたポップアップは閉じる）
      await page.evaluate(() => { document.getElementById('cut-info-popup').hidden = true; });
      const focusOnSeek = await page.evaluate(() => document.activeElement?.id === 'seek');
      focusOnSeek ? ok('Focus sits on seek range input') : ng('Focus setup', 'activeElement is not #seek');
      const before = await page.locator('#play-toggle').getAttribute('aria-label');
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      const after = await page.locator('#play-toggle').getAttribute('aria-label');
      before !== after
        ? ok('Space toggles playback while seek range is focused')
        : ng('Space swallowed by focused seek range', `aria-label stays "${before}"`);
      // 元の再生状態へ戻す
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      // 数値入力（カット情報ポップアップの IN 欄）内では Space は打鍵のまま
      await page.click('#seek');
      await page.waitForTimeout(200);
      const hasNumberInput = await page.evaluate(() => !!document.getElementById('cut-inp-in'));
      if (hasNumberInput) {
        await page.focus('#cut-inp-in');
        const b2 = await page.locator('#play-toggle').getAttribute('aria-label');
        await page.keyboard.press('Space');
        await page.waitForTimeout(300);
        const a2 = await page.locator('#play-toggle').getAttribute('aria-label');
        b2 === a2
          ? ok('Space inside number input does not toggle playback')
          : ng('Space stolen from number input', `aria-label changed to "${a2}"`);
      } else {
        ng('Cut info popup for number-input check', 'cut-inp-in not present after seek click');
      }
      await page.evaluate(() => { document.getElementById('cut-info-popup').hidden = true; });
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

  // ── 再生中に動画が再読み込みされない（回帰: clip.src のルート相対化で
  //    `video.src !== src` が常に真になり毎フレーム再代入 → スピナー固着・再生不能） ──
  console.log('\n▶️  Playback does not reload the video element');
  try {
    const pp = await context.newPage();
    await pp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await pp.waitForTimeout(2500);
    await pp.evaluate(() => {
      window.__reloads = 0;
      window.__seeks = 0;
      const v = document.getElementById('preview-video');
      v.addEventListener('loadstart', () => window.__reloads++);
      v.addEventListener('seeking', () => window.__seeks++);
    });
    await pp.click('#play-toggle');
    await pp.waitForTimeout(2500);
    // スピナーは一時的な waiting でも点くのが正常。ここで押さえたいのは
    // 「出たまま戻らない（＝実際の不具合）」なので、数秒以内に消えるかを見る。
    let settled = false;
    for (let i = 0; i < 12 && !settled; i++) {
      settled = await pp.evaluate(() => {
        const v = document.getElementById('preview-video');
        return v.readyState >= 3
          && getComputedStyle(document.getElementById('loading-indicator')).display === 'none';
      });
      if (!settled) await pp.waitForTimeout(400);
    }
    const st = await pp.evaluate(() => {
      const v = document.getElementById('preview-video');
      return {
        reloads: window.__reloads, seeks: window.__seeks,
        readyState: v.readyState, paused: v.paused,
        spinner: getComputedStyle(document.getElementById('loading-indicator')).display,
      };
    });
    st.settled = settled;
    st.reloads === 0
      ? ok('No video reload during playback (loadstart 0)')
      : ng('Video reload storm', `loadstart fired ${st.reloads} times in 2.5s`);
    st.seeks < 10
      ? ok(`No seek storm during playback (${st.seeks})`)
      : ng('Seek storm', `${st.seeks} seeks in 2.5s`);
    st.settled
      ? ok('Loading spinner clears during playback (not stuck)')
      : ng('Loading spinner stuck', `display=${st.spinner} readyState=${st.readyState} paused=${st.paused}`);
    // 再生したまま閉じると、このページが送り続けた ws tick に他のクライアント
    // （後続テストが使う page）が追従して勝手に再生・シークしてしまう。必ず止める。
    await pp.click('#play-toggle');
    await pp.waitForTimeout(400);
    await pp.close();
    // 追従で動いてしまった分を戻す
    await page.evaluate(() => {
      const el = document.getElementById('seek');
      el.value = '0';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
  } catch (e) { ng('Playback reload check', e.message); }

  // ── オーバーレイ操作層の CSS が配線されている（回帰: 未配線だと選択枠が
  //    position:fixed を失い body(display:grid) の行を増やしてプレビューが縮む） ──
  console.log('\n🎯 Interaction stylesheet wiring');
  try {
    const cssRes = await fetch(`${BASE}/overlay-interaction.css`);
    cssRes.ok ? ok('/overlay-interaction.css served') : ng('/overlay-interaction.css', `HTTP ${cssRes.status}`);

    const cp = await context.newPage();
    await cp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await cp.waitForTimeout(1500);
    const probe = await cp.evaluate(() => {
      const before = getComputedStyle(document.body).gridTemplateRows;
      const el = document.createElement('div');
      el.className = 'akari-interaction-selection-frame';
      el.setAttribute('data-akari-interaction', 'selection-frame');
      document.body.appendChild(el);
      const pos = getComputedStyle(el).position;
      const after = getComputedStyle(document.body).gridTemplateRows;
      el.remove();
      return { pos, beforeRows: before.split(' ').length, afterRows: after.split(' ').length };
    });
    probe.pos === 'fixed'
      ? ok('Selection frame resolves to position:fixed')
      : ng('Selection frame position', `expected fixed got ${probe.pos} (interaction.css not applied)`);
    probe.afterRows === probe.beforeRows
      ? ok('Selection frame does not add a body grid row')
      : ng('Layout shift', `body grid rows ${probe.beforeRows} → ${probe.afterRows}`);
    await cp.close();
  } catch (e) { ng('Interaction stylesheet wiring', e.message); }

  // ── ベイクレイヤーとアニメ断片が edit.json どおりに描かれる ──
  // 回帰: baked を丸ごとスキップしていた（ProRes .mov が再生できないため）ので、
  // bake-layer が併せて出す .preview.webm サイドカーを使う。アニメ断片は
  // data-akari-active 前提で書く規約なのに Web UI が属性を立てず全部不可視だった。
  console.log('\n🎬 Baked layers + animated fragments');
  try {
    const lp = await context.newPage();
    await lp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await lp.waitForTimeout(2000);
    const wiring = await lp.evaluate(() => {
      const vids = Array.from(document.querySelectorAll('#layer-container video'));
      return {
        count: vids.length,
        allSidecar: vids.length > 0 && vids.every(v => /\.preview\.webm(\?|$)/.test(v.src)),
        srcs: vids.map(v => v.src.split('/').pop()).slice(0, 3),
      };
    });
    // test-project に baked レイヤーが無い場合は配線だけ確認して抜ける
    if (wiring.count === 0) {
      ok('No baked layers in fixture (wiring check skipped)');
    } else {
      wiring.allSidecar
        ? ok(`Baked layers use .preview.webm sidecars (${wiring.count})`)
        : ng('Baked layer src', `expected .preview.webm, got ${JSON.stringify(wiring.srcs)}`);
    }
    // アニメ規約の属性が可視状態と連動すること（オーバーレイが在る場合のみ）
    const attr = await lp.evaluate(() => {
      const el = document.querySelector('#overlay-stage [data-overlay-id]');
      if (!el) return { skipped: true };
      const rt = window.akari?.runtime;
      if (!rt?.tick) return { skipped: true };
      const start = Number(el.dataset.start) || 0;
      rt.tick(start + 0.01);
      const on = el.hasAttribute('data-akari-active');
      rt.tick(start + (Number(el.dataset.duration) || 0) + 10);
      const off = el.hasAttribute('data-akari-active');
      return { skipped: false, on, off };
    });
    if (attr.skipped) ok('No overlays in fixture (animation attribute check skipped)');
    else if (attr.on && !attr.off) ok('data-akari-active follows overlay visibility');
    else ng('data-akari-active', `inside=${attr.on} outside=${attr.off}`);
    await lp.close();
  } catch (e) { ng('Baked layers + animation', e.message); }

  // ── 編集中（contenteditable）は再生ショートカットに取られない ──
  // 回帰: キーガードが INPUT/SELECT しか除外しておらず、断片の文字編集中に ← → が
  // 「1 コマ戻す/送る」に、Space が再生トグルに取られてキャレットが動かせなかった。
  console.log('\n⌨️  Editing keys are not stolen by transport shortcuts');
  try {
    const kp = await context.newPage();
    await kp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await kp.waitForTimeout(2000);
    const r = await kp.evaluate(() => {
      const host = document.createElement('div');
      host.contentEditable = 'true';
      host.textContent = 'あいうえお';
      document.body.appendChild(host);
      host.focus();
      const seek = document.getElementById('seek');
      const before = Number(seek.value);
      let defaultPrevented = false;
      for (const code of ['ArrowLeft', 'ArrowRight', 'Space']) {
        const ev = new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true });
        host.dispatchEvent(ev);
        if (ev.defaultPrevented) defaultPrevented = true;
      }
      const after = Number(seek.value);
      host.remove();
      return { before, after, defaultPrevented };
    });
    (!r.defaultPrevented && Math.abs(r.after - r.before) < 0.001)
      ? ok('Arrow/Space are left to the caret while editing')
      : ng('Editing keys stolen', `prevented=${r.defaultPrevented} seek ${r.before}→${r.after}`);
    await kp.close();
  } catch (e) { ng('Editing keys', e.message); }

  // ── 字幕 zone の水平成分 + 変数の持ち越し ──
  // 回帰: 行が margin:0 auto 固定で align-items が効かず top-right が上中央に出ていた。
  // さらに前の字幕の CSS 変数が消えず、次の既定 bottom 字幕が上段へ持ち越されていた。
  console.log('\n📝 Caption zone (horizontal + no carry-over)');
  try {
    // zone 検証用の字幕をフィクスチャへ足す（top-right の直後に既定 bottom を置き、
    // 水平成分と持ち越しの両方を 1 本の再生列で見る）
    const mk = (id, start, end, text, zone) => ({
      id, start, end, text, speaker: null, sourceRef: null, edited: false,
      ...(zone ? { text_style: { zone } } : {})
    });
    fs.writeFileSync(path.join(PROJECT, 'captions.json'), JSON.stringify([
      mk('c-0001', 1, 3, '右上に出る字幕', 'top-right'),
      mk('c-0002', 4, 6, '既定は下段中央', null)
    ], null, 2));

    const zp = await context.newPage();
    await zp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await zp.waitForTimeout(2500);
    // 期待する字幕が実際に出るまで待ってから測る。行の有無だけで待つと、シーク直後の
    // 過渡状態（前の字幕が残っている）を拾って測定が入れ替わる
    const measure = async (sec, expectText) => {
      for (let attempt = 0; attempt < 16; attempt++) {
        await zp.evaluate(s => {
          const el = document.getElementById('seek');
          el.value = String(s);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, sec);
        await zp.waitForTimeout(450);
        const shown = await zp.evaluate(() =>
          (document.getElementById('caption-plate').textContent || '').trim());
        if (shown === expectText) break;
      }
      // 位置とテキストを同時に読む（別々に読むと取り違えに気づけない）
      return zp.evaluate(() => {
        const stage = document.getElementById('overlay-stage').getBoundingClientRect();
        const plate = document.getElementById('caption-plate');
        const line = plate.querySelector('.akari-caption__line');
        if (!line || !stage.width || !stage.height) return null;
        const r = line.getBoundingClientRect();
        return {
          text: (plate.textContent || '').trim(),
          cx: ((r.left + r.width / 2) - stage.left) / stage.width,
          cy: ((r.top + r.height / 2) - stage.top) / stage.height,
        };
      });
    };
    const right = await measure(2, '右上に出る字幕');
    const bottom = await measure(5, '既定は下段中央');
    if (!right || !bottom) {
      ng('Caption zone', `字幕を描画できなかった right=${JSON.stringify(right)} bottom=${JSON.stringify(bottom)}`);
    } else if (right.text !== '右上に出る字幕' || bottom.text !== '既定は下段中央') {
      // 期待した字幕が出ないまま測ると位置の合否が無意味になる。取り違えとして明示する
      ng('Caption zone', `想定と違う字幕を測った right="${right.text}" bottom="${bottom.text}"`);
    } else {
      right.cx > 0.55
        ? ok(`top-right renders on the right half (cx=${right.cx.toFixed(2)})`)
        : ng('Zone horizontal ignored', `top-right cx=${right.cx.toFixed(2)} (expected > 0.55)`);
      right.cy < 0.35
        ? ok(`top-right renders in the upper band (cy=${right.cy.toFixed(2)})`)
        : ng('Zone vertical', `cy=${right.cy.toFixed(2)}`);
      (Math.abs(bottom.cx - 0.5) < 0.12 && bottom.cy > 0.6)
        ? ok(`following default caption returns to bottom-center (cx=${bottom.cx.toFixed(2)}, cy=${bottom.cy.toFixed(2)})`)
        : ng('Zone carry-over', `default caption at cx=${bottom.cx.toFixed(2)} cy=${bottom.cy.toFixed(2)}`);
    }
    await zp.close();
    fs.rmSync(path.join(PROJECT, 'captions.json'), { force: true });
  } catch (e) { ng('Caption zone', e.message); }

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

  // ── PUT /api/overlay-html: 断片テキスト編集の書き戻し先 ──
  // 回帰: overlays[].html は契約上ファイル参照。マークアップを edit.json へマージすると
  // lint「html does not resolve to a regular file」で 422 になり、文字編集が永続化できなかった
  console.log('\n📝 Overlay html write-back endpoint');
  const editJsonPath = path.join(PROJECT, 'edit.json');
  try {
    const origText = fs.readFileSync(editJsonPath, 'utf8');
    const fragRel = 'overlays/test-frag.html';
    fs.mkdirSync(path.join(PROJECT, 'overlays'), { recursive: true });
    fs.writeFileSync(path.join(PROJECT, fragRel), '<div class="tf__root">元テキスト</div>\n');
    const withOverlay = JSON.parse(origText);
    withOverlay.overlays = [{ id: 'tf-1', html: fragRel, start: 0, duration: 2 }];
    fs.writeFileSync(editJsonPath, JSON.stringify(withOverlay, null, 2));

    const put1 = await fetch(`${BASE}/api/overlay-html`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'tf-1', html: '<div class="tf__root">書き換え後</div>' })
    });
    const written = fs.readFileSync(path.join(PROJECT, fragRel), 'utf8');
    (put1.ok && written.includes('書き換え後'))
      ? ok('overlay-html writes markup into the referenced fragment file')
      : ng('overlay-html write', `HTTP ${put1.status} content=${written.slice(0, 60)}`);
    const editAfter = JSON.parse(fs.readFileSync(editJsonPath, 'utf8'));
    editAfter.overlays[0].html === fragRel
      ? ok('edit.json keeps the file reference (no inline markup)')
      : ng('edit.json polluted', `overlays[0].html=${String(editAfter.overlays[0].html).slice(0, 60)}`);

    const put404 = await fetch(`${BASE}/api/overlay-html`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'no-such-overlay', html: '<div>x</div>' })
    });
    put404.status === 404
      ? ok('unknown overlay id is rejected with 404')
      : ng('unknown id', `expected 404 got ${put404.status}`);

    const evil = JSON.parse(origText);
    evil.overlays = [{ id: 'tf-1', html: '../outside.html', start: 0, duration: 2 }];
    fs.writeFileSync(editJsonPath, JSON.stringify(evil, null, 2));
    const put422 = await fetch(`${BASE}/api/overlay-html`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'tf-1', html: '<div>x</div>' })
    });
    put422.status === 422
      ? ok('path traversal outside the project is rejected with 422')
      : ng('traversal guard', `expected 422 got ${put422.status}`);

    fs.writeFileSync(editJsonPath, origText);
  } catch (e) {
    ng('Overlay html write-back', e.message);
  }

  // ── 座布団 block モード字幕（2 行でも 1 枚板）──
  // 回帰: Web UI の applyCaptionStyle が text_style.background を変数に落とさず、
  // block ラッパー（.akari-caption__block）も無かったため座布団が一切描かれなかった
  console.log('\n💺 Block-mode caption plate');
  try {
    const captionsPath = path.join(PROJECT, 'captions.json');
    const hadCaptions = fs.existsSync(captionsPath);
    const origCaptions = hadCaptions ? fs.readFileSync(captionsPath, 'utf8') : null;
    fs.writeFileSync(captionsPath, JSON.stringify([{
      id: 'c-block-1', start: 0.5, end: 3, edited: false,
      text: '一行目のテキスト\n二行目のテキスト',
      text_style: { size_px: 40, background: { color: '#101828', opacity: 0.7, radius_px: 14, mode: 'block' } }
    }]));
    const cp = await context.newPage();
    await cp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await cp.waitForTimeout(2000);
    await cp.evaluate(() => {
      const el = document.getElementById('seek');
      el.value = '1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await cp.waitForTimeout(600);
    const state = await cp.evaluate(() => {
      const block = document.querySelector('#caption-plate .akari-caption__block');
      if (!block) return { block: false };
      const bg = getComputedStyle(block).backgroundColor;
      const lines = [...block.querySelectorAll('.akari-caption__line')];
      return {
        block: true,
        bg,
        bgOpaque: /rgba?\(/.test(bg) && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)/.test(bg),
        lineCount: lines.length,
        linesTransparent: lines.every(l => /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)/.test(getComputedStyle(l).backgroundColor)),
      };
    });
    state.block
      ? ok('Block caption renders a single plate wrapper')
      : ng('Block caption wrapper missing', 'no .akari-caption__block in DOM');
    if (state.block) {
      state.bgOpaque
        ? ok(`Block plate has visible background (${state.bg})`)
        : ng('Block plate background', `transparent: ${state.bg}`);
      (state.lineCount >= 2 && state.linesTransparent)
        ? ok(`Lines share one plate (count=${state.lineCount}, per-line bg transparent)`)
        : ng('Block line structure', `count=${state.lineCount} transparent=${state.linesTransparent}`);
    }
    await cp.close();
    if (hadCaptions) fs.writeFileSync(captionsPath, origCaptions);
    else fs.unlinkSync(captionsPath);
    await page.waitForTimeout(400);
  } catch (e) {
    ng('Block-mode caption plate', e.message);
  }

  // ── レイヤー（ベイクテロップ / B-roll）のクリック選択 + ドラッグ移動 ──
  // 回帰: Web UI はレイヤーが pointer-events:none + 選択系未実装で、ベイクテロップを
  // 選択も移動もできなかった（実機報告）。shell CF-select と同じ transform 書き戻し契約
  console.log('\n🎞  Layer click-select + drag-move');
  try {
    const origText = fs.readFileSync(editJsonPath, 'utf8');
    const withLayer = JSON.parse(origText);
    withLayer.layers = [{ id: 'l-test', kind: 'video', src: 'source2.mp4', t: 0, duration: 3 }];
    fs.writeFileSync(editJsonPath, JSON.stringify(withLayer, null, 2));

    const lp = await context.newPage();
    await lp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await lp.waitForTimeout(2500);
    await lp.evaluate(() => {
      const el = document.getElementById('seek');
      el.value = '1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await lp.waitForTimeout(1200);
    const geom = await lp.evaluate(() => {
      const v = document.querySelector('#layer-container video[data-layer-id="l-test"]');
      if (!v) return null;
      const r = v.getBoundingClientRect();
      const w = document.getElementById('preview-wrapper').getBoundingClientRect();
      const cx = Math.max(w.left + 8, Math.min(w.right - 8, r.left + r.width / 2));
      const cy = Math.max(w.top + 8, Math.min(w.bottom - 8, r.top + r.height / 2));
      return { cx, cy, display: v.style.display, ready: v.readyState };
    });
    if (!geom || geom.display === 'none') {
      ng('Layer visible for interaction', `geom=${JSON.stringify(geom)}`);
    } else {
      await lp.mouse.click(geom.cx, geom.cy);
      await lp.waitForTimeout(300);
      const selected = await lp.evaluate(() =>
        document.querySelector('#layer-container video.layer-selected')?.dataset.layerId ?? null);
      selected === 'l-test'
        ? ok('Click selects the layer (outline class applied)')
        : ng('Layer click select', `selected=${selected}`);

      await lp.mouse.move(geom.cx, geom.cy);
      await lp.mouse.down();
      await lp.mouse.move(geom.cx + 50, geom.cy + 30, { steps: 6 });
      await lp.mouse.up();
      await lp.waitForTimeout(1200);
      const summaryAfter = await fetch(`${BASE}/api/summary`).then(r => r.json());
      const t = summaryAfter.layers?.[0]?.transform;
      (t && t.x > 10 && t.y > 5)
        ? ok(`Drag writes layers[].transform (x=${t.x.toFixed(1)}, y=${t.y.toFixed(1)})`)
        : ng('Layer drag write', `transform=${JSON.stringify(t)}`);

      await lp.keyboard.press('Escape');
      await lp.waitForTimeout(200);
      const afterEsc = await lp.evaluate(() =>
        !!document.querySelector('#layer-container video.layer-selected'));
      !afterEsc
        ? ok('Escape clears layer selection')
        : ng('Escape deselect', 'layer still selected');
    }
    await lp.close();
    fs.writeFileSync(editJsonPath, origText);
    await page.waitForTimeout(500);
  } catch (e) {
    ng('Layer click-select + drag', e.message);
  }

  // ── layers[].perspective の実機パリティ（contract-2026-08-02-preview-parity.md §2.4.4）──
  // 実ブラウザが書き込んだ matrix3d が、同じ box（実測 videoWidth/Height × crop）から
  // computeLayerPerspectiveVisual を独立に呼んだ参照値と数値一致することを確認する
  // （L1: render-cut のホモグラフィ計算とプレビュー側の描画計算のドリフト検知）。
  console.log('\n🪞 layers[].perspective real-browser parity');
  try {
    const origText = fs.readFileSync(editJsonPath, 'utf8');
    const withPerspective = JSON.parse(origText);
    const corners = [[0.1, 0], [0.9, 0], [0, 1], [1, 1]];
    const crop = { x: 0.1, y: 0.05, w: 0.8, h: 0.9 };
    withPerspective.layers = [{
      id: 'l-perspective-test', kind: 'video', src: 'source2.mp4', t: 0, duration: 3,
      crop, perspective: { corners },
    }];
    fs.writeFileSync(editJsonPath, JSON.stringify(withPerspective, null, 2));

    const pp = await context.newPage();
    await pp.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await pp.waitForTimeout(2500);
    const state = await pp.evaluate(() => {
      const v = document.querySelector('#layer-container video[data-layer-id="l-perspective-test"]');
      if (!v) return null;
      return {
        transform: v.style.transform,
        computedTransform: getComputedStyle(v).transform,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        cropW: Number(v.dataset.layerCropW),
        cropH: Number(v.dataset.layerCropH),
      };
    });
    if (!state || !(state.videoWidth > 0)) {
      ng('perspective real-browser parity', `layer/video not ready: ${JSON.stringify(state)}`);
    } else {
      const expected = computeLayerPerspectiveVisual(
        { corners },
        state.cropW * state.videoWidth,
        state.cropH * state.videoHeight,
      );
      // 実ブラウザは el.style.transform の読み戻し時に CSSOM がカンマ後へ空白を挿入して
      // 正規化する（値そのものは変わらない）ため、比較前に空白を除去する。
      const normalize = (s) => (s || '').replace(/\s+/g, '');
      const hasMatrix3d = expected && normalize(state.transform).includes(normalize(expected.transformFunction));
      hasMatrix3d
        ? ok(`app.js writes the exact matrix3d computeLayerPerspectiveVisual predicts from the real (browser-measured) video box (${state.videoWidth}x${state.videoHeight}, crop ${state.cropW}x${state.cropH})`)
        : ng('perspective matrix3d matches reference', `actual=${state.transform} expected substring=${expected?.transformFunction}`);
      // getComputedStyle 経由でも 'none' になっていない（ブラウザが matrix3d 構文を実際に
      // 受理し、identity ではない非自明な変換として適用していること）ことも確認する。
      state.computedTransform !== 'none' && state.computedTransform !== ''
        ? ok('getComputedStyle reports a non-trivial applied transform (browser accepted the matrix3d syntax)')
        : ng('getComputedStyle transform', `computedTransform=${state.computedTransform}`);
    }
    await pp.close();
    fs.writeFileSync(editJsonPath, origText);
    await page.waitForTimeout(500);
  } catch (e) {
    ng('perspective real-browser parity', e.message);
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
