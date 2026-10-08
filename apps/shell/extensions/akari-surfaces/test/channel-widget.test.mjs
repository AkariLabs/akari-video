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
});
