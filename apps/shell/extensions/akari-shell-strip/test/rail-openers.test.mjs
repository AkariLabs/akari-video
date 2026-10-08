import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ids = require('../lib/common/rail-ids.js');
const { railOpenerCommand, railDisabledIds, railSelection } = require('../lib/common/rail-model.js');
const { parseFrontmatter } = require('../lib/common/skill-catalog.js');
const { shouldDismissExpandedRail, railViewLabel, shouldShowLeftRailTooltip } =
    require('../lib/browser/left-rail-tooltip.js');

test('擬似タブの ID は共有定数から読む', () => {
    const source = readFileSync(new URL('../src/browser/akari-rail-openers.ts', import.meta.url), 'utf8');
    for (const name of ['RAIL_EXPAND_ID', 'RAIL_PROJECT_OPENER_ID', 'RAIL_LIBRARY_OPENER_ID',
        'RAIL_EXPORT_OPENER_ID', 'RAIL_DEVELOPER_OPENER_ID']) {
        assert.match(source, new RegExp(`static readonly ID = ${name}`));
    }
});

test('擬似タブとコマンドの対応', () => {
    assert.deepEqual(railOpenerCommand(ids.RAIL_EXPAND_ID), { id: ids.AKARI_COMMANDS.railToggleExpanded });
    assert.deepEqual(railOpenerCommand(ids.RAIL_PROJECT_OPENER_ID),
        { id: ids.AKARI_COMMANDS.catalogOpen, args: { tab: 'project' } });
    assert.deepEqual(railOpenerCommand(ids.RAIL_LIBRARY_OPENER_ID),
        { id: ids.AKARI_COMMANDS.catalogOpen, args: { tab: 'library' } });
    assert.deepEqual(railOpenerCommand(ids.RAIL_EXPORT_OPENER_ID), { id: ids.AKARI_COMMANDS.exportOpenDialog });
    assert.deepEqual(railOpenerCommand(ids.RAIL_DEVELOPER_OPENER_ID),
        { id: ids.AKARI_COMMANDS.settingsOpen, args: { section: 'developer' } });
    assert.deepEqual(railOpenerCommand(ids.RAIL_SETTINGS_OPENER_ID), { id: ids.AKARI_COMMANDS.settingsOpen });
});

test('場所と edit.json で無効なタブを決める', () => {
    assert.deepEqual([...railDisabledIds('channel', false)], [
        ids.RAIL_PROJECT_OPENER_ID, ids.RAIL_LIBRARY_OPENER_ID, ids.RAIL_SKILLS_WIDGET_ID, ids.RAIL_EXPORT_OPENER_ID
    ]);
    assert.deepEqual([...railDisabledIds('project', false)], [ids.RAIL_EXPORT_OPENER_ID]);
    assert.equal(railDisabledIds('project', true).size, 0);
});

test('素材面の選択と折り畳み', () => {
    assert.equal(railSelection(null, ids.RAIL_ROLE_BUCKETS_WIDGET_ID, false), ids.RAIL_PROJECT_OPENER_ID);
    assert.equal(railSelection('library', ids.RAIL_ROLE_BUCKETS_WIDGET_ID, false), ids.RAIL_LIBRARY_OPENER_ID);
    assert.equal(railSelection('library', ids.RAIL_ROLE_BUCKETS_WIDGET_ID, true), undefined);
    assert.equal(railSelection('library', ids.RAIL_CHANNEL_WIDGET_ID, false), undefined);
});

test('左レールは選択中の左端アクセント棒を消す', () => {
    const css = readFileSync(new URL('../src/browser/left-rail-style.ts', import.meta.url), 'utf8');
    assert.match(css, /lm-mod-current::before[\s\S]*?display: none !important/);
    assert.doesNotMatch(css, /box-shadow:\s*inset\s+2px/);
    assert.match(css, /data-akari-rail-expanded\] #theia-left-content-panel \{[^}]*z-index: 2 !important/);
    assert.match(css, /\.theia-sidebar-menu:not\(\.theia-additional-views-menu\) \{[^}]*display: none !important/);
});

test('メニューは名前だけの 200px の列として左右に動く', () => {
    const opener = readFileSync(new URL('../src/browser/akari-rail-openers.ts', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/browser/left-rail-style.ts', import.meta.url), 'utf8');
    assert.match(opener, /this\.configure\(AkariRailExpandOpener\.ID, 'メニュー', 'メニュー', 'codicon-menu'\)/);
    assert.match(css, /translateX\(-100%\)/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /width: 200px !important/);
    assert.doesNotMatch(css, /data-akari-rail-desc|340px/);
});

test('展開した列の外側は左クリックだけを閉じる操作として扱う', () => {
    assert.equal(shouldDismissExpandedRail('true', false, 0), true);
    assert.equal(shouldDismissExpandedRail('true', true, 0), false);
    assert.equal(shouldDismissExpandedRail(null, false, 0), false);
    assert.equal(shouldDismissExpandedRail('closing', false, 0), false);
    assert.equal(shouldDismissExpandedRail('true', false, 2), false);
    const source = readFileSync(new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'utf8');
    assert.match(source, /document\.addEventListener\('pointerdown',[\s\S]*?shouldDismissExpandedRail[\s\S]*?event\.preventDefault\(\);\s*event\.stopPropagation\(\);[\s\S]*?\}, true\);/);
    assert.match(source, /document\.addEventListener\('mouseup', onMouseUp, true\)/);
    assert.match(source, /document\.addEventListener\('click', onClick, true\)/);
});

test('開発者モードのビュー名はエクスプローラーと検索', () => {
    assert.equal(railViewLabel('explorer-view-container', 'explorer-view-container'), 'エクスプローラー');
    assert.equal(railViewLabel('search-view-container', 'explorer-view-container'), '検索');
    assert.equal(railViewLabel('other-view', 'explorer-view-container'), undefined);
    const source = readFileSync(new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'utf8');
    assert.match(source, /const overriddenLabel = railViewLabel\(id, EXPLORER_VIEW_CONTAINER_ID\)/);
    assert.match(source, /title\.label = overriddenLabel/);
});

test('展開中と閉じる途中は即時ツールチップを出さない', () => {
    assert.equal(shouldShowLeftRailTooltip(null, false), true);
    assert.equal(shouldShowLeftRailTooltip('true', false), false);
    assert.equal(shouldShowLeftRailTooltip('closing', false), false);
    assert.equal(shouldShowLeftRailTooltip(null, true), false);
});

test('スキル frontmatter は閉じたヘッダーだけ読む', () => {
    assert.deepEqual(parseFrontmatter('---\nname: カット\ndescription: 動画を編集\n---\n本文'),
        { name: 'カット', description: '動画を編集' });
    assert.equal(parseFrontmatter('---\nname: 未完'), undefined);
});
