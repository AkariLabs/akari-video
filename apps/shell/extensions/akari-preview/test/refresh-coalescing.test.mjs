import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = code.indexOf('    queueRefresh(');
const rest = code.slice(start);
const method = rest.slice(0, rest.indexOf('\n    }') + 6);
const Handler = new Function(`return class {${method}}`)();
function fixture() {
    let source = 'a';
    const calls = [], release = [];
    const widget = { id: 'preview', akariPreviewEditUri: { normalizePath() { return this; }, toString() { return 'edit'; } } };
    const h = Object.assign(new Handler(), {
        previewGestures: new Map(), deferredPreviewRefresh: new Map(), reviewTransportByEdit: new Map(),
        readText: async () => source, waitForTimelineWrites: async () => {},
        async refreshPreview(w) {
            const snapshot = source;
            calls.push(snapshot);
            await new Promise(resolve => release.push(resolve));
            w.akariPreviewRenderedEditSource = snapshot;
        }
    });
    return { h, widget, calls, release, setSource(value) { source = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('commit and watcher notifications for identical content rebuild once', async () => {
    const f = fixture();
    f.h.queueRefresh(f.widget, {}, 'output', undefined, true);
    await settle();
    f.h.queueRefresh(f.widget, {}, 'output', undefined, true);
    f.release[0]();
    await f.widget.akariPreviewRefresh;
    assert.deepEqual(f.calls, ['a']);
});
test('newer edits and explicit media refreshes are not discarded', async () => {
    const f = fixture();
    f.h.queueRefresh(f.widget, {}, 'output', undefined, true);
    await settle();
    f.setSource('b');
    f.h.queueRefresh(f.widget, {}, 'output', undefined, true);
    f.release[0]();
    await settle();
    assert.deepEqual(f.calls, ['a', 'b']);
    f.release[1]();
    await f.widget.akariPreviewRefresh;
    f.h.queueRefresh(f.widget, {}, 'output');
    await settle();
    assert.deepEqual(f.calls, ['a', 'b', 'b']);
    f.release[2]();
    await f.widget.akariPreviewRefresh;
});
