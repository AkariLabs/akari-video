import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decideExtensionCliAlignment, decideExtensionCliPreference, sameCliPath } from '../../lib/common/extension-cli-alignment.js';
import { resolveExtensionCli } from '../../lib/node/extension-cli-alignment.js';

const home = path.join('C:', 'Users', 'someone');
const localAppData = path.join(home, 'AppData', 'Local');
const managedExe = path.join(localAppData, 'AKARI Video', 'codex', 'current', 'bin', 'codex.exe');
const localBinExe = path.join(home, '.local', 'bin', 'codex.exe');
const packagePath = path.join(home, '.theia', 'deployedPlugins', 'openai.chatgpt-26.5730.61309', 'extension');
const bundledDir = path.join(packagePath, 'bin', 'windows-x86_64');
const bundledExe = path.join(bundledDir, 'codex.exe');
const bundledManifest = path.join(bundledDir, 'codex-package.json');
const pathCodex = path.join('C:', 'elsewhere', 'codex.exe');

function probe({ files = {}, versions = {}, directories = { [path.join(packagePath, 'bin')]: ['linux-x86_64', 'windows-x86_64'] } } = {}) {
    const asked = [];
    return {
        asked,
        platform: 'win32',
        arch: 'x64',
        homeDir: home,
        env: { LOCALAPPDATA: localAppData, PATH: path.dirname(pathCodex), PATHEXT: '.EXE;.CMD' },
        listDirectory: async directory => directories[directory] ?? [],
        isFile: async file => Object.hasOwn(files, file) || Object.hasOwn(versions, file),
        readText: async file => files[file],
        readVersionOutput: async executable => { asked.push(executable); return versions[executable]; }
    };
}

test('同梱の CLI より AKARI 管理の CLI が新しければ、管理側の実体を返す', async () => {
    const subject = probe({
        files: { [bundledManifest]: JSON.stringify({ version: '0.147.0-alpha.1.2' }) },
        versions: { [managedExe]: 'codex-cli 0.161.0\n', [localBinExe]: 'codex-cli 0.120.0\n', [pathCodex]: 'codex-cli 0.999.0\n' }
    });
    const result = await resolveExtensionCli('codex', packagePath, subject);
    assert.deepEqual(result, {
        reason: 'managed-newer', executablePath: managedExe,
        bundledVersion: '0.147.0-alpha.1.2', managedVersion: '0.161.0', managedPaths: [managedExe, localBinExe]
    });
    // 同梱の版は同梱情報から読む。利用者が PATH に入れた別の CLI は対象にしない。
    assert.deepEqual(subject.asked, [managedExe]);
});

test('同梱が同じか新しいとき・管理側が無いとき・比べられないときは、実体を返さない', async () => {
    const manifest = version => ({ [bundledManifest]: JSON.stringify({ version }) });
    const same = await resolveExtensionCli('codex', packagePath,
        probe({ files: manifest('0.161.0'), versions: { [managedExe]: 'codex-cli 0.161.0' } }));
    assert.equal(same.reason, 'bundled-current');
    assert.equal(same.executablePath, undefined);
    const bundledNewer = await resolveExtensionCli('codex', packagePath,
        probe({ files: manifest('0.170.2'), versions: { [managedExe]: 'codex-cli 0.161.0' } }));
    assert.equal(bundledNewer.reason, 'bundled-current');

    const none = probe({ files: manifest('0.147.0') });
    const missing = await resolveExtensionCli('codex', packagePath, none);
    assert.deepEqual([missing.reason, missing.executablePath, missing.managedPaths], ['no-managed-cli', undefined, [managedExe, localBinExe]]);
    assert.deepEqual(none.asked, []);

    const unreadable = await resolveExtensionCli('codex', packagePath, probe({ files: manifest('0.147.0'), versions: { [managedExe]: 'not a version' } }));
    assert.equal(unreadable.reason, 'unknown-managed-version');
    const ambiguous = await resolveExtensionCli('codex', packagePath, probe({
        files: manifest('0.147.0'), versions: { [managedExe]: 'codex-cli 0.161.0' },
        directories: { [path.join(packagePath, 'bin')]: ['windows-x86_64', 'windows-x86_64-legacy'] }
    }));
    assert.equal(ambiguous.reason, 'unknown-bundled-version');
    assert.equal(ambiguous.executablePath, undefined);

    assert.deepEqual(await resolveExtensionCli('claude', packagePath, probe()), { reason: 'unsupported', managedPaths: [] });
    assert.deepEqual(await resolveExtensionCli('codex', '', probe()), { reason: 'unsupported', managedPaths: [] });
});

test('同梱情報が無い拡張は、同梱の実行ファイルに版を尋ねる', async () => {
    const subject = probe({ versions: { [managedExe]: 'codex-cli 0.161.0', [bundledExe]: 'codex-cli 0.140.3' } });
    const result = await resolveExtensionCli('codex', packagePath, subject);
    assert.deepEqual([result.reason, result.bundledVersion, result.executablePath], ['managed-newer', '0.140.3', managedExe]);
    assert.deepEqual(subject.asked, [managedExe, bundledExe]);
});

test('調べている途中で失敗しても throw せず、書き換えない側の理由を返す', async () => {
    const subject = probe({ versions: { [managedExe]: 'codex-cli 0.161.0' } });
    subject.listDirectory = async () => { throw new Error('EACCES'); };
    assert.deepEqual(await resolveExtensionCli('codex', packagePath, subject), { reason: 'unknown-bundled-version', managedPaths: [managedExe, localBinExe] });
});

test('版の比較は数字の 3 つ組で行い、先行版の印では管理側を新しいと見なさない', () => {
    const decide = (bundledVersion, managedVersion) => decideExtensionCliAlignment({
        bundledVersion, managedVersion, managedExecutablePath: managedExe, managedPaths: [managedExe] }).reason;
    assert.equal(decide('0.147.0-alpha.1.2', '0.161.0'), 'managed-newer');
    assert.equal(decide('0.161.0-alpha.3', '0.161.0'), 'bundled-current');
    assert.equal(decide('0.161.1', '0.161.0'), 'bundled-current');
    assert.equal(decide(undefined, '0.161.0'), 'unknown-bundled-version');
    assert.equal(decide('0.147.0', undefined), 'unknown-managed-version');
});

test('設定の書き換え: 空なら入れる・AKARI が入れた値だけを直す・利用者の値には触れない', () => {
    const managedPaths = [managedExe, localBinExe];
    const newer = { reason: 'managed-newer', executablePath: managedExe, managedPaths };
    const current = { reason: 'bundled-current', managedPaths };
    assert.deepEqual(decideExtensionCliPreference(undefined, newer), { action: 'set', value: managedExe });
    assert.deepEqual(decideExtensionCliPreference(null, newer), { action: 'set', value: managedExe });
    assert.deepEqual(decideExtensionCliPreference('  ', newer), { action: 'set', value: managedExe });
    assert.deepEqual(decideExtensionCliPreference(undefined, current), { action: 'keep' });
    // 大文字小文字・区切りが違うだけの同じパスは、書き直さない。
    assert.deepEqual(decideExtensionCliPreference(managedExe.replace(/\\/g, '/').toUpperCase(), newer), { action: 'keep' });
    assert.deepEqual(decideExtensionCliPreference(localBinExe, newer), { action: 'set', value: managedExe });
    // 拡張が更新されて同梱が追いついたら、AKARI が入れた値を外して同梱へ戻す。
    assert.deepEqual(decideExtensionCliPreference(managedExe, current), { action: 'clear' });
    assert.deepEqual(decideExtensionCliPreference(managedExe, { reason: 'no-managed-cli', managedPaths }), { action: 'clear' });
    // 版を調べられなかっただけのときは、前に入れた値を残す。
    assert.deepEqual(decideExtensionCliPreference(managedExe, { reason: 'unknown-bundled-version', managedPaths }), { action: 'keep' });
    assert.deepEqual(decideExtensionCliPreference(managedExe, { reason: 'unknown-managed-version', managedPaths }), { action: 'keep' });
    for (const alignment of [newer, current]) {
        assert.deepEqual(decideExtensionCliPreference(pathCodex, alignment), { action: 'keep' });
    }
});

test('パスの比較は Windows の形だけ大文字小文字と区切りを無視する', () => {
    assert.equal(sameCliPath('C:\\Users\\A\\codex.exe', 'c:/users/a/CODEX.EXE'), true);
    assert.equal(sameCliPath('/opt/tools/bin/codex', '/opt/Tools/bin/codex'), false);
    assert.equal(sameCliPath('/opt/tools/bin/codex', '/opt/tools/bin/codex'), true);
});
