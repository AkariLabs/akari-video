import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  connectMain, evalMain, screenshot, waitForDropzone,
  toggleDeveloperModeViaSettings, realClick
} from './cdp-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function findAndClickActivityIcon(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (state.found) { await realClick(cdp, state.x, state.y); await sleep(500); }
  return state;
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});
  await sleep(1500);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '00-boot.png'));

  let dz = await waitForDropzone(cdp, 8000);
  if (!dz.found) {
    // akari.developerMode can default to true in this environment (also observed in
    // 2026-07-21-home-flow) — that shows the standard Explorer (.theia-TreeNode rows)
    // instead of our widget. Toggling the icon in that case just collapses/expands
    // Explorer, so check which situation we're in (retrying briefly in case either
    // widget is still mid-attach) before picking a fix.
    let explorerRows = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      explorerRows = await evalMain(cdp, `document.querySelectorAll('.theia-TreeNode').length`);
      if (explorerRows > 0) break;
      await sleep(500);
      dz = await waitForDropzone(cdp, 500);
      if (dz.found) break;
    }
    record('dropzone-not-immediately-visible', { explorerRows, dzFoundWhilePolling: dz.found });
    if (!dz.found) {
      if (explorerRows > 0) {
        await toggleDeveloperModeViaSettings(cdp);
      } else {
        await findAndClickActivityIcon(cdp);
      }
      dz = await waitForDropzone(cdp, 6000);
    }
  }
  if (!dz.found) {
    record('dropzone-still-missing-trying-developer-mode-toggle', {});
    await toggleDeveloperModeViaSettings(cdp);
    dz = await waitForDropzone(cdp, 6000);
  }
  if (!dz.found) fail('material dropzone widget never became visible', dz);
  record('dropzone-visible', dz);

  // materials load asynchronously (FileService round-trip to read assets/ + analysis.json
  // sidecars) — poll past the "読み込み中…" state before asserting on card contents.
  for (let attempt = 0; attempt < 15; attempt++) {
    const stillLoading = await evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      return root ? root.textContent.includes('読み込み中') : true;
    })()`);
    if (!stillLoading) break;
    await sleep(400);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-materials-tab-initial.png'));

  const materialsState = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')).map(t => t.textContent.trim());
    const cardEls = Array.from(root.querySelectorAll('div')).filter(d => d.title && (d.title.endsWith('.mp4') || d.title.endsWith('.wav') || d.title.endsWith('.png')));
    const details = cardEls.map(el => {
      const img = el.querySelector('img');
      const durationSpan = Array.from(el.querySelectorAll('span')).find(s => /^\\d+:\\d{2}$|^--:--$/.test(s.textContent.trim()));
      const dot = el.querySelector('span[title="分析済み"], span[title="未分析"]');
      return {
        title: el.title, hasImg: !!img, imgSrc: img ? img.src : null,
        duration: durationSpan ? durationSpan.textContent.trim() : null,
        dotTitle: dot ? dot.getAttribute('title') : null
      };
    });
    return {
      tabs, cardCount: cardEls.length, details, wholeText: root.textContent,
      lintBadgeText: (() => {
        const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
        return btn ? btn.textContent.trim() : null;
      })()
    };
  })()`);
  record('materials-tab-state', materialsState);

  if (!materialsState.tabs.includes('素材') || !materialsState.tabs.includes('プラン') || !materialsState.tabs.includes('カタログ')) {
    fail('expected 3 tabs (素材/プラン/カタログ) not all present', materialsState.tabs);
  }
  if (materialsState.cardCount !== 2) {
    fail('expected exactly 2 material cards (analyzed-clip.mp4 + unanalyzed-clip.mp4)', materialsState);
  }
  const analyzed = materialsState.details.find(d => d.title === 'analyzed-clip.mp4');
  const unanalyzed = materialsState.details.find(d => d.title === 'unanalyzed-clip.mp4');
  if (!analyzed || !analyzed.hasImg || !/frame-01\.jpg/.test(analyzed.imgSrc) || analyzed.duration !== '0:06' || analyzed.dotTitle !== '分析済み') {
    fail('analyzed-clip.mp4 card did not show expected thumbnail/duration(0:06)/analyzed-dot', analyzed);
  }
  if (!unanalyzed || unanalyzed.hasImg || unanalyzed.duration !== '--:--' || unanalyzed.dotTitle !== '未分析') {
    fail('unanalyzed-clip.mp4 card did not show expected placeholder/duration(--:--)/unanalyzed-dot', unanalyzed);
  }
  for (const noisy of ['.DS_Store', 'marker.txt', '.akari', '.claude', 'workflow.json', 'intake.json']) {
    if (materialsState.wholeText.includes(noisy)) fail(`noise text "${noisy}" leaked into the material browser widget`, { noisy });
  }
  record('noise-invisible-confirmed', { ok: true });

  // The lint badge resolves asynchronously (backend spawns the edit-lint CLI as a child
  // process) — poll a bit past the initial materials-tab-state read before asserting.
  let lintBadgeText = materialsState.lintBadgeText;
  for (let attempt = 0; attempt < 15 && !lintBadgeText; attempt++) {
    await sleep(400);
    lintBadgeText = await evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
      return btn ? btn.textContent.trim() : null;
    })()`);
  }
  if (!/Lint/.test(lintBadgeText || '') || !/0\s*件/.test(lintBadgeText || '')) {
    fail('lint badge did not show "0 件" for the 0-finding fixture edit.json', lintBadgeText);
  }
  record('lint-badge-zero-confirmed', { text: lintBadgeText });
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-materials-cards.png'));
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-noise-invisible.png'));

  const clickTab = (label) => evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const btn = Array.from(root.querySelectorAll('[role="tab"]')).find(b => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);

  const planClick = await clickTab('プラン');
  if (!planClick.found) fail('plan tab button not found', planClick);
  await sleep(200);
  const planState = await evalMain(cdp, `(() => ({ text: document.querySelector('[data-akari-dropzone]').textContent }))()`);
  record('plan-tab-state', planState);
  if (!planState.text.includes('今後この場所')) fail('plan tab did not show expected empty-state description', planState);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-plan-tab-empty.png'));

  const catalogClick = await clickTab('カタログ');
  if (!catalogClick.found) fail('catalog tab button not found', catalogClick);
  await sleep(200);
  const catalogState = await evalMain(cdp, `(() => ({ text: document.querySelector('[data-akari-dropzone]').textContent }))()`);
  record('catalog-tab-state', catalogState);
  if (!catalogState.text.includes('今後この場所')) fail('catalog tab did not show expected empty-state description', catalogState);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-catalog-tab-empty.png'));

  const backToMaterials = await clickTab('素材');
  if (!backToMaterials.found) fail('materials tab button not found when switching back', backToMaterials);
  await sleep(200);

  record('ALL-PASS-PHASE1', { ok: true });
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
