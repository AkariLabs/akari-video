import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
    SETTINGS_SECTIONS, SECTION_PREFERENCE_KEYS, sectionForPreferenceKey,
    resolveSettingsSectionId, settingsSectionElementId, normalizeQualityTier,
    SETTINGS_SECTION_DESCRIPTIONS, SETTINGS_LAST_SECTION_KEY, initialSettingsSection, isSettingsSectionVisible,
    normalizeExportCodec, normalizeExportFps, normalizeExportEncoder, EXPORT_CODEC_CHOICES, EXPORT_FPS_CHOICES,
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

test('ページ選択では全 8 節のうち自分だけを表示する', () => {
    for (const { id: selected } of SETTINGS_SECTIONS) {
        const visible = SETTINGS_SECTIONS.filter(({ id }) => isSettingsSectionVisible(id, selected));
        assert.deepEqual(visible.map(({ id }) => id), [selected]);
    }
});

test('最後のページの復元は明示指定を優先し、不正な保存値は無視する', () => {
    assert.equal(SETTINGS_LAST_SECTION_KEY, 'akari.settings.lastSection');
    for (const { id } of SETTINGS_SECTIONS) {
        assert.equal(initialSettingsSection(id, 'tools'), id);
        assert.equal(initialSettingsSection({ section: id }, 'tools'), id);
        assert.equal(initialSettingsSection(undefined, id), id);
        assert.equal(initialSettingsSection('unknown', id), id);
        assert.equal(initialSettingsSection({ section: 'unknown' }, id), id);
        assert.equal(initialSettingsSection(id, 'unknown'), id);
    }
    for (const stored of [undefined, null, '', 'unknown', {}, [], 1, true]) {
        assert.equal(initialSettingsSection(undefined, stored), 'start');
        assert.equal(initialSettingsSection('unknown', stored), 'start');
    }
});

test('全 akari スキーマキーをフォールバックに頼らずページに掲載する', () => {
    const declared = Object.values(SECTION_PREFERENCE_KEYS).flat();
    const schemaKeys = new Set();
    const dialog = source('../browser/akari-settings-dialog.ts');
    for (const path of ['../browser/akari-preferences.ts', '../../../akari-shell-strip/src/browser/akari-export-preferences.ts']) {
        const schema = source(path);
        const constants = new Map([...schema.matchAll(/export const (\w+) = '(akari\.[^']+)'/g)]
            .map(([, name, key]) => [name, key]));
        for (const match of schema.matchAll(/(?:\[(\w+)\]|['"](akari\.[^'"]+)['"])\s*:\s*\{/g)) {
            const key = match[2] ?? constants.get(match[1]);
            if (!key) { continue; }
            schemaKeys.add(key);
            assert.ok(declared.includes(key), `${key} must be listed explicitly`);
            const section = sectionForPreferenceKey(key);
            assert.ok(section, key);
            assert.ok(SECTION_PREFERENCE_KEYS[section].includes(key), key);
            if (match[1]) {
                assert.ok(dialog.includes(`this.preferences.get(${match[1]})`) ||
                    dialog.includes(`this.preferences.get<boolean>(${match[1]},`) ||
                    dialog.includes(`this.preferences.get<TranscribeBackend>(${match[1]},`) ||
                    dialog.includes(`this.preferences.get<string[]>(${match[1]},`) ||
                    dialog.includes(`this.preferenceCheckbox(${match[1]},`), `${key} has a form`);
                assert.ok(dialog.includes(`this.savePreference(${match[1]},`) ||
                    dialog.includes(`this.preferenceSelect(${match[1]},`) ||
                    dialog.includes(`this.preferenceCheckbox(${match[1]},`), `${key} can be saved`);
            }
        }
    }
    // task 2026-09-08: akari.developerMode のスキーマは akari-project が所有するため 11 → 10。
    assert.ok(schemaKeys.size >= 10, 'both preference schemas must be read');
    assert.ok(dialog.includes('this.preferenceCheckbox(AKARI_DEVELOPER_MODE,'),
        'akari.developerMode has a form and can be saved');
});

test('全ページは共通の見出しと説明を持ち、hidden で切り替えてページ内だけスクロールする', () => {
    for (const { id } of SETTINGS_SECTIONS) {
        assert.equal(typeof SETTINGS_SECTION_DESCRIPTIONS[id], 'string');
        assert.ok(SETTINGS_SECTION_DESCRIPTIONS[id].trim().length > 0, id);
        assert.equal(SETTINGS_SECTION_DESCRIPTIONS[id].includes('\n'), false, id);
    }
    assert.equal(SETTINGS_SECTION_DESCRIPTIONS.quality,
        '現在はこの値を読む機能がありません（AI 生成の品質段階として予約）');
    const dialog = source('../browser/akari-settings-dialog.ts');
    assert.match(dialog, /element\('h2', SETTINGS_SECTIONS\.find\(item => item\.id === id\)!\.label\)/);
    assert.match(dialog, /description\(SETTINGS_SECTION_DESCRIPTIONS\[id\]\)/);
    assert.match(dialog, /section\.replaceChildren\(\.\.\.this\.sectionHeading\(id\)\)/);
    assert.match(dialog, /this\.transcribe\.replaceChildren\(\.\.\.this\.sectionHeading\('transcribe'\)\)/);
    assert.match(dialog, /this\.connections\.append\(\.\.\.this\.sectionHeading\('connections'\)/);
    assert.match(dialog, /node\.hidden = true/);
    assert.match(dialog, /node\.hidden = !isSettingsSectionVisible\(id, section\)/);
    assert.match(dialog, /if \(!node\.hidden\) \{ node\.scrollTop = 0; \}/);
    assert.match(dialog, /Object\.assign\(node\.style, \{[^}]*minHeight: '0', overflowY: 'auto'/);
    assert.doesNotMatch(dialog, /scrollIntoView|scheduleSectionScroll|settingsSectionScrollTop|ResizeObserver|releaseScroll/);
});

test('ページの保存と復元は保存不可でも動き、コマンドからの直接指定を渡す', () => {
    const dialog = source('../browser/akari-settings-dialog.ts');
    assert.match(dialog, /try \{ stored = localStorage\.getItem\(SETTINGS_LAST_SECTION_KEY\); \} catch/);
    assert.match(dialog, /this\.showSection\(initialSettingsSection\(initialSection, stored\)\)/);
    assert.match(dialog, /try \{ localStorage\.setItem\(SETTINGS_LAST_SECTION_KEY, section\); \} catch/);
    assert.match(dialog, /action\(label, \(\) => this\.showSection\(target\)\)/);
    assert.match(dialog, /const section = resolveSettingsSectionId\(arg\)/);
    assert.match(dialog, /this\.dialog\?\.showSection\(section\)/);
    assert.match(dialog, /new AkariSettingsDialog\([^;]*this\.requestedSection\)/);
});

test('形式・fps・OS ごとのエンコーダは有効値を保持し、不正値を既定に戻す', () => {
    for (const { value } of EXPORT_CODEC_CHOICES) { assert.equal(normalizeExportCodec(value), value); }
    for (const value of [24, 30, 60]) { assert.equal(normalizeExportFps(value), value); }
    for (const [platform, encoders] of [
        ['darwin', ['auto', 'videotoolbox', 'x264']],
        ['win32', ['auto', 'nvenc', 'qsv', 'amf', 'mf', 'x264']],
        ['linux', ['auto', 'x264']]
    ]) {
        for (const value of encoders) { assert.equal(normalizeExportEncoder(value, platform), value); }
        for (const value of [undefined, null, 1, false, {}, [], '', 'unknown']) {
            assert.equal(normalizeExportEncoder(value, platform), 'auto');
        }
    }
    assert.equal(normalizeExportEncoder('nvenc', 'darwin'), 'auto');
    assert.equal(normalizeExportEncoder('videotoolbox', 'win32'), 'auto');
    assert.equal(normalizeExportEncoder('mf', 'linux'), 'auto');
    for (const value of [undefined, null, 1, false, {}, [], '', 'unknown', '30', 25, 29.97]) {
        assert.equal(normalizeExportCodec(value), 'h264');
        assert.equal(normalizeExportFps(value), undefined);
    }
    assert.deepEqual(EXPORT_FPS_CHOICES.map(({ value }) => normalizeExportFps(Number(value))), [undefined, 24, 30, 60]);
    const dialog = source('../browser/akari-settings-dialog.ts');
    assert.match(dialog, /this\.preferenceSelect\(AKARI_EXPORT_FPS,[\s\S]*?value => normalizeExportFps\(Number\(value\)\)/);
    assert.match(dialog, /this\.savePreference\(key, toPreferenceValue\(control\.value\)\)/);
    assert.match(dialog, /this\.preferences\.set\(key, value, PreferenceScope\.User\)/);
});


test('文字起こしのモードは先頭に掲載し、既定は simple', () => {
    assert.equal(SECTION_PREFERENCE_KEYS.transcribe[0], 'akari.transcribe.mode');
    assert.match(SETTINGS_SECTION_DESCRIPTIONS.transcribe, /モード.*エンジン/);
    assert.match(source('../browser/akari-preferences.ts'),
        /\[AKARI_TRANSCRIBE_MODE\]:\s*\{\s*type: 'string', enum: \['simple', 'advanced'\], default: 'simple'/);
});

test('文字起こしのラジオ切替で比較・カットの説明とフォームを置き換え、設定値を保つ', async () => {
    const require = createRequire(import.meta.url);
    const sections = require('../../lib/common/settings-sections.js');
    const protocol = require('../../lib/common/akari-connections-protocol.js');
    const { PreferenceScope } = require('@theia/core/lib/common/preferences/preference-scope');
    const element = tag => ({
        tag, children: [], style: {}, attributes: {}, listeners: {}, textContent: '',
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, callback) { this.listeners[name] = callback; }
    });
    const code = source('../../lib/browser/akari-settings-dialog.js');
    const modules = Object.fromEntries([...code.matchAll(/require\("([^"]+)"\)/g)].map(([, id]) => [id, {}]));
    Object.assign(modules, {
        '@theia/core/lib/browser/dialogs': { AbstractDialog: class {} },
        './akari-first-run-setup-dialog': { AkariFirstRunSetupDialog: class {} },
        '@theia/core/shared/inversify': { injectable: () => () => {}, inject: () => () => {} },
        '@theia/core/lib/common/preferences': { PreferenceScope },
        '../common/settings-sections': sections,
        '../common/akari-connections-protocol': protocol
    });
    const exports = {};
    new Function('require', 'exports', 'document', code)(id => {
        assert.ok(id in modules, `unexpected dependency: ${id}`);
        return modules[id];
    }, exports, { createElement: element });
    const dialog = Object.create(exports.AkariSettingsDialog.prototype);
    const values = {
        'akari.transcribe.compareSet': ['whisper-cpp', 'cloud:scribe'],
        'akari.transcribe.autoCuts': false
    }, writes = [];
    Object.assign(dialog, {
        transcribe: element('section'), notice: element('p'), compareDraft: [], compareEnabled: false,
        preferenceWrites: Promise.resolve(),
        preferences: {
            get(key, fallback) { return values[key] ?? fallback; },
            async set(key, value, scope) { values[key] = value; writes.push([key, value, scope]); dialog.renderTranscribe(); }
        }
    });
    const all = node => [node, ...node.children.flatMap(all)];
    const checkboxCount = () => all(dialog.transcribe).filter(node => node.tag === 'input' && node.type === 'checkbox').length;
    const selectMode = async mode => {
        all(dialog.transcribe).find(node => node.tag === 'input' && node.name === 'akari-transcribe-mode' && node.value === mode).listeners.change();
        await dialog.preferenceWrites;
    };
    dialog.renderTranscribe();
    const modes = dialog.transcribe.children.find(node => node.attributes.role === 'radiogroup');
    assert.deepEqual(all(modes).filter(node => node.tag === 'input').map(node => [node.value, node.checked]),
        [['simple', true], ['advanced', false]]);
    assert.equal(checkboxCount(), 0);
    assert.equal(all(dialog.transcribe).filter(node => node.textContent.includes('アドバンスで使います')).length, 1);
    await selectMode('advanced');
    assert.equal(checkboxCount(), 6);
    assert.equal(all(dialog.transcribe).filter(node => node.textContent.includes('アドバンスで使います')).length, 0);
    const checkboxes = all(dialog.transcribe).filter(node => node.tag === 'input' && node.type === 'checkbox');
    assert.equal(checkboxes.at(-1).checked, false);
    assert.equal(checkboxes.filter(node => node.checked).length, 3);
    await selectMode('simple');
    assert.equal(checkboxCount(), 0);
    assert.deepEqual(writes, [
        ['akari.transcribe.mode', 'advanced', PreferenceScope.User],
        ['akari.transcribe.mode', 'simple', PreferenceScope.User]
    ]);
    assert.deepEqual(values['akari.transcribe.compareSet'], ['whisper-cpp', 'cloud:scribe']);
    assert.equal(values['akari.transcribe.autoCuts'], false);
});
