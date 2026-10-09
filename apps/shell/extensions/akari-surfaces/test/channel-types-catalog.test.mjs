import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL(`../src/browser/channel/${name}`, import.meta.url), 'utf8');

test('カタログの操作と選択状態', () => {
    const catalog = source('channel-types-catalog.tsx');
    for (const marker of ['data-akari-types-apply', 'data-akari-types-save-mine', 'data-akari-types-field', 'data-akari-types-card']) {
        assert.ok(catalog.includes(marker));
    }
    assert.ok(!catalog.includes('border-left'));
    assert.match(source('channel-sheet-style.ts'), /channel-types-catalog[^\n]*900px/);
});

test('チャンネル設計の入口', () => {
    const widget = source('akari-channel-widget.tsx');
    assert.ok(widget.includes('<ChannelTypesCatalog'));
    assert.ok(widget.includes('<ChannelDesignStart'));
    assert.ok(widget.includes('自分の型として残しました'));
    for (const marker of ['<ChannelTypeApplySheet', '<HelperConsentSheet', 'data-akari-helper-row', '1 つ前に戻しました', 'を当てました']) {
        assert.ok(widget.includes(marker));
    }
    const applySheet = source('channel-types-apply-sheet.tsx');
    assert.ok(!applySheet.includes('border-left'));
    for (const marker of ['data-akari-apply-run', 'data-akari-banner-undo']) assert.ok(applySheet.includes(marker));
    assert.ok(!source('channel-sheet-style.ts').includes('border-left'));
    assert.ok(source('channel-design-md-form.tsx').includes('過去の動画からヘルパーに書いてもらう'));
    const wizard = source('channel-design-wizard.tsx');
    assert.ok(wizard.includes('カタログで探す…'));
    assert.ok(wizard.includes('型を見る・当て直す…'));
});
