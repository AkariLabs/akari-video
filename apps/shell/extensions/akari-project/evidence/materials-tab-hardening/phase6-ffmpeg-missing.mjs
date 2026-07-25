// materials-tab-hardening L1 phase6: ffmpeg を PATH から外した環境で起動 →
// プレースホルダ運用へ黙ってフォールバックし、console error 0 のまま動作することを実測する。
// 別 Electron インスタンス（stripped PATH）に対して実行する。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot, ensureDeveloperModeOff } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, workspaceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const WORKSPACE_DIR = workspaceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function installErrorCounter(cdp) {
  await evalMain(cdp, `(() => {
    window.__errCount = 0;
    window.__errLog = [];
    const orig = console.error;
    console.error = (...args) => { window.__errCount++; window.__errLog.push(String(args[0]).slice(0, 300)); orig(...args); };
    window.addEventListener('error', (e) => { window.__errCount++; window.__errLog.push('window.error: ' + (e.message || '')); });
    window.addEventListener('unhandledrejection', (e) => { window.__errCount++; window.__errLog.push('unhandledrejection: ' + String(e.reason).slice(0, 300)); });
    return true;
  })()`);
}
async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }
async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }

async function clickRoleBucketsTab(cdp) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === '素材');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('materials tab not found', state);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function cardThumbnailState(cdp, relativePath) {
  return evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-material-path=${JSON.stringify(relativePath)}]');
    if (!card) return { found: false };
    const img = card.querySelector('img');
    const icon = card.querySelector('.codicon-device-camera-video, .codicon-file-media');
    return { found: true, hasImg: !!img, hasPlaceholderIcon: !!icon };
  })()`);
}

async function waitForCard(cdp, relativePath, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await evalMain(cdp, `!!document.querySelector('[data-akari-material-path=${JSON.stringify(relativePath)}]')`);
    if (last) return true;
    await sleep(300);
  }
  return false;
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(2500);
  await installErrorCounter(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '17-ffmpeg-missing-boot.png'));

  const devMode = await ensureDeveloperModeOff(cdp);
  record('developer-mode-forced-off', devMode);
  await clickRoleBucketsTab(cdp);

  await waitForCard(cdp, 'assets/unanalyzed-video-nocache.mp4', 8000);
  await sleep(1500); // hydrateCachedThumbnails の非同期解決を待つ（生成失敗 → プレースホルダ確定まで）

  const video = await cardThumbnailState(cdp, 'assets/unanalyzed-video-nocache.mp4');
  const image = await cardThumbnailState(cdp, 'assets/unanalyzed-image-nocache.png');
  record('fallback-thumbnail-state', { video, image });
  if (!video.found || video.hasImg || !video.hasPlaceholderIcon) {
    fail('unanalyzed video did not fall back to a placeholder icon when ffmpeg is unavailable', video);
  }
  if (!image.found || image.hasImg || !image.hasPlaceholderIcon) {
    fail('unanalyzed image did not fall back to a placeholder icon when ffmpeg is unavailable', image);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '18-ffmpeg-missing-placeholder.png'));
  record('L1-4-ffmpeg-missing-placeholder-PASS', { ok: true });

  // 既存の分析済みカード（analysis keyframe）は ffmpeg 不在でも従来どおり動く（回帰なし）。
  const analyzed = await cardThumbnailState(cdp, 'assets/analyzed-clip.mp4');
  record('analyzed-clip-still-works', analyzed);
  if (!analyzed.hasImg) {
    fail('analyzed-clip.mp4 lost its analysis-keyframe thumbnail when ffmpeg is unavailable (unexpected regression)', analyzed);
  }

  // 生成失敗はキャッシュへ書き込まれていないことを確認（.akari/cache/ 以外は当然書かない、
  // かつ 失敗した生成物を偽って置かない）。
  const cacheDir = path.join(WORKSPACE_DIR, '.akari', 'cache', 'thumbnails');
  const cacheFiles = await readdir(cacheDir).catch(() => []);
  record('cache-dir-after-fallback', { count: cacheFiles.length });

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = finalErrCount ? await errorLog(cdp) : [];
  record('phase6-final-error-count', { finalErrCount, finalErrLog });
  if (finalErrCount !== 0) {
    fail('console errors observed while ffmpeg was unavailable (expected silent fallback, 0 errors)', { finalErrCount, finalErrLog });
  }
  record('L1-4-ffmpeg-missing-console-error-zero-PASS', { ok: true });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase6.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase6 (ffmpeg missing fallback) checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase6-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
