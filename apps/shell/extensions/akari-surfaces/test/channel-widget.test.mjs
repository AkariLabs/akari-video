import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('チャンネル widget は左レールの ID と日本語ラベルを使う', () => {
    const widget = readFileSync(new URL('../src/browser/channel/akari-channel-widget.tsx', import.meta.url), 'utf8');
    const rail = readFileSync(new URL('../../akari-shell-strip/src/common/rail-ids.ts', import.meta.url), 'utf8');
    assert.match(rail, /RAIL_CHANNEL_WIDGET_ID\s*=\s*'akari-channel-widget'/);
    assert.match(widget, /CHANNEL_WIDGET_ID\s*=\s*RAIL_CHANNEL_WIDGET_ID/);
    assert.match(widget, /CHANNEL_WIDGET_LABEL\s*=\s*'チャンネル'/);
    assert.match(widget, /this\.id\s*=\s*AkariChannelWidget\.ID/);
    assert.match(widget, /this\.title\.label\s*=\s*CHANNEL_WIDGET_LABEL/);
    assert.match(widget, /akari-channel-popover/);
    assert.doesNotMatch(widget, /<select\b/);
    assert.match(widget, /stageSummary\(/);
    assert.doesNotMatch(widget, /準備中|akari-channel-muted/);
    assert.match(widget, /akari-channel-area akari-channel-about/);
    assert.match(widget, /akari-channel-area akari-channel-projects/);
    assert.match(widget, /revealWidget\(RAIL_SKILLS_WIDGET_ID\)/);
    assert.match(widget, /resolveProjectCardThumbnails\(key\)/);
    // 一覧を開くときは見ているチャンネルを渡す（別のチャンネルの一覧を開ける）。チャンネルを選ぶと project モードでは一覧を開く
    assert.match(widget, /protected async openProjectList\(\): Promise<void> \{\s*const channel = this\.context\.viewingChannel;\s*await this\.commands\.executeCommand\(AKARI_COMMANDS\.openProjectList, \.\.\.\(channel \? \[\{ channel \}\] : \[\]\)\);\s*\}/);
    assert.match(widget, /protected async chooseChannel\(name: string\): Promise<void> \{[\s\S]*?this\.context\.setViewingChannel\(name\);\s*this\.updateCaption\(\);\s*if \(this\.scope\.scope === 'project'\) await this\.openProjectList\(\);\s*\}/);
});
