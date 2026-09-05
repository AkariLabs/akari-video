import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPluginEditorTitleItems, isAkariPreviewWebview } from '../lib/browser/tab-bar-toolbar-filter.js';

const output = { id: 'plugin-webview:akari-output-preview-abc123' };
const pluginItems = [
    { id: 'probe-as-tabbar-toolbar-item', effectiveMenuPath: ['plugin_editor/title', 'probe'] },
    { id: 'nested-as-tabbar-toolbar-item', effectiveMenuPath: ['plugin_editor/title', 'navigation', 'nested'] }
];

test('出力プレビューで menu delegate の直接・グループ配下項目を除外する', () => {
    assert.deepEqual(filterPluginEditorTitleItems(pluginItems, output), { kept: [], hidden: pluginItems });
});

test('Monaco エディタでは素通しする', () => {
    assert.deepEqual(filterPluginEditorTitleItems(pluginItems, { id: 'code-editor:file:///edit.json' }), {
        kept: pluginItems, hidden: []
    });
});

test('非 AKARI webview では素通しする', () => {
    const widget = { id: 'plugin-webview:partner', identifier: { id: 'partner' }, viewType: 'partner.chat' };
    assert.deepEqual(filterPluginEditorTitleItems(pluginItems, widget), { kept: pluginItems, hidden: [] });
});

test('AKARI 自前項目と他メニュー項目の順序・参照を保つ', () => {
    const own = { id: 'akari.project.showChanges.toolbar' };
    const other = { id: 'other-as-tabbar-toolbar-item', effectiveMenuPath: ['plugin_view/title', 'other'] };
    const items = Object.freeze([own, ...pluginItems, other]);
    const result = filterPluginEditorTitleItems(items, output);
    assert.deepEqual(result, { kept: [own, other], hidden: pluginItems });
    assert.equal(result.kept[0], own);
    assert.equal(result.hidden[0], pluginItems[0]);
});

test('RUN と editor/title の id フォールバックで除外する', () => {
    const items = [{ id: 'plugin_editor/title/run' }, { id: 'plugin_editor/title' }];
    assert.deepEqual(filterPluginEditorTitleItems(items, output), { kept: [], hidden: items });
});

test('menuPath も id も不明な項目は安全側で残す', () => {
    const items = [{}, null, undefined, { id: 3 }, { menuPath: 'plugin_editor/title' }, { menuPath: [] }];
    assert.deepEqual(filterPluginEditorTitleItems(items, output), { kept: items, hidden: [] });
});

test('素材プレビューでも除外する', () => {
    assert.deepEqual(filterPluginEditorTitleItems(pluginItems, { id: 'plugin-webview:akari-preview-123' }), {
        kept: [], hidden: pluginItems
    });
});

test('素材・出力プレビューの retry サフィックスを認識する', () => {
    for (const id of ['akari-preview-123-retry-1', 'akari-output-preview-456-retry-2']) {
        assert.deepEqual(filterPluginEditorTitleItems(pluginItems, { id: `plugin-webview:${id}` }), {
            kept: [], hidden: pluginItems
        });
        assert.equal(isAkariPreviewWebview({ identifier: { id } }), true);
    }
});

test('viewType と identifier.id だけでもプレビューを認識する', () => {
    for (const widget of [{ viewType: 'akari.preview' }, { identifier: { id: 'akari-preview-123' } },
        { identifier: { id: 'akari-output-preview-456' } }]) {
        assert.deepEqual(filterPluginEditorTitleItems(pluginItems, widget), { kept: [], hidden: pluginItems });
    }
});

test('menuPath と toolbarItem.menuPath にも対応する', () => {
    const items = [
        { menuPath: ['plugin_editor/title', 'probe'] },
        { menuPath: ['plugin_editor/title/run'] },
        { effectiveMenuPath: ['plugin_editor/title/run'] },
        { toolbarItem: { menuPath: ['plugin_editor/title/run'] } },
        { menuPath: null, effectiveMenuPath: null, toolbarItem: { menuPath: ['plugin_editor/title', 'probe'] } }
    ];
    assert.deepEqual(filterPluginEditorTitleItems(items, output), { kept: [], hidden: items });
});

test('widget 未指定・似た id・他メニューの接頭辞は誤判定しない', () => {
    for (const widget of [null, undefined, {}, { id: 'akari-preview-123' },
        { id: 'code-editor:akari-preview-123' }, { id: 'plugin-webview:other-akari-preview-123' }]) {
        assert.equal(isAkariPreviewWebview(widget), false);
        assert.deepEqual(filterPluginEditorTitleItems(pluginItems, widget), { kept: pluginItems, hidden: [] });
    }
    const items = [{ id: 'plugin_editor/title/other' }, { menuPath: ['plugin_editor/title-other'] }];
    assert.deepEqual(filterPluginEditorTitleItems(items, output), { kept: items, hidden: [] });
});
