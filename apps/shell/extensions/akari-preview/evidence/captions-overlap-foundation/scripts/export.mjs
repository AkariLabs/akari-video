import { exportWithOsr } from '../../../../../../../packages/osr-export/src/index.mjs';
import { resolveElectronLauncher } from '../../../../../../../packages/osr-export/src/runner.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [projectRoot, out, policyFlag] = process.argv.slice(2);
const captionsPath = path.join(projectRoot, 'captions.json');
const captions = JSON.parse(await readFile(captionsPath, 'utf8'));
if (policyFlag === 'policy') captions.display_policy = {
 mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
 unit_metric: 'ascii-half-other-one-v1', max_line_units: 24,
 minimum_fragment_duration_seconds: 0.1, locale: 'ja'
};
else delete captions.display_policy;
await writeFile(captionsPath, JSON.stringify(captions,null,2)+'\n');
const result = await exportWithOsr({projectRoot, out, fps: 30, width:1280,height:720,duration:4,quality:'high',encoder:'auto',soft:false,verify:'off', launcherResolver: options => resolveElectronLauncher({...options,allowDesktop:false})});
console.log(JSON.stringify({fellBackToLegacy:result.fellBackToLegacy,tier:result.launcher?.tier,receipt:result.receipt}));
