import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL(`../src/browser/channel/${name}.tsx`, import.meta.url), 'utf8');

test('widget は購入済み商品を読み、案内からアカウント設定へ進める', () => {
    const widget = source('akari-channel-widget');
    const sheet = source('channel-pro-sheet');
    assert.doesNotMatch(widget, /hasProKey=\{false\}/);
    assert.match(widget, /getAssetCatalogView\(undefined, 'automatic'\)/);
    const refreshStart = widget.indexOf('protected async refreshProKey()');
    const refreshBeforeRead = widget.slice(refreshStart, widget.indexOf('getAssetCatalogView', refreshStart));
    assert.doesNotMatch(refreshBeforeRead, /this\.proKey\s*=\s*false/);
    assert.match(widget, /<ChannelProSheet\b/);
    assert.match(widget, /akari\.settings\.open/);
    assert.match(widget, /onConnect=\{\(\) => \{\s*this\.proNotice = undefined;\s*this\.sheet = undefined;\s*this\.memorySheet = undefined;\s*this\.update\(\);\s*void this\.commands\.executeCommand\('akari\.settings\.open', \{ section: 'account' \}\);/);
    assert.match(sheet, /kind='channel-pro'/);
    assert.match(sheet, /は Akari Pro の機能です/);
    assert.match(sheet, /自分で書いて足すのは無料です/);
    assert.match(sheet, /data-akari-pro-connect/);
});

test('星付きの操作だけを鍵で分け、自作と写しは自由に使える', () => {
    for (const name of ['channel-design-wizard', 'channel-types-catalog', 'channel-skills-sheet',
        'channel-notes-sheet', 'memory-pack-catalog']) {
        assert.match(source(name), /onNeedPro/, name);
    }
    const skills = source('channel-skills-sheet');
    assert.match(skills, /onCreate\(/);
    assert.match(skills, /onCopyAkari\(/);
    assert.match(skills, /if \(!proGate\('pro', props\.hasProKey\)\) props\.onNeedPro\(PRO_FEATURE_PRESET_SKILL\);/);
});
