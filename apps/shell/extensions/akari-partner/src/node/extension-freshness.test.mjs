import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, decideExtensionUpdate, formatExtensionUpdateNotice } from '../../lib/common/extension-freshness.js';

for (const [name, installedVersion, latestVersion, action, reason] of [
    ['新しい版へ更新', '2.1.210', '2.1.261', 'update', 'newer-available'],
    ['同一版は更新しない', '2.1.261', '2.1.261', 'none', 'up-to-date'],
    ['ダウングレードしない', '2.1.262', '2.1.261', 'none', 'up-to-date'],
    ['未インストール', undefined, '2.1.261', 'none', 'not-installed'],
    ['レジストリ不通', '2.1.210', undefined, 'none', 'registry-unavailable'],
    ['最新の版が不明', '2.1.210', 'latest', 'none', 'unparsable'],
    ['配備済みの版が不明', 'unknown', '2.1.261', 'none', 'unparsable'],
    ['両方なしは未インストールを優先', undefined, undefined, 'none', 'not-installed']
]) {
    test(name, () => {
        assert.deepEqual(decideExtensionUpdate({ installedVersion, latestVersion }), {
            action, reason, installedVersion, latestVersion
        });
    });
}

for (const version of ['v2.1.261', '2.1.261-beta.1', '2.1.261+build']) {
    test(`${version} は 2.1.261 と等価`, () => {
        assert.equal(compareVersions(version, '2.1.261'), 0);
        assert.equal(compareVersions('2.1.261', version), 0);
    });
}

test('比較は桁数によらず -1 / 0 / 1', () => {
    assert.equal(compareVersions('2.1.9', '2.1.10'), -1);
    assert.equal(compareVersions('2.1.10', '2.1.9'), 1);
    assert.equal(compareVersions('2.1.10', '2.1.10'), 0);
    assert.equal(compareVersions('3.0.0', '2.99.99'), 1);
    assert.equal(compareVersions('2.2.0', '2.1.999'), 1);
});

test('再読み込み通知の文言', () => {
    assert.equal(formatExtensionUpdateNotice('Claude Code 拡張', '2.1.210', '2.1.261'),
        'Claude Code 拡張 を 2.1.210 → 2.1.261 に更新しました。反映には再読み込みが必要です');
});

test('入力のバージョン文字列をそのまま返す', () => {
    assert.deepEqual(decideExtensionUpdate({ installedVersion: 'v2.1.210', latestVersion: '2.1.261+build' }), {
        action: 'update', reason: 'newer-available', installedVersion: 'v2.1.210', latestVersion: '2.1.261+build'
    });
});
