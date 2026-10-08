import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ids = require('../lib/common/rail-ids.js');
const { railOpenerCommand, railDisabledIds, railSelection } = require('../lib/common/rail-model.js');
const { parseFrontmatter } = require('../lib/common/skill-catalog.js');

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
});

test('スキル frontmatter は閉じたヘッダーだけ読む', () => {
    assert.deepEqual(parseFrontmatter('---\nname: カット\ndescription: 動画を編集\n---\n本文'),
        { name: 'カット', description: '動画を編集' });
    assert.equal(parseFrontmatter('---\nname: 未完'), undefined);
});
