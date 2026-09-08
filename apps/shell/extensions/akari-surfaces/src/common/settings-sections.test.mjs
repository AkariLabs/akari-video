import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    SETTINGS_SECTIONS, SECTION_PREFERENCE_KEYS, sectionForPreferenceKey,
    resolveSettingsSectionId, settingsSectionElementId, settingsSectionScrollTop, normalizeQualityTier,
    normalizeTheme, normalizeExportQuality, normalizeOutputDirectory,
    QUALITY_TIER_CHOICES, THEME_CHOICES, EXPORT_QUALITY_CHOICES
} from '../../lib/common/settings-sections.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('全節の設定キーは節へ往復し、複数の節に重複しない', () => {
    const keys = new Set();
    assert.deepEqual(Object.keys(SECTION_PREFERENCE_KEYS), SETTINGS_SECTIONS.map(section => section.id));
    for (const { id } of SETTINGS_SECTIONS) {
        for (const key of SECTION_PREFERENCE_KEYS[id]) {
            assert.equal(sectionForPreferenceKey(key), id);
            assert.equal(keys.has(key), false, key);
            keys.add(key);
        }
    }
    assert.equal(sectionForPreferenceKey('akari.transcribe.future'), 'transcribe');
    assert.equal(sectionForPreferenceKey('akari.export.codec'), 'export');
    assert.equal(sectionForPreferenceKey('unknown'), undefined);
});

test('旧設定の品質・テーマ・開発者・通知と Store 接続は各節に移行する', () => {
    for (const [key, section] of [
        ['akari.qualityTier', 'quality'], ['workbench.colorTheme', 'developer'],
        ['akari.developerMode', 'developer'], ['akari.notifications.agentTurnEnd', 'notifications']
    ]) { assert.equal(sectionForPreferenceKey(key), section); }
    const dialog = source('../browser/akari-settings-dialog.ts');
    assert.match(dialog, /this\.storeRow\.setAttribute\('data-akari-store-settings', 'true'\)/);
    assert.match(dialog, /this\.connections\.append\([^;]*this\.providerList/s);
    assert.match(dialog, /this\.providerList\.replaceChildren\([^;]*this\.storeRow/s);
    assert.match(dialog, /new StoreConnectionFlowController/);
    assert.match(dialog, /this\.storeController\.disconnect\(\)/);
});

test('節指定はオブジェクトと文字列を受け付け、未知の値を無視する', () => {
    for (const { id } of SETTINGS_SECTIONS) {
        assert.equal(resolveSettingsSectionId({ section: id }), id);
        assert.equal(resolveSettingsSectionId(id), id);
    }
    for (const value of [undefined, null, {}, [], 1, true, 'unknown', { section: 'unknown' }, { section: {} }]) {
        assert.equal(resolveSettingsSectionId(value), undefined);
    }
});

test('節の順序・グループと DOM ID はナビの契約に一致する', () => {
    assert.deepEqual(SETTINGS_SECTIONS.map(section => section.id),
        ['start', 'export', 'quality', 'transcribe', 'connections', 'notifications', 'tools', 'developer']);
    assert.deepEqual(SETTINGS_SECTIONS.map(section => section.label),
        ['はじめかた', '書き出し', 'プレビュー品質', '文字起こし', '接続と API キー', '通知', '道具', '開発者モード']);
    for (const { id, group } of SETTINGS_SECTIONS) {
        assert.equal(group, id === 'developer' ? 'developer' : 'main');
        assert.equal(settingsSectionElementId(id), `akari-settings-${id}`);
    }
});

test('設定値は有効値を保持し、不正値を既定へ正規化する', () => {
    for (const { value } of QUALITY_TIER_CHOICES) { assert.equal(normalizeQualityTier(value), value); }
    for (const { value } of THEME_CHOICES) { assert.equal(normalizeTheme(value), value); }
    for (const { value } of EXPORT_QUALITY_CHOICES) { assert.equal(normalizeExportQuality(value), value); }
    for (const value of [undefined, null, 1, false, {}, [], '']) {
        assert.equal(normalizeQualityTier(value), 'draft');
        assert.equal(normalizeTheme(value), 'dark');
        assert.equal(normalizeExportQuality(value), 'standard');
        assert.equal(normalizeOutputDirectory(value), '');
    }
    assert.equal(normalizeQualityTier('unknown'), 'draft');
    assert.equal(normalizeExportQuality('unknown'), 'standard');
    assert.equal(normalizeTheme('custom-theme'), 'custom-theme');
    assert.equal(normalizeTheme('  '), 'dark');
    assert.equal(normalizeOutputDirectory('file:///tmp/exports'), 'file:///tmp/exports');
});

test('ホームの Store 設定は接続節を指定して設定ダイアログを開く', () => {
    const home = source('../browser/akari-home-widget.tsx');
    const body = home.match(/protected async openStoreSettings\(\): Promise<void> \{([\s\S]*?)\n    \}/)?.[1].trim();
    assert.equal(body, "await this.commands.executeCommand('akari.settings.open', { section: 'connections' });");
});

test('レールの許可リストに旧設定 widget がなく、設定 opener は残る', () => {
    const curation = source('../../../akari-shell-strip/src/browser/akari-activity-bar-curation.ts');
    assert.equal(curation.includes('akari-settings-widget'), false);
    assert.match(curation, /id: 'akari-settings-opener'/);
});

test('旧設定 widget と復元用 WidgetFactory を撤去する', () => {
    assert.equal(existsSync(new URL('../browser/akari-settings-widget.tsx', import.meta.url)), false);
    assert.equal(source('../browser/akari-surfaces-frontend-module.ts').includes('AkariSettingsWidget'), false);
    assert.equal(source('../browser/akari-settings-dialog.ts').includes('akari-settings-widget'), false);
});


test('非同期ロードで上の節が伸びるたびに現在の幾何から指定節の位置を補正する', () => {
    // Attach initially reaches the end of the still mostly empty pane.
    assert.equal(settingsSectionScrollTop({ scrollTop: 0, sectionTop: 450, viewportTop: 100, maxScrollTop: 200 }), 200);
    // Connections arrives first, pushing tools far below the viewport.
    assert.equal(settingsSectionScrollTop({ scrollTop: 200, sectionTop: 1150, viewportTop: 100, maxScrollTop: 1500 }), 1250);
    // A later Store response changes the layout again; no retry-count limit.
    assert.equal(settingsSectionScrollTop({ scrollTop: 1250, sectionTop: 180, viewportTop: 100, maxScrollTop: 1700 }), 1330);
    assert.equal(settingsSectionScrollTop({ scrollTop: 1330, sectionTop: 100, viewportTop: 100, maxScrollTop: 1700 }), undefined);
});

test('前の節への移動・縮小・末尾の短い節でもスクロール範囲を超えず、整列後は動かさない', () => {
    assert.equal(settingsSectionScrollTop({ scrollTop: 500, sectionTop: -200, viewportTop: 100, maxScrollTop: 1500 }), 200);
    assert.equal(settingsSectionScrollTop({ scrollTop: 100, sectionTop: -100, viewportTop: 100, maxScrollTop: 1500 }), 0);
    assert.equal(settingsSectionScrollTop({ scrollTop: 300, sectionTop: 400, viewportTop: 100, maxScrollTop: 300 }), undefined);
    assert.equal(settingsSectionScrollTop({ scrollTop: 0, sectionTop: 200, viewportTop: 100, maxScrollTop: -100 }), undefined);
    assert.equal(settingsSectionScrollTop({ scrollTop: 100, sectionTop: 100.5, viewportTop: 100, maxScrollTop: 1500 }), undefined);
});
