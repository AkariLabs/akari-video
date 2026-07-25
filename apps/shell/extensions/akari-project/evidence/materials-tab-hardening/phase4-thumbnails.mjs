// materials-tab-hardening L1 phase4: 未分析サムネキャッシュの優先順位実測
// (analysis keyframe > .akari/cache/thumbnails/ > プレースホルダ)。console error 0 も確認。
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

async function errorCount(cdp) { return evalMain(cdp, 'window.__errCount'); }
async function errorLog(cdp) { return evalMain(cdp, 'window.__errLog || []'); }

async function ensureRoleBucketsWidgetVisible(cdp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const visible = await evalMain(cdp, `(() => {
      const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
        .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
      if (!tablist) return false;
      const r = tablist.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })()`);
    if (visible) return;
    const icon = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!icon) fail('files activity icon not found', {});
    await realClick(cdp, icon.x, icon.y);
    await sleep(600);
  }
  fail('role-buckets widget did not become visible after toggling the files activity icon', {});
}

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

async function cardThumbnailSrc(cdp, relativePath) {
  return evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-material-path=${JSON.stringify(relativePath)}]');
    if (!card) return { found: false };
    const img = card.querySelector('img');
    return { found: true, hasImg: !!img, src: img ? img.getAttribute('src') : null };
  })()`);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(500);
  const devMode = await ensureDeveloperModeOff(cdp);
  record('developer-mode-forced-off', devMode);
  await clickRoleBucketsTab(cdp);
  await sleep(500);

  // === analysis keyframe が優先される（分析済み） ===
  const analyzed = await cardThumbnailSrc(cdp, 'assets/analyzed-clip.mp4');
  record('analyzed-clip-thumbnail', analyzed);
  if (!analyzed.found || !analyzed.hasImg || !analyzed.src?.includes('.akari/sidecars/') || !analyzed.src?.includes('keyframe-01.png')) {
    fail('analyzed-clip.mp4 did not use the analysis keyframe as its thumbnail', analyzed);
  }
  record('L1-4-analysis-keyframe-priority-PASS', { ok: true });

  // === 未分析動画/画像は .akari/cache/thumbnails/ の ffmpeg 生成サムネを使う ===
  const unanalyzedVideo = await cardThumbnailSrc(cdp, 'assets/unanalyzed-video.mp4');
  const unanalyzedImage = await cardThumbnailSrc(cdp, 'assets/unanalyzed-image.png');
  record('unanalyzed-thumbnails', { unanalyzedVideo, unanalyzedImage });
  if (!unanalyzedVideo.hasImg || !unanalyzedVideo.src?.includes('.akari/cache/thumbnails/')) {
    fail('unanalyzed-video.mp4 did not resolve a .akari/cache/thumbnails/ thumbnail', unanalyzedVideo);
  }
  if (!unanalyzedImage.hasImg || !unanalyzedImage.src?.includes('.akari/cache/thumbnails/')) {
    fail('unanalyzed-image.png did not resolve a .akari/cache/thumbnails/ thumbnail', unanalyzedImage);
  }
  record('L1-4-cache-thumbnail-priority-PASS', { ok: true });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '12-thumbnail-priority.png'));

  // === 実ファイルが .akari/cache/thumbnails/ に実在する ===
  const cacheDir = path.join(WORKSPACE_DIR, '.akari', 'cache', 'thumbnails');
  const cacheFiles = await readdir(cacheDir).catch(() => []);
  record('cache-dir-listing', { cacheDir, cacheFiles });
  if (cacheFiles.length < 2) {
    fail('.akari/cache/thumbnails/ did not contain the expected generated thumbnail files', { cacheFiles });
  }
  record('L1-4-cache-files-on-disk-PASS', { ok: true, count: cacheFiles.length });

  // === console error 0（サムネ関連） ===
  const finalErrCount = await errorCount(cdp);
  const finalErrLog = finalErrCount ? await errorLog(cdp) : [];
  record('phase4-final-error-count', { finalErrCount, finalErrLog });
  if (finalErrCount !== 0) {
    fail('console errors observed during thumbnail hydration (expected 0)', { finalErrCount, finalErrLog });
  }
  record('L1-4-console-error-zero-PASS', { ok: true });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase4.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase4 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase4-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
