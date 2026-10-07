import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { selectVibeDockTabs, NowVibeDockTab, SettingsVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');

test('タブ貢献は順序で並び、利用できないものは除く', () => {
    const tabs = [
        { id: 'settings', order: 90 },
        { id: 'canvas', order: 40, isAvailable: () => false },
        { id: 'now', order: 10 },
        { id: 'next', order: 20 }
    ];
    assert.deepEqual(selectVibeDockTabs(tabs).map(tab => tab.id), ['now', 'next', 'settings']);
    assert.deepEqual(selectVibeDockTabs([new SettingsVibeDockTab(), new NowVibeDockTab()]).map(tab => tab.id), ['now', 'settings']);
});

test('利用できないマークには斜線を描く', () => {
    const source = readFileSync(new URL('../src/browser/vibe-dock-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /akari-vibe-mark-unavailable \.akari-vibe-mark-shape::after/);
    assert.match(source, /prefers-reduced-motion: reduce/);
});
