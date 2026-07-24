import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, waitForDropzone, screenshot } from './cdp-lib.mjs';

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
  await screenshot(cdp, path.join(EVIDENCE_DIR, '90-gate-boot.png'));

  const dropzone = await waitForDropzone(cdp, 5000);
  record('gate-dropzone-state', dropzone);
  if (dropzone.found) {
    fail('material dropzone widget attached even though .akari/intake.json is not submitted (home-flow gate regression)', dropzone);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '91-gate-locked.png'));
  record('gate-confirmed-locked', { ok: true });

  await writeFile(path.join(EVIDENCE_DIR, 'run-log-gate.json'), JSON.stringify(log, null, 2));
  console.log('SUCCESS: gate check passed (stays locked without submitted intake.json).');
  cdp.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FAILED', err);
  await writeFile(path.join(EVIDENCE_DIR, 'run-log-gate-FAILED.json'), JSON.stringify(log, null, 2)).catch(() => {});
  process.exit(1);
});
