import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { captionInkClientRect } from '../lib/common/caption-ink-rect.js';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');

test('強調 DOM 更新中の幅 0 の行を捨て、強調文字を含む実寸へ選択枠を合わせる', () => {
    const topLeft = { left: 0, top: 0, right: 0, bottom: 48 };
    const caption = { left: 220, top: 500, right: 660, bottom: 580 };
    const emphasis = { left: 280, top: 480, right: 390, bottom: 585 };
    assert.deepEqual(captionInkClientRect([topLeft, caption, emphasis]), {
        left: 220, top: 480, right: 660, bottom: 585
    });
    assert.equal(captionInkClientRect([topLeft]), null);
    assert.match(source, /querySelectorAll\('\.akari-caption__tok--emphasis'\)/u);
    assert.match(source, /typeof captionInkClientRectFn === 'function'\s*\? captionInkClientRectFn\(rects\)/u);
});

test('選択中の字幕行を組み直した後も ResizeObserver と次フレームで枠を再測定する', () => {
    const start = source.indexOf('            let captionSelectionFrame = 0;');
    const end = source.indexOf('            const selectCaption =', start);
    assert.ok(start >= 0 && end > start);
    const frames = [];
    const observed = [];
    let measurements = 0;
    let observer;
    const ink = {};
    const context = vm.createContext({
        selectedCaptionId: 'c-0002',
        selectedCaptionPlate: () => ({ isConnected: true, querySelectorAll: () => [ink] }),
        updateCaptionSelectBox: () => { measurements++; },
        window: { requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
            cancelAnimationFrame() {} },
        ResizeObserver: class { constructor(callback) { observer = { callback }; }
            disconnect() {} observe(target) { observed.push(target); } }
    });
    vm.runInContext(source.slice(start, end) + '\nglobalThis.watch = watchSelectedCaptionInk;', context);
    context.watch();
    assert.equal(observed[0], ink);
    frames.shift()();
    assert.equal(measurements, 1);
    observer.callback();
    frames.shift()();
    assert.equal(measurements, 2);
    assert.match(source, /if \(\(caption\?\.sourceCueId \|\| caption\?\.id\) === selectedCaptionId\) \{\s*if \(typeof watchSelectedCaptionInk === 'function'\) watchSelectedCaptionInk\(\)/u);
});
