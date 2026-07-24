import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { connectMain, evalMain, screenshot } from './cdp-lib.mjs';

const [, , cdpPortArg, workspaceDirArg, evidenceDirArg, dropSourcesDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const WORKSPACE_DIR = workspaceDirArg;
const EVIDENCE_DIR = evidenceDirArg;
const DROP_SOURCES_DIR = dropSourcesDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }
async function sha256(filePath) { return createHash('sha256').update(await readFile(filePath)).digest('hex'); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  record('connected-main', {});

  const editJsonPath = path.join(WORKSPACE_DIR, 'edit.json');
  const shaBefore = await sha256(editJsonPath);
  record('edit-json-sha-before-drops', { sha256: shaBefore });

  async function dispatchUriListDrop(absSourcePath) {
    const fileUrl = 'file://' + absSourcePath;
    return evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const dt = new DataTransfer();
      dt.setData('text/uri-list', ${JSON.stringify(fileUrl)});
      const event = new DragEvent('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      root.dispatchEvent(event);
      return true;
    })()`);
  }

  async function countCardsAndFiles() {
    return evalMain(cdp, `(() => {
      const root = document.querySelector('[data-akari-dropzone]');
      const cardEls = Array.from(root.querySelectorAll('div')).filter(d => d.title && (d.title.endsWith('.mp4') || d.title.endsWith('.wav') || d.title.endsWith('.png') || d.title.endsWith('.txt')));
      return { titles: cardEls.map(e => e.title) };
    })()`);
  }

  const dropCases = [
    { file: 'drop-video.mp4', supported: true },
    { file: 'drop-audio.wav', supported: true },
    { file: 'drop-image.png', supported: true },
    { file: 'drop-doc.txt', supported: false }
  ];

  for (const dropCase of dropCases) {
    const sourcePath = path.join(DROP_SOURCES_DIR, dropCase.file);
    const sourceStat = await stat(sourcePath);
    await dispatchUriListDrop(sourcePath);
    await sleep(1200);
    const after = await countCardsAndFiles();
    record(`drop-${dropCase.file}`, { supported: dropCase.supported, cardsAfter: after.titles });

    if (dropCase.supported) {
      if (!after.titles.includes(dropCase.file)) fail(`expected a new material card for dropped file ${dropCase.file}`, after);
      const destPath = path.join(WORKSPACE_DIR, 'assets', dropCase.file);
      const destStat = await stat(destPath).catch(() => undefined);
      if (!destStat || destStat.size !== sourceStat.size) fail(`dropped file ${dropCase.file} was not copied into assets/ with matching size`, { sourceSize: sourceStat.size, destStat });
      record(`drop-${dropCase.file}-copy-verified`, { destPath, size: destStat.size });
    } else {
      if (after.titles.includes(dropCase.file)) fail(`unsupported file ${dropCase.file} unexpectedly produced a material card`, after);
      const destPath = path.join(WORKSPACE_DIR, 'assets', dropCase.file);
      const destStat = await stat(destPath).catch(() => undefined);
      if (destStat) fail(`unsupported file ${dropCase.file} was unexpectedly copied into assets/`, destStat);
      const toast = await evalMain(cdp, `(() => Array.from(document.querySelectorAll('.theia-notification-message')).map(n => n.textContent.trim()))()`);
      record('reject-toast-messages', { toast });
      if (!toast.some(text => /対応していない|取り込めません/.test(text))) fail('no reject toast text found for unsupported drop', toast);
    }
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-after-drops.png'));

  const shaAfter = await sha256(editJsonPath);
  record('edit-json-sha-after-drops', { sha256: shaAfter });
  if (shaBefore !== shaAfter) fail('edit.json changed as a side effect of dropping assets (must stay byte-identical)', { shaBefore, shaAfter });
  record('edit-json-unchanged-confirmed', { ok: true });

  const lintClick = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
    if (!btn) return { found: false };
    btn.click();
    return { found: true };
  })()`);
  record('lint-badge-clicked', lintClick);
  await sleep(800);
  const lintAfterClick = await evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-dropzone]');
    const btn = Array.from(root.querySelectorAll('button')).find(b => b.textContent.includes('Lint'));
    return btn ? btn.textContent.trim() : null;
  })()`);
  record('lint-badge-after-reclick', { text: lintAfterClick });
  if (!/0\s*件/.test(lintAfterClick || '')) fail('lint badge did not still show 0 件 after manual re-run click', lintAfterClick);

  record('ALL-PASS-PHASE2', { ok: true });
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase2.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: phase2 checks passed.');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-phase2-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
