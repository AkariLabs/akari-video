import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Command Code は PATH 外の正式名で検出し、専用 Node の bin で版を取得する', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-partner-settings-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const localBin = join(root, '.local', 'bin');
    const pathBin = join(root, 'path-bin');
    const akariHome = join(root, '.akari');
    const privateRoot = join(akariHome, 'runtime', 'node', 'v24.21.0');
    const privateBin = join(privateRoot, 'bin');
    for (const dir of [localBin, pathBin, privateBin]) { await mkdir(dir, { recursive: true }); }
    async function executable(file, body) {
        await writeFile(file, `#!/bin/sh\n${body}\n`);
        await chmod(file, 0o755);
    }
    await executable(join(localBin, 'command-code'), 'exec node --version');
    await executable(join(pathBin, 'commandcode'), 'echo wrong-name-9.9.9');
    await executable(join(privateBin, 'node'), 'echo command-code-1.45.0');
    await executable(join(privateBin, 'npm'), 'exit 0');
    await writeFile(join(privateRoot, 'command-code-installed'), 'private\n');
    const script = `const { AkariSettingsMaintenanceServiceImpl } = require('./lib/node/settings-maintenance-service.js');
        const service = new AkariSettingsMaintenanceServiceImpl();
        Promise.all([service.partnerAvailability(), service.partnerDetails()]).then(value => process.stdout.write(JSON.stringify(value)));`;
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: new URL('../..', import.meta.url),
        env: { ...process.env, HOME: root, AKARI_HOME: akariHome, PATH: pathBin },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const [availability, details] = JSON.parse(result.stdout);
    assert.equal(Object.keys(details).length, 11);
    assert.equal(availability.commandcode, true);
    assert.deepEqual(details.commandcode, { installed: true, version: 'command-code-1.45.0', detail: 'command-code-1.45.0', managedByApp: true });
});

test('PATH 外の CLI が --version に失敗してもインストール済みとし、エラーを版にしない', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-partner-settings-version-fail-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const localBin = join(root, '.local', 'bin');
    await mkdir(localBin, { recursive: true });
    const executable = join(localBin, 'command-code');
    await writeFile(executable, "#!/bin/sh\necho 'env: node: No such file or directory' >&2\nexit 127\n");
    await chmod(executable, 0o755);
    const script = `const { AkariSettingsMaintenanceServiceImpl } = require('./lib/node/settings-maintenance-service.js');
        new AkariSettingsMaintenanceServiceImpl().partnerDetails().then(details =>
            process.stdout.write(JSON.stringify(details.commandcode, (_key, value) => value === undefined ? '__undefined__' : value)));`;
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: new URL('../..', import.meta.url),
        env: { ...process.env, HOME: root, AKARI_HOME: join(root, '.akari'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
        encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { installed: true, version: '__undefined__', detail: '—', managedByApp: true });
});

test('PATH 上の別管理コピーは managedByApp=false、最新版は注入した fetch で比べ、失敗時は更新なし', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-partner-settings-fresh-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pathBin = join(root, 'path-bin');
    await mkdir(pathBin, { recursive: true });
    async function executable(file, body) { await writeFile(file, `#!/bin/sh\n${body}\n`); await chmod(file, 0o755); }
    await executable(join(pathBin, 'codex'), 'echo codex-cli 0.46.0');
    await executable(join(pathBin, 'claude'), 'echo "2.0.14 (Claude Code)"');
    const script = `
        const urls = [];
        globalThis.fetch = async url => { urls.push(String(url)); if (process.env.OFFLINE) throw new Error('offline');
            return { ok: true, json: async () => ({ tag_name: 'rust-v0.47.0' }) }; };
        const { AkariSettingsMaintenanceServiceImpl } = require('./lib/node/settings-maintenance-service.js');
        const service = new AkariSettingsMaintenanceServiceImpl();
        service.partnerDetails().then(async details => process.stdout.write(JSON.stringify({
            codex: details.codex, claude: details.claude, fresh: await service.partnerFreshness(details), urls })));`;
    const run = extra => spawnSync(process.execPath, ['-e', script], {
        cwd: new URL('../..', import.meta.url),
        env: { ...process.env, HOME: root, AKARI_HOME: join(root, '.akari'), PATH: `${pathBin}:/usr/bin:/bin`, ...extra }, encoding: 'utf8'
    });
    const online = run({});
    assert.equal(online.status, 0, online.stderr);
    const value = JSON.parse(online.stdout);
    assert.equal(value.codex.managedByApp, false);
    assert.deepEqual(value.fresh.codex, { latestVersion: '0.47.0', updateAvailable: true, selfUpdating: false });
    assert.deepEqual(value.fresh.claude, { updateAvailable: false, selfUpdating: true });
    assert.deepEqual(value.urls, ['https://api.github.com/repos/openai/codex/releases/latest'], 'Claude は問い合わせない');
    const offline = run({ OFFLINE: '1' });
    assert.equal(offline.status, 0, offline.stderr);
    assert.deepEqual(JSON.parse(offline.stdout).fresh.codex, { updateAvailable: false, selfUpdating: false });
});
