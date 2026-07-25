// L1-3(後半): preference 書き込み後にアプリを完全終了 → 同じ隔離プロファイル
// （同一 THEIA_CONFIG_DIR / --user-data-dir）で再起動 → ピッカーを一切操作せず
// カードが並ぶことを実測する（永続の実証）。scenario2 が書き込んだ preference を
// このプロセス自身は一切いじらない（読み取り専用）。
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

async function ensureRoleBucketsWidgetVisible(cdp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const visible = await evalMain(cdp, `(() => {
      const el = Array.from(document.querySelectorAll('[role="tab"]')).find(e => e.textContent.trim() === 'カタログ');
      if (!el) return false;
      const r = el.getBoundingClientRect();
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

async function clickCatalogTab(cdp) {
  const state = await evalMain(cdp, `(() => {
    const tablist = Array.from(document.querySelectorAll('[role="tablist"]'))
      .find(list => Array.from(list.querySelectorAll('[role="tab"]')).some(t => t.textContent.trim() === 'カタログ'));
    if (!tablist) return { found: false, reason: 'tablist-not-found' };
    const el = Array.from(tablist.querySelectorAll('[role="tab"]')).find(t => t.textContent.trim() === 'カタログ');
    if (!el) return { found: false, reason: 'tab-not-found' };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) fail('catalog tab button not found', state);
  await realClick(cdp, state.x, state.y);
  await sleep(500);
}

async function catalogCounts(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-item-count]');
    if (!el) return { found: false };
    return {
      found: true,
      itemCount: Number(el.getAttribute('data-akari-catalog-item-count')),
      missingCount: Number(el.getAttribute('data-akari-catalog-missing-count'))
    };
  })()`);
}

async function waitFor(predicate, timeoutMs, pollFn) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await pollFn();
    if (predicate(last)) return last;
    await sleep(300);
  }
  return last;
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1000);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  await ensureRoleBucketsWidgetVisible(cdp);
  await clickCatalogTab(cdp);

  // ピッカーには一切触れない。preference は前回プロセス終了時点の値のまま読まれるはず。
  const noPickerButtonPresent = await evalMain(cdp, `!Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'フォルダを選ぶ')`);
  const counts = await waitFor(c => c.found && c.itemCount > 0, 8000, () => catalogCounts(cdp));
  record('restart-catalog-state', { counts, noPickerButtonPresent });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-restart-cards.png'));

  if (!counts?.found || !(counts.itemCount > 0)) {
    fail('catalog did not resolve automatically after restart (preference did not persist)', counts);
  }
  if (!noPickerButtonPresent) {
    fail('empty-state picker button was still present after restart (persisted preference was not read)', { noPickerButtonPresent });
  }
  record('L1-3-restart-persistence-PASS', { ok: true, itemCount: counts.itemCount, missingCount: counts.missingCount });

  await writeFile(path.join(EVIDENCE_DIR, 'scenario3-log.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: scenario3 (restart persistence) passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'scenario3-log-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
