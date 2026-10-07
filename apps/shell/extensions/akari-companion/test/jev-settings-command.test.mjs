import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JevSettingsCommand } from '../lib/browser/jev-settings-command.js';
import { JEV_SETTING_KEYS, JEV_SETTING_REAL_KEYS, validateSettingValue } from '../lib/common/jev-settings-allowlist.js';
import { loadCatalog } from '../../../../../packages/akari-vibe/src/jev/jev-actions.mjs';
import { validateCommandArgs } from '../lib/common/companion-allowlist.js';
import { JEV_SETTINGS_OPEN_SECTIONS } from '../lib/common/jev-actions.generated.js';

function commandWithPreferences(initial = {}) {
    const values = new Map(Object.entries(initial));
    const writes = [];
    const command = new JevSettingsCommand();
    Object.defineProperty(command, 'preferences', { value: {
        inspect: key => ({ globalValue: values.get(key) }),
        set: async (key, value, scope) => {
            writes.push({ key, value, scope });
            if (value === undefined) values.delete(key);
            else values.set(key, value);
        }
    } });
    let execute;
    command.registerCommands({ registerCommand: (definition, handler) => {
        assert.equal(definition.id, 'akari.settings.setByVoice');
        execute = handler.execute;
    } });
    return { execute, writes, values };
}

test('表示設定の 4 キーだけを許し、型と範囲を確認する', () => {
    assert.deepEqual([...JEV_SETTING_KEYS], [
        'appearance.zoom', 'appearance.themeMode', 'timeline.visualThumbnails', 'timeline.trackRippleDisplay'
    ]);
    assert.deepEqual(validateSettingValue('appearance.zoom', 87), { ok: true, value: 90 });
    for (const [key, value] of [['appearance.zoom', 300], ['appearance.zoom', '90'],
        ['appearance.themeMode', 'blue'], ['timeline.visualThumbnails', 'true'],
        ['timeline.trackRippleDisplay', 'grid'], ['unknown', true]]) {
        assert.equal(validateSettingValue(key, value).ok, false, key);
    }
    const forbidden = loadCatalog().neverByVoice;
    for (const key of JEV_SETTING_KEYS) for (const value of [key, ...JEV_SETTING_REAL_KEYS[key]]) {
        assert.equal(forbidden.some(term => value === term || value.startsWith(`${term}.`) || value.endsWith(`.${term}`) || value.includes(`.${term}.`)), false, value);
    }
});

test('テーマは 2 キーへ順に書き、previous から戻せる', async () => {
    const context = commandWithPreferences({ 'akari.appearance.themeMode': 'dark', 'workbench.colorTheme': 'dark' });
    const result = await context.execute({ key: 'appearance.themeMode', value: 'light' });
    assert.deepEqual(result, {
        applied: { key: 'appearance.themeMode', value: 'light' },
        previous: { key: 'appearance.themeMode', value: 'dark' }, matched: true
    });
    assert.deepEqual(context.writes.map(row => row.key), ['akari.appearance.themeMode', 'workbench.colorTheme']);
    assert.equal(context.writes[0].scope, context.writes[1].scope);
    await context.execute(result.previous);
    assert.equal(context.values.get('akari.appearance.themeMode'), 'dark');
    assert.equal(context.values.get('workbench.colorTheme'), 'dark');
});

test('未設定への戻しと不正値の書き込みゼロ', async () => {
    const context = commandWithPreferences();
    const first = await context.execute({ key: 'appearance.zoom', value: 87 });
    assert.equal(first.applied.value, 90);
    assert.equal(first.previous.value, null);
    await context.execute(first.previous);
    assert.equal(context.values.has('akari.appearance.zoom'), false);
    for (const args of [
        { key: 'appearance.zoom', value: 300 },
        { key: 'appearance.zoom', value: 'large' },
        { key: 'connections.write', value: true }
    ]) {
        const count = context.writes.length;
        await assert.rejects(context.execute(args));
        assert.equal(context.writes.length, count);
    }
});

test('設定の節は実装済みの節を含み、listening も予約済み', () => {
    const source = fs.readFileSync(new URL('../../akari-surfaces/src/common/settings-sections.ts', import.meta.url), 'utf8');
    const ids = new Set([...source.matchAll(/\bid: '([^']+)'/g)].map(match => match[1]));
    for (const section of JEV_SETTINGS_OPEN_SECTIONS) {
        if (section !== 'listening') assert.ok(ids.has(section), section);
        assert.equal(validateCommandArgs('akari.settings.open', { section }).ok, true);
    }
    assert.equal(validateCommandArgs('akari.settings.open', { section: 'x' }).ok, false);
    assert.equal(validateCommandArgs('akari.settings.open', { section: 'appearance', extra: 1 }).ok, false);
    assert.equal(validateCommandArgs('akari.settings.open', undefined).ok, false);
});
