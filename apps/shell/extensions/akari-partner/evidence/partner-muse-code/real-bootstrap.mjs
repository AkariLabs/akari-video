// 使い方: node real-bootstrap.mjs <隔離フォルダ>
// 実物の配信元（dev.meta.ai）に向けて導入処理（bootstrapRunner）を 2 回動かす。1 回目は導入、2 回目は再利用になること。
// 導入先は <隔離フォルダ> の下だけ（LOCALAPPDATA / HOME を付け替え、MUSE_NO_MODIFY_PATH で利用者の PATH を変えない）。
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { bootstrapRunner } from '../../lib/node/bootstrap-runner.js';
import { spawnBootstrapProcess } from '../../lib/node/bootstrap-process.js';
import { partnerCliCandidates } from '../../lib/node/partner-cli-candidates.js';
import { catalogMessages } from '../../lib/common/partner-text.js';
import { setLanguage } from '@akari-video/i18n';

const root = process.argv[2];
if (!root) { console.error('usage: real-bootstrap.mjs <isolated-dir>'); process.exit(1); }
setLanguage('ja');
const home = path.join(root, 'home');
await mkdir(home, { recursive: true });
const win = process.platform === 'win32';
const systemPath = win ? [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';') : '/usr/bin:/bin';
const env = {
    ...process.env, HOME: home, USERPROFILE: home, AKARI_HOME: path.join(root, 'akari-home'),
    LOCALAPPDATA: path.join(root, 'local-app-data'), PATH: systemPath,
    AKARI_PARTNER_INSTALL_CONSENT: '1', MUSE_NO_MODIFY_PATH: '1'
};
const source = `(${bootstrapRunner.toString()})(${partnerCliCandidates.toString()}, ${JSON.stringify(catalogMessages())})`;
for (const round of [1, 2]) {
    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
        const child = spawnBootstrapProcess(process.execPath, source, 'muse', env);
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk);
        child.stderr.on('data', chunk => stderr += chunk);
        child.on('error', reject);
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
    const shown = text => text.split(root).join('<隔離フォルダ>').trim();
    console.log(`--- ${round} 回目: exit=${result.code} ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(shown(result.stdout));
    if (result.stderr.trim()) console.log('[stderr]', shown(result.stderr));
    if (result.code !== 0) process.exit(1);
}
