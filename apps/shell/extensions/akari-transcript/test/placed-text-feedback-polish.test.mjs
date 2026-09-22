import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DARK, LIGHT } from '../../akari-theme/lib/browser/akari-theme-tokens.js';
import { placedTextRanges } from '../lib/common/daihon-placed-text.js';

const widget = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const rule = selector => {
    const start = widget.indexOf(`${selector} {`);
    assert.ok(start >= 0, selector);
    return widget.slice(start, widget.indexOf('}', start));
};

test('playback uses background only; selected rows keep their outline and checkmark', () => {
    assert.doesNotMatch(rule('.akari-daihon-row.active'), /border-left/);
    assert.match(rule('.akari-daihon-row.active'), /background:#202b2e/);
    assert.match(rule('.akari-daihon-row.selected.active'), /box-shadow:none/);
    assert.match(rule('.akari-daihon-row.selected'), /outline:.*#f5c451/);
    assert.match(widget, /✓/);
});

test('placed bars are full-height straight four-pixel lines; selection brightens without a ring', () => {
    const bar = rule('.akari-daihon-widget .akari-daihon-placed-bar');
    for (const declaration of ['top:0', 'bottom:0', 'width:4px', 'border-radius:0']) assert.ok(bar.includes(declaration));
    assert.doesNotMatch(widget, /\.akari-daihon-placed-bar\.(first|last)\s*\{/);
    const selected = rule('.akari-daihon-widget .akari-daihon-placed-bar.selected');
    assert.match(selected, /box-shadow:none/);
    assert.match(selected, /brightness\(1\.3\)/);
});

test('nine placed captions cycle through eight registered colors in both themes, in id order', () => {
    const palette = vm.runInNewContext(widget.match(/const PLACED_TEXT_COLORS = (\[[\s\S]*?\]);/)[1]);
    assert.ok(palette.length >= 8);
    const registration = readFileSync(new URL('../../akari-theme/src/browser/akari-color-contribution.ts', import.meta.url), 'utf8');
    const tokens = palette.map(color => color.match(/--theia-akariTheme-(\w+)/)[1]);
    for (const theme of [DARK, LIGHT]) {
        assert.equal(new Set(tokens.map(token => theme[token])).size, palette.length);
        for (const token of tokens) {
            assert.match(theme[token], /^#[0-9a-f]{6}$/i);
            assert.ok(registration.includes(`id: 'akariTheme.${token}'`));
        }
    }
    const captions = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, start: 0, end: 2, text: 'text', timeDomain: 'output' })).reverse();
    const ranges = placedTextRanges(captions, [{ outStart: 0, outEnd: 2 }]);
    const assigned = ranges.map(range => palette[range.colorIndex % palette.length]);
    assert.equal(new Set(assigned).size, 8);
    assert.equal(assigned[0], assigned[8]);
    assert.deepEqual(ranges.map(range => range.captionId), captions.map(caption => caption.id).sort());
});
