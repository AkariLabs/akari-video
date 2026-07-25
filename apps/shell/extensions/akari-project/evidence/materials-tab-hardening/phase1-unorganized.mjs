// materials-tab-hardening L1 phase1: 起動 + 未整理セクションの初期表示実測
// (L1-1: ルート直下 mp4/png/wav が「未整理」バッジ付きで表示、.akari/edit.json/exports 除外)
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

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

// [role="tab"] は左サイドの activity bar タブ（'素材' というタイトルを持つ非表示要素含む）でも
// 使われており、同名テキストが複数箇所に存在しうる（catalog-tab run-l1.mjs の precedent 注記）。
// 誤って幅0の別要素を掴まないよう、'カタログ' という一意な兄弟タブを含むタブリストで判定する。
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

async function clickRoleBucketsTab(cdp, label) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false, reason: 'tablist-not-found' };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === ${JSON.stringify('素材')});
    if (!el) return { found: false, reason: 'tab-not-found' };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('role-buckets tab button not found', { label, state });
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function materialCards(cdp) {
  return evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-material-path]')).map(el => ({
    path: el.getAttribute('data-akari-material-path'),
    unorganized: el.getAttribute('data-akari-material-unorganized') === 'true',
    text: el.textContent
  }))`);
}

async function unorganizedCount(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-unorganized-count]');
    return el ? Number(el.getAttribute('data-akari-unorganized-count')) : null;
  })()`);
}

async function waitFor(fn, predicate, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(2500);
  await installErrorCounter(cdp);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickRoleBucketsTab(cdp, '素材');
  await sleep(1000);

  const cards = await waitFor(() => materialCards(cdp), c => c.length >= 5, 10000);
  record('material-cards', { count: cards.length, cards });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-materials-tab-initial.png'));

  const unorganized = cards.filter(c => c.unorganized);
  const unorganizedPaths = unorganized.map(c => c.path).sort();
  record('l1-1-unorganized-cards', { unorganizedPaths });

  const expected = ['clip.mp4', 'frame-01.png', 'narration.wav'].sort();
  if (JSON.stringify(unorganizedPaths) !== JSON.stringify(expected)) {
    fail('unorganized section did not show exactly the expected 3 root files', { unorganizedPaths, expected });
  }
  const count = await unorganizedCount(cdp);
  if (count !== 3) {
    fail('data-akari-unorganized-count did not equal 3', { count });
  }
  record('L1-1-unorganized-count-PASS', { ok: true, count });

  // edit.json / exports/ 内のファイルは一切カードとして出ない（未整理としても assets としても）
  const allPaths = cards.map(c => c.path);
  if (allPaths.some(p => p === 'edit.json' || p.startsWith('exports/') || p.startsWith('.akari/'))) {
    fail('edit.json / exports/ / .akari/ leaked into material cards', { allPaths });
  }
  record('L1-1-noise-excluded-PASS', { ok: true, allPaths });

  // 未整理バッジのテキストが実際に描画されている
  const badgeText = await evalMain(cdp, `(() => {
    const card = document.querySelector('[data-akari-material-path="clip.mp4"]');
    return card ? card.textContent : null;
  })()`);
  record('unorganized-badge-text', { badgeText });
  if (!badgeText || !badgeText.includes('未整理') || !badgeText.includes('assets へ移動')) {
    fail('unorganized card missing 未整理 badge text or move button label', { badgeText });
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-unorganized-badges.png'));
  record('L1-1-badge-and-button-PASS', { ok: true });

  const errCount = await errorCount(cdp);
  record('phase1-error-count', { errCount, errLog: errCount ? await errorLog(cdp) : [] });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase1.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase1 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase1-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
