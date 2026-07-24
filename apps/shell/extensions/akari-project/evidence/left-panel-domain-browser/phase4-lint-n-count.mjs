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
  await sleep(1500);

  let dz = await waitForDropzone(cdp, 8000);
  if (!dz.found) {
    const explorerRows = await evalMain(cdp, `document.querySelectorAll('.theia-TreeNode').length`);
    record('dropzone-not-immediately-visible', { explorerRows });
    if (explorerRows > 0) {
      await toggleDeveloperModeViaSettings(cdp);
    } else {
      const icon = await evalMain(cdp, `(() => {
        const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (icon.found) await realClick(cdp, icon.x, icon.y);
    }
    dz = await waitForDropzone(cdp, 6000);
  }
  if (!dz.found) {
    await toggleDeveloperModeViaSettings(cdp);
    dz = await waitForDropzone(cdp, 6000);
  }
  if (!dz.found) fail('material dropzone widget never became visible', dz);
  record('dropzone-visible', dz);

  let lintBadgeText = null;
  for (let attempt = 0; attempt < 15 && !lintBadgeText; attempt++) {
    await sleep(400);
    lintBadgeText = await evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
      return btn ? btn.textContent.trim() : null;
    })()`);
  }
  record('lint-badge-text', { text: lintBadgeText });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '92-lint-badge-n-count.png'));
  if (!/1\s*件/.test(lintBadgeText || '')) {
    fail('lint badge did not show "1 件" for the 1-finding fixture edit.json', lintBadgeText);
  }
  record('ALL-PASS-PHASE4', { ok: true });
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase4.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase4 (lint N-count) check passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase4-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
