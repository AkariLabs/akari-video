import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as sources from '../lib/common/library-source-view.js';
import * as home from '../lib/common/library-home-view.js';
import * as tokens from '../lib/common/akari-surface-tokens.js';
const require = createRequire(import.meta.url), React = require('react');
const compiled = readFileSync(new URL('../lib/browser/akari-role-buckets-widget.js', import.meta.url), 'utf8');
function method(name) {
    const start = compiled.indexOf(`    ${name}(`);
    assert.notEqual(start, -1);
    const rest = compiled.slice(start);
    return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function('React', 'library_source_view_1', 'library_home_view_1', 'akari_surface_tokens_1', 'edit_store_1',
    `return class { ${['renderLibrarySourceFilters', 'renderRecentLibraryStrip', 'openRecentLibraryEntry',
        'isSiteSubscription',
        'libraryCategoryDefinition', 'selectLibraryCategory', 'showLibraryHome', 'filteredCatalogItems',
        'libraryCategoryCount', 'renderLibraryCategoryRow', 'renderTopControls', 'renderLibraryCategoryPage'].map(method).join('\n')} }`)(React, sources, home, tokens, { TRANSITION_VOCABULARY: [] });
const walk = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
function fixture() {
    const focused = [];
    const w = Object.assign(new Widget(), { librarySourceFilter: 'all', topView: 'catalog', catalogQuery: '',
        assetCatalogItems: [{ origin: 'resolver', sourceKind: 'own', id: 'one', key: 'audio/one', title: '効果音',
            category: 'audio', tags: ['sfx'], libraryDir: '/tmp/library/one', addedAt: '2026-09-22T00:00:00Z' }],
        presetShowcase: { textstyle: [], textanim: [], lut: [] }, catalogPacks: [], update() {}, stopCatalogAudio() {},
        renderLibraryCategoryBody() {}, focusAssetCard: (...args) => focused.push(args) });
    return { w, focused };
}
test('切り替えは検索の上、カテゴリ往復で選択保持、materialSwap では描画しない', () => {
    const { w } = fixture();
    const controls = walk(w.renderTopControls());
    const own = controls.find(node => node.props['data-source-filter'] === 'own');
    assert.ok(controls.indexOf(own) < controls.findIndex(node => node.type === 'input'));
    own.props.onClick();
    w.selectLibraryCategory('sfx');
    assert.equal(w.filteredCatalogItems().length, 1);
    w.showLibraryHome();
    assert.equal(w.librarySourceFilter, 'own');
    assert.equal(walk(w.renderTopControls()).find(node => node.props['data-source-filter'] === 'own').props['aria-pressed'], true);
    w.materialSwap = {};
    assert.equal(walk(w.renderTopControls()).some(node => node.props['data-source-filter']), false);
});
test('0件カテゴリは薄く、件数を観測でき、クリックで開く', () => {
    const { w } = fixture(); w.librarySourceFilter = 'site';
    const row = w.renderLibraryCategoryRow(w.libraryCategoryDefinition('sfx'));
    assert.equal(row.props['data-category'], 'sfx');
    assert.equal(row.props['data-count'], 0);
    assert.ok(row.props.style.opacity < 1);
    assert.equal(row.props.disabled, false);
    row.props.onClick({ stopPropagation() {} });
    assert.equal(w.libraryCategory, 'sfx');
});
test('帯の個別チップはカードを示す。フォルダチップは観測可能な絞り込みを開く', () => {
    const { w, focused } = fixture();
    let strip = w.renderRecentLibraryStrip();
    assert.equal(strip.props['data-recent-strip'], true);
    walk(strip).find(node => node.props['data-recent-key']).props.onClick();
    assert.deepEqual(focused, [['catalog', 'audio/one', true]]);
    w.assetCatalogItems[0].folder = '旅行';
    strip = w.renderRecentLibraryStrip();
    walk(strip).find(node => node.props['data-recent-key'] === 'folder:旅行').props.onClick();
    assert.equal(w.libraryFolderFilter, '旅行');
    assert.equal(w.catalogQuery, '');
    assert.equal(w.filteredCatalogItems().length, 1);
    const page = walk(w.renderLibraryCategoryPage('sfx'));
    assert.ok(page.some(node => node.props['data-library-folder-filter'] === '旅行'));
    page.find(node => node.props['aria-label'] === 'フォルダの絞り込みを解除').props.onClick();
    assert.equal(w.libraryFolderFilter, undefined);
    w.librarySourceFilter = 'lab';
    assert.equal(w.renderRecentLibraryStrip(), undefined);
});
test('サブスク札は tags と machineTags のどちらからも帯へ出る', () => {
    const { w } = fixture();
    w.assetCatalogItems[0].tags = ['license:subscription'];
    assert.ok(walk(w.renderRecentLibraryStrip()).some(node => node.props['data-akari-site-subscription']));
    w.assetCatalogItems[0].tags = [];
    w.assetCatalogItems[0].machineTags = ['license:subscription'];
    assert.ok(walk(w.renderRecentLibraryStrip()).some(node => node.props['data-akari-site-subscription']));
});
