import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createLatestVersionLookup, decidePartnerCliUpdate, extractCliVersion, isAppManagedCliPath, parseLatestVersion, PARTNER_LATEST_SOURCES
} from '../lib/common/partner-cli-freshness.js';

const json = body => async () => ({ ok: true, json: async () => body });

test('--version 出力から版だけを取り出す', () => {
    assert.equal(extractCliVersion('codex-cli 0.46.0'), '0.46.0');
    assert.equal(extractCliVersion('2.0.14 (Claude Code)'), '2.0.14');
    assert.equal(extractCliVersion('v1.2.3-beta.1'), '1.2.3-beta.1');
    assert.equal(extractCliVersion('command-code-1.45.0'), '1.45.0');
    assert.equal(extractCliVersion('node 24'), undefined);
    assert.equal(extractCliVersion(undefined), undefined);
});

test('GitHub のタグと npm の version を解釈する', () => {
    assert.equal(parseLatestVersion(PARTNER_LATEST_SOURCES.codex, { tag_name: 'rust-v0.47.1' }), '0.47.1');
    assert.equal(parseLatestVersion(PARTNER_LATEST_SOURCES.opencode, { tag_name: 'v1.2.3' }), '1.2.3');
    assert.equal(parseLatestVersion(PARTNER_LATEST_SOURCES.pi, { version: '0.9.1' }), '0.9.1');
    assert.equal(parseLatestVersion(PARTNER_LATEST_SOURCES.codex, { tag_name: 'nightly' }), undefined);
    assert.equal(parseLatestVersion(PARTNER_LATEST_SOURCES.codex, null), undefined);
});

test('取得元は Codex=GitHub / npm 製=registry / Claude と Muse=自己更新 / その他は無し', () => {
    assert.equal(PARTNER_LATEST_SOURCES.codex.kind, 'github');
    for (const agent of ['commandcode', 'pi', 'deepseek']) assert.equal(PARTNER_LATEST_SOURCES[agent].kind, 'npm');
    assert.equal(PARTNER_LATEST_SOURCES.claude.kind, 'self-updating');
    assert.equal(PARTNER_LATEST_SOURCES.muse.kind, 'self-updating');
    assert.equal(PARTNER_LATEST_SOURCES.cursor, undefined);
});

test('最新版の問い合わせは URL を正しく組み、1 時間キャッシュする', async () => {
    const urls = []; let clock = 0;
    const lookup = createLatestVersionLookup({
        fetchImpl: async url => { urls.push(url); return { ok: true, json: async () => url.includes('github') ? { tag_name: 'rust-v0.50.0' } : { version: '2.0.0' } }; },
        now: () => clock
    });
    assert.equal(await lookup('codex'), '0.50.0');
    assert.equal(await lookup('codex'), '0.50.0');
    assert.equal(await lookup('deepseek'), '2.0.0');
    assert.deepEqual(urls, ['https://api.github.com/repos/openai/codex/releases/latest', 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest']);
    clock = 3_600_001;
    await lookup('codex');
    assert.equal(urls.length, 3);
});

test('ネットワーク失敗・HTTP エラー・Claude・取得元なしは undefined で throw しない', async () => {
    let calls = 0;
    const failing = createLatestVersionLookup({ fetchImpl: async () => { calls++; throw new Error('offline'); } });
    assert.equal(await failing('codex'), undefined);
    assert.equal(await failing('codex'), undefined);
    assert.equal(calls, 1, '失敗も覚えてオフライン中に毎回待たない');
    assert.equal(await createLatestVersionLookup({ fetchImpl: async () => ({ ok: false, json: async () => ({}) }) })('pi'), undefined);
    const never = createLatestVersionLookup({ fetchImpl: async () => { throw new Error('must not fetch'); } });
    assert.equal(await never('claude'), undefined);
    assert.equal(await never('muse'), undefined);
    assert.equal(await never('cursor'), undefined);
});

test('取得が止まっても timeout で打ち切る', async () => {
    const lookup = createLatestVersionLookup({
        timeoutMs: 20,
        fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    });
    assert.equal(await lookup('codex'), undefined);
});

test('更新要否: 新しければ更新あり、同じ・古い・不明は更新なし、Claude は自己更新', () => {
    assert.deepEqual(decidePartnerCliUpdate('codex', 'codex-cli 0.46.0', '0.47.0'), { latestVersion: '0.47.0', updateAvailable: true, selfUpdating: false });
    assert.equal(decidePartnerCliUpdate('codex', '0.47.0', '0.47.0').updateAvailable, false);
    assert.equal(decidePartnerCliUpdate('codex', '0.48.0', '0.47.0').updateAvailable, false);
    assert.equal(decidePartnerCliUpdate('codex', '0.46.0', undefined).updateAvailable, false);
    assert.equal(decidePartnerCliUpdate('codex', undefined, '0.47.0').updateAvailable, false);
    assert.deepEqual(decidePartnerCliUpdate('claude', '2.0.14 (Claude Code)', '9.9.9'), { latestVersion: undefined, updateAvailable: false, selfUpdating: true });
    assert.deepEqual(decidePartnerCliUpdate('muse', 'muse 1.2.3', '9.9.9'), { latestVersion: undefined, updateAvailable: false, selfUpdating: true });
});

test('AKARI 管理の導入先か別管理コピーかを見分ける', () => {
    const base = { homeDir: '/opt/akari-test-home', platform: 'darwin', env: {} };
    assert.equal(isAppManagedCliPath('/opt/akari-test-home/.local/bin/codex', base), true);
    assert.equal(isAppManagedCliPath('/opt/homebrew/bin/codex', base), false);
    assert.equal(isAppManagedCliPath('/usr/local/bin/command-code', base), false);
    const win = { homeDir: 'C:\\Users\\a', platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' } };
    assert.equal(isAppManagedCliPath('C:\\Users\\a\\AppData\\Local\\AKARI Video\\codex\\current\\bin\\codex.exe', win), true);
    assert.equal(isAppManagedCliPath('C:\\Users\\a\\AppData\\Local\\Programs\\muse\\muse.exe', win), true);
    assert.equal(isAppManagedCliPath('C:\\Users\\a\\.local\\pi.cmd', win), true);
    assert.equal(isAppManagedCliPath('C:\\Users\\a\\AppData\\Roaming\\npm\\pi.cmd', win), false);
});
