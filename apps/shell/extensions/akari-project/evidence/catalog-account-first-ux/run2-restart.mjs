// Run2-restart: run2.mjs と同一の THEIA_CONFIG_DIR / --user-data-dir で再起動し、
// ピッカーを一切操作せず preference 永続を実測する（L1 受け入れ条件 3「再起動後も有効」）。
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter,
  ensureRoleBucketsWidgetVisible, clickCatalogTab,
  bodyInnerText, catalogItemCount, emptyStateInfo, catalogItemStates,
  readPreferenceViaProductionApi,
  waitFor
} from './widget-lib.mjs';

const [, , cdpPortArg, evidenceDirArg, expectedFolderArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;
const EXPECTED_FOLDER = expectedFolderArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);
  await ensureRoleBucketsWidgetVisible(cdp);

  const pref = await readPreferenceViaProductionApi(cdp, 'akari.catalog.root');
  record('restart:preference-readback', pref);
  if (pref.value !== EXPECTED_FOLDER) fail('preference did not survive the restart', pref);

  await clickCatalogTab(cdp);
  const counts = await waitFor(
    () => catalogItemCount(cdp),
    count => typeof count === 'number' && count > 0,
    15000
  );
  record('restart:item-count', { itemCount: counts });
  if (!(typeof counts === 'number' && counts > 0)) fail('local catalog cards did not reappear after restart without touching the picker', { counts });

  const empty = await emptyStateInfo(cdp);
  if (empty.present) fail('empty state should not show once the persisted local catalog resolves', empty);

  const states = await catalogItemStates(cdp);
  const localCount = states.filter(s => s.state === 'local').length;
  record('restart:item-states', { total: states.length, localCount });
  if (localCount === 0) fail('no local-origin cards found after restart', {});

  const text = await bodyInnerText(cdp);
  const leaks = { unresolvedMessage: text.includes('カタログの場所が未設定'), preferenceKey: text.includes('akari.catalog.root') };
  record('restart:leak-check', leaks);
  if (leaks.unresolvedMessage || leaks.preferenceKey) fail('internal wording leaked after restart with the developer panel closed', leaks);

  await screenshot(cdp, path.join(EVIDENCE_DIR, '16-restart-persisted-cards.png'));
  await writeFile(path.join(EVIDENCE_DIR, 'run2-restart-log.json'), JSON.stringify(log, null, 2));
  console.log('RUN2_RESTART_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('RUN2_RESTART_FAILED', error);
  process.exit(1);
});
