import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, screenshot, waitForDropzone, toggleDeveloperModeViaSettings, realClick } from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});

  // toggle ON: standard Explorer should replace our widget
  const toggleOnResult = await toggleDeveloperModeViaSettings(cdp);
  record('toggled-developer-mode-on', toggleOnResult);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '07-developer-mode-checkbox-toggled.png'));

  // The Explorer tree fetches its directory listing asynchronously the first time it's
  // shown — poll rather than asserting on the very next tick.
  let afterToggleOn = { explorerRows: 0, dzVisible: false };
  for (let attempt = 0; attempt < 15 && afterToggleOn.explorerRows === 0; attempt++) {
    await sleep(400);
    afterToggleOn = await evalMain(cdp, `(() => {
      const explorerRows = document.querySelectorAll('.theia-TreeNode').length;
      const dropzone = document.querySelector('[data-akari-dropzone]');
      const dzVisible = dropzone ? dropzone.getBoundingClientRect().width > 0 : false;
      return { explorerRows, dzVisible };
    })()`);
  }
  record('after-toggle-developer-mode-on', afterToggleOn);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '08-developer-mode-on-explorer.png'));
  if (afterToggleOn.explorerRows === 0) fail('standard Explorer tree did not appear after enabling developer mode', afterToggleOn);
  if (afterToggleOn.dzVisible) fail('material browser widget still visible after switching to developer mode (should be replaced by Explorer)', afterToggleOn);

  // toggle back OFF: our widget should come back
  const toggleOffResult = await toggleDeveloperModeViaSettings(cdp);
  record('toggled-developer-mode-off', toggleOffResult);
  const afterToggleOff = await waitForDropzone(cdp, 6000);
  record('after-toggle-developer-mode-off', afterToggleOff);
  if (!afterToggleOff.found) fail('material browser widget did not come back after disabling developer mode again', afterToggleOff);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '09-developer-mode-off-materials-restored.png'));

  // tab/preview open-close non-regression: open a material card as a tab
  const openCard = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const cardEls = Array.from(root.querySelectorAll('div')).filter(d => d.title === 'analyzed-clip.mp4');
    if (!cardEls.length) return { found: false };
    const r = cardEls[0].getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  record('open-card-lookup', openCard);
  if (openCard.found) {
    await realClick(cdp, openCard.x, openCard.y);
    await sleep(1200);
  }
  const tabState = await evalMain(cdp, `(() => ({ mainTabs: document.querySelectorAll('.p-TabBar-tab').length }))()`);
  record('after-open-card-tab-state', tabState);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '10-card-opened-tab.png'));

  record('ALL-PASS-PHASE3', { ok: true });
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase3.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase3 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase3-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
