import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const tabs = require('../lib/browser/right-rail-last-tab.js');
const railIds = require('../lib/common/rail-ids.js');

test('論理 ID を 4 種に限定し、チャットは端末を先に選ぶ', () => {
    assert.equal(tabs.rightRailLogicalTab('akari-inspector-widget'), 'inspector');
    assert.equal(tabs.rightRailLogicalTab('terminal-3'), 'chat');
    assert.equal(tabs.rightRailLogicalTab('akari-daihon-widget'), 'script');
    assert.equal(tabs.rightRailLogicalTab('akari-review-panel-widget'), 'annotations');
    assert.equal(tabs.rightRailLogicalTab('akari-audio-meter-widget'), undefined);
    assert.equal(tabs.rightRailWidgetForTab('chat', ['akari-partner-web', 'terminal-3']), 'terminal-3');
    assert.equal(tabs.rightRailWidgetForTab('inspector', []), undefined);
});

test('記憶キーは凍結 ID と一致し、不正値は復元しない', () => {
    assert.equal(tabs.RIGHT_RAIL_LAST_TAB_KEY, railIds.AKARI_RIGHT_RAIL_LAST_TAB_STORAGE_KEY);
    assert.equal(tabs.readRightRailLastTab({ getItem: () => 'annotations' }), 'annotations');
    assert.equal(tabs.readRightRailLastTab({ getItem: () => 'meter' }), undefined);
});

test('保存は pointer click の経路だけで行う', () => {
    const source = readFileSync(new URL('../src/browser/akari-right-panel-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /this\.tabBar\.currentChanged\.connect\([\s\S]*currentTitle === this\.pointerTab[\s\S]*localStorage\.setItem\(RIGHT_RAIL_LAST_TAB_KEY, logical\)/);
    assert.match(source, /this\.pointerTab = title;[\s\S]*this\.clickRail\(title\);[\s\S]*this\.pointerTab = undefined;/);
    assert.equal((source.match(/localStorage\.setItem\(RIGHT_RAIL_LAST_TAB_KEY/g) ?? []).length, 1);
});

test('channel では下段の 5 widget を detach し、project で同じ instance を戻す', () => {
    const source = readFileSync(new URL('../src/browser/akari-right-panel-curation.ts', import.meta.url), 'utf8');
    for (const id of ['akari-inspector-widget', 'akari-daihon-widget', 'akari-review-panel-widget',
        'akari-session-viewer-widget', 'akari-audio-meter-widget']) assert.ok(source.includes(`'${id}'`));
    assert.match(source, /widget\.parent = null/);
    assert.match(source, /shell\.addWidget\(widget, \{ area: 'right', rank \}\)/);
    assert.doesNotMatch(source, /widget\.dispose\(\)/);
});

test('project への復帰時は退避 widget の有無に応じて最後のタブを 1 回復元する', () => {
    const source = readFileSync(new URL('../src/browser/akari-right-panel-curation.ts', import.meta.url), 'utf8');
    assert.match(source, /onDidChangeScope\(scope => \{\s*this\.reconcile\(`scope:\$\{scope\}`\);\s*if \(scope === 'project' && !this\.restoringProject\) void this\.restoreLastTab\(\);/);
    assert.match(source, /this\.restoringProject = false;\s*void this\.restoreLastTab\(\);/);
});
