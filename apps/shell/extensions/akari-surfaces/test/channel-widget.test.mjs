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
    assert.doesNotMatch(widget, /revealWidget\(RAIL_SKILLS_WIDGET_ID\)/);
    assert.match(widget, /<ChannelSkillsSheet\b/);
    assert.match(widget, /this\.channelSkills\.length\} 個/);
    assert.match(widget, /<ChannelDesignWizard\b/);
    assert.match(widget, /<DesignMdForm\b/);
    assert.match(widget, /channel\.md を書きました/);
    assert.match(widget, /resolveProjectCardThumbnails\(key\)/);
    assert.match(widget, /<ChannelMemorySheets\b/);
    assert.match(widget, /openMemorySheet\(/);
    // 一覧を開くときは見ているチャンネルを渡す（別のチャンネルの一覧を開ける）。チャンネルを選ぶと project モードでは一覧を開く
    assert.match(widget, /protected async openProjectList\(\): Promise<void> \{\s*const channel = this\.context\.viewingChannel;\s*await this\.commands\.executeCommand\(AKARI_COMMANDS\.openProjectList, \.\.\.\(channel \? \[\{ channel \}\] : \[\]\)\);\s*\}/);
    assert.match(widget, /protected async chooseChannel\(name: string\): Promise<void> \{[\s\S]*?this\.context\.setViewingChannel\(name\);\s*this\.updateCaption\(\);\s*if \(this\.scope\.scope === 'project'\) await this\.openProjectList\(\);\s*\}/);
});

test('チャンネルの札とシートの表示を整える', () => {
    const widget = readFileSync(new URL('../src/browser/channel/akari-channel-widget.tsx', import.meta.url), 'utf8');
    const people = readFileSync(new URL('../src/browser/channel/channel-people-sheet.tsx', import.meta.url), 'utf8');
    const notes = readFileSync(new URL('../src/browser/channel/channel-notes-sheet.tsx', import.meta.url), 'utf8');
    const sheetStyle = readFileSync(new URL('../src/browser/channel/channel-sheet-style.ts', import.meta.url), 'utf8');
    assert.match(widget, /-webkit-line-clamp:\s*2/);
    assert.doesNotMatch(widget, /\$\{RAIL_TAB\}\[data-akari-channel-initial\]::after/);
    assert.match(widget, /\.lm-TabBar-tabIcon::before/);
    assert.match(widget, /\.lm-TabBar-tabIcon \{[^}]*width:28px !important; height:28px !important;/);
    assert.match(widget, /\.lm-TabBar-tabIcon::before \{[^}]*width:25px; height:25px;/);
    assert.ok(people.indexOf('data-akari-people-add') < people.indexOf('data-akari-people-packs'));
    assert.match(notes, /パートナーに集めてもらう/);
    assert.match(notes, /用意されたものから足す ☆/);
    assert.doesNotMatch(notes, /ヘルパーに集めてもらう/);
    assert.match(sheetStyle, /--theia-input-background/);
});
