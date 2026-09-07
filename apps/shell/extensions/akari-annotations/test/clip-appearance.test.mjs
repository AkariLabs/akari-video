import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
function method(name) {
    const start = source.indexOf(`    ${name}(`);
    assert.ok(start >= 0);
    const rest = source.slice(start);
    return rest.slice(0, rest.indexOf('\n    }') + 6);
}
const Widget = new Function(`return class {${['renderClipMedia', 'cutDisplayName'].map(method).join('\n')}}`)();
test('video thumbnails stay rendered below the former width and height thresholds', () => {
    const calls = [];
    const widget = Object.assign(new Widget(), {
        cutVideoUri: () => 'file:///video.mp4',
        clipLocalGeometry: () => ({fullClipWidthPx: 10, clipLocalOffsetPx: 0}),
        renderFilmstripCells: (...args) => {calls.push(args); return 'ok';},
        waveformCache: new Map([[':0:2', 'unavailable']])
    });
    for (const [width, height] of [[100,72], [39,71], [10,36], [1,28]]) {
        widget.renderClipMedia({}, {in:0,out:2}, width, {}, height);
        assert.equal(calls.at(-1)[1], width);
        assert.equal(calls.at(-1)[5], height);
    }
    assert.equal(calls.length,4);
});
test('imported video and cut source names use the original filename', () => {
    const widget = Object.assign(new Widget(), {
        pathBaseName: path => path.split('/').pop(),
        defaultSource: {path:'assets/red.mp4'},
        sources: [{id:'camera-b'}],
        sourceMap: new Map([['camera-b',{path:'assets/blue.mp4'}]])
    });
    assert.equal(widget.cutDisplayName({}), 'red.mp4');
    assert.equal(widget.cutDisplayName({src:'camera-b'}), 'blue.mp4');
});
