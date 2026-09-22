import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, matchesSettingsSearch, formatShortReleaseDate, STATUS_BAR_KEYS } from '../../lib/common/settings-sections.js';

test('検索は節名と設定の見出し・説明を対象にする', () => {
    assert.equal(matchesSettingsSearch('ズーム', '外観', '色', ['UI の大きさ', 'ズームを変える']), true);
    assert.equal(matchesSettingsSearch('診断', '困ったとき', '診断情報を書き出す', []), true);
    assert.equal(matchesSettingsSearch('拡張', 'パートナー', 'CLI・公式拡張', []), true);
    assert.equal(matchesSettingsSearch('存在しない語', '外観', '色', ['ズーム']), false);
});

test('zoom は 60〜200% にクランプし 10% 刻みに丸める', () => {
    assert.equal(clampZoom(12), 60);
    assert.equal(clampZoom(124), 120);
    assert.equal(clampZoom(600), 200);
});

test('下のバーの設定キーは契約の 7 つ', () => {
    assert.deepEqual(Object.values(STATUS_BAR_KEYS), ['akari.statusBar.cpu', 'akari.statusBar.gpu', 'akari.statusBar.memory',
        'akari.statusBar.disk', 'akari.statusBar.running', 'akari.statusBar.intervalSec', 'akari.statusBar.accountBalance']);
});

test('更新日をフィードの暦日で M/D 表示する', () => {
    assert.equal(formatShortReleaseDate('2026-09-22T15:55:00+00:00'), '9/22');
    assert.equal(formatShortReleaseDate('2026-01-03'), '1/3');
    assert.equal(formatShortReleaseDate('invalid'), '');
});
