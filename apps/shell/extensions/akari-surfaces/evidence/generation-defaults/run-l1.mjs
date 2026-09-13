// L1 harness (wrapper-authored, verification-only; not product source).
//
// 使い方:
//   cd apps/shell && npm run build
//   node extensions/akari-surfaces/evidence/generation-defaults/run-l1.mjs
//
// 何を測るか（task 2026-09-13-settings-generation-defaults の指示 5-c）:
//   1. 設定 →「接続と API キー」の fal 行に「既定モデル」ブロックが出る（SS 1 枚）
//   2. 動画の既定を Kling へ変えると <作業場>/.akari/connections.json の
//      defaults.generate.video だけが変わり、他の欄は保持され、正典バリデータを通る（SS 1 枚）
//
// HOME / THEIA_CONFIG_DIR / --user-data-dir / AKARI_HOME / AKARI_CREDENTIALS_FILE /
// AKARI_CREATOR_ROOT はすべて使い捨ての一時プロファイルへ向ける
// （実利用の ~/.theia ~/.akari ~/.config/akari-video ~/Akari を触らない）。
// Electron は detached にせず、finish() で PID 指名 kill する。
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// .../apps/shell/extensions/akari-surfaces/evidence/generation-defaults → リポ直下まで 6 階層
const REPO = path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const TARGET_VIDEO_MODEL = 'fal:kling-v3-pro-i2v';

const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-generation-defaults-'));
const akariHome = path.join(profile, 'akari-home');
const creatorRoot = path.join(profile, 'Akari');
const workspace = path.join(profile, 'workspace');
const credentials = path.join(profile, 'credentials.env');
const connectionsPath = path.join(creatorRoot, '.akari', 'connections.json');
mkdirSync(akariHome, { recursive: true });
mkdirSync(workspace, { recursive: true });
cpSync(path.join(REPO, 'templates/project-default'), workspace, { recursive: true });
writeFileSync(credentials, 'AKARI_L1_UNUSED=1\n', { mode: 0o600 });
const credentialsBefore = statSync(credentials);

const { createCreatorRoot } = await import(path.join(REPO, 'packages/creator-root/src/index.mjs'));
await createCreatorRoot(creatorRoot);

// 作業場の connections.json を「他の欄がある」状態で置く（保持の確認のため）。
mkdirSync(path.dirname(connectionsPath), { recursive: true });
const seeded = {
    providers: [],
    policy: { currency: 'JPY', monthly_budget: 1234, approval_threshold: 500 },
    memory: []
};
writeFileSync(connectionsPath, `${JSON.stringify(seeded, null, 2)}\n`);

const log = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = () => log.join('');
const REPLACEMENTS = [[profile, '<TMP>'], [REPO, '<WORKTREE>'], [process.env.HOME, '<HOME>']];
const scrub = value => REPLACEMENTS
    .reduce((acc, [needle, token]) => (needle ? acc.split(needle).join(token) : acc), String(value))
    .replace(/\/private\/var\/folders\/[^\s"',)]*/g, '<TMP>')
    .replace(/\/var\/folders\/[^\s"',)]*/g, '<TMP>');

const child = spawn(ELECTRON, [
    path.join(HERE, 'electron-wrapper'),
    `--user-data-dir=${path.join(profile, 'user-data')}`,
    '--no-sandbox',
    '--window-size=1280,900'
], {
    cwd: path.join(HERE, 'electron-wrapper'),
    env: {
        ...process.env,
        AKARI_L1_APP_PATH: SHELL,
        AKARI_L1_WORKSPACE_PATH: workspace,
        AKARI_L1_EVIDENCE_DIR: HERE,
        AKARI_L1_TARGET_VIDEO_MODEL: TARGET_VIDEO_MODEL,
        HOME: profile,
        THEIA_CONFIG_DIR: path.join(profile, '.theia'),
        AKARI_HOME: akariHome,
        AKARI_CREATOR_ROOT: creatorRoot,
        AKARI_CREDENTIALS_FILE: credentials,
        ELECTRON_ENABLE_LOGGING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', data => log.push(String(data)));
child.stderr.on('data', data => log.push(String(data)));

const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(124); }, 300000);
    child.on('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
    child.on('error', error => { clearTimeout(timer); log.push(String(error)); resolve(1); });
});
try { child.kill('SIGKILL'); } catch { /* already gone */ }
await sleep(1500);

const checks = {};
const record = (name, ok, detail) => { checks[name] = { ok, detail }; };

record('electron-exit-0', exitCode === 0, { exitCode });
record('hook-reported-ok', text().includes('L1_OK'), {});

let written = null;
try { written = JSON.parse(readFileSync(connectionsPath, 'utf8')); } catch (error) { log.push(String(error)); }
record('connections-json-readable', !!written, { path: '<TMP>/Akari/.akari/connections.json' });
record('video-default-is-kling', written?.defaults?.generate?.video === TARGET_VIDEO_MODEL, {
    value: written?.defaults?.generate?.video ?? null
});
record('still-default-untouched', written?.defaults?.generate?.still == null, {
    value: written?.defaults?.generate?.still ?? null
});
record('other-fields-preserved',
    JSON.stringify(written?.providers) === JSON.stringify(seeded.providers)
    && JSON.stringify(written?.policy) === JSON.stringify(seeded.policy)
    && JSON.stringify(written?.memory) === JSON.stringify(seeded.memory),
    { policy: written?.policy ?? null, providers: written?.providers ?? null, memory: written?.memory ?? null });

let validate = { exitCode: null, stdout: '' };
try {
    const stdout = execFileSync(process.execPath,
        [path.join(REPO, 'packages/schemas/bin/validate-connections.mjs'), connectionsPath], { encoding: 'utf8' });
    validate = { exitCode: 0, stdout: scrub(stdout).trim() };
} catch (error) {
    validate = { exitCode: error.status ?? 1, stdout: scrub(String(error.stdout ?? '') + String(error.stderr ?? '')).trim() };
}
record('validate-connections-exit-0', validate.exitCode === 0, validate);

const credentialsAfter = statSync(credentials);
record('credentials-env-mtime-unchanged', credentialsAfter.mtimeMs === credentialsBefore.mtimeMs, {
    before: credentialsBefore.mtimeMs, after: credentialsAfter.mtimeMs
});

const orphans = execFileSync('/bin/sh', ['-c',
    `ps -eo pid,ppid,args | grep -F ${JSON.stringify(path.join(profile, 'user-data'))} | grep -v grep | wc -l`],
{ encoding: 'utf8' }).trim();
record('no-orphan-processes', orphans === '0', { count: orphans });

const report = {
    task: '2026-09-13-settings-generation-defaults',
    targetVideoModel: TARGET_VIDEO_MODEL,
    screenshots: ['01-settings-generation-defaults.png', '02-video-default-kling.png'],
    connectionsAfter: written,
    checks
};
writeFileSync(path.join(HERE, 'l1-report.json'), `${scrub(JSON.stringify(report, null, 2))}\n`);
writeFileSync(path.join(HERE, 'l1-log.txt'), scrub(text()));
for (let attempt = 0; attempt < 5; attempt++) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(1000); }
}
const failed = Object.entries(checks).filter(([, value]) => !value.ok);
console.log(scrub(JSON.stringify(report, null, 2)));
if (failed.length > 0) {
    console.error(`L1 FAILED: ${failed.map(([name]) => name).join(', ')}`);
    process.exit(1);
}
console.log('L1 PASS');
