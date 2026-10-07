import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { RoughCanvasDockTab } = require('../lib/browser/rough-canvas-dock-tab.js');
const { RoughCanvasEarBridge } = require('../lib/browser/rough-canvas-ear-bridge.js');

test('frontend module registers the tab and ear bridge contributions', () => {
    const module = readFileSync(new URL('../src/browser/akari-vibe-dock-frontend-module.ts', import.meta.url), 'utf8');
    assert.match(module, /bind\(VibeDockTabContributionSymbol\)\.toService\(RoughCanvasDockTab\)/);
    assert.match(module, /bind\(FrontendApplicationContribution\)\.toService\(RoughCanvasEarBridge\)/);
});

function event(type, detail) {
    const value = new Event(type);
    Object.defineProperty(value, 'detail', { value: detail });
    return value;
}

function element() {
    const listeners = new Map();
    return {
        textContent: '', className: '', children: [],
        addEventListener: (name, listener) => listeners.set(name, listener),
        setAttribute() {},
        replaceChildren(...children) { this.children = children; },
        append(...children) { this.children.push(...children); },
        click() { listeners.get('click')?.(); }
    };
}

test('canvas tab opens the sketch command and updates and removes its status listener', () => {
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    const target = new EventTarget();
    globalThis.window = target;
    globalThis.document = { createElement: element };
    try {
        const commands = [];
        const tab = new RoughCanvasDockTab();
        tab.commands = { executeCommand: id => { commands.push(id); return Promise.resolve(); } };
        assert.equal(tab.id, 'canvas');
        assert.equal(tab.order, 40);
        const host = element();
        const disposable = tab.render(host, {});
        const [button, status] = host.children;
        assert.equal(button.className, 'theia-button secondary');
        assert.equal(status.textContent, '紙は開いていません');
        button.click();
        assert.deepEqual(commands, ['akari.sketch.open']);
        target.dispatchEvent(event('akari.sketch.state', { open: true, count: 2 }));
        assert.equal(status.textContent, '紙を開いています（2 枚）');
        target.dispatchEvent(event('akari.sketch.state', { open: false, count: 2 }));
        assert.equal(status.textContent, '紙は開いていません');
        disposable.dispose();
        target.dispatchEvent(event('akari.sketch.state', { open: true, count: 3 }));
        assert.equal(status.textContent, '紙は開いていません');
        assert.deepEqual(host.children, []);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test('ear bridge maps opened and closed events without transcript access; failures are contained', async () => {
    const previousWindow = globalThis.window, previousWarn = console.warn;
    const target = new EventTarget();
    globalThis.window = target;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        const calls = [];
        const bridge = new RoughCanvasEarBridge();
        bridge.ear = {
            notifyRoughCanvas: value => { calls.push(value); return calls.length === 2 ? Promise.reject(new Error('offline')) : Promise.resolve(); },
            takeTranscript: () => { throw new Error('must not read transcript'); }
        };
        bridge.onStart();
        target.dispatchEvent(event('akari.sketch.opened', { key: 'draft-1', at: 12 }));
        target.dispatchEvent(event('akari.sketch.closed', { key: 'draft-1', at: 13 }));
        await new Promise(setImmediate);
        assert.deepEqual(calls, [
            { type: 'roughCanvas.opened', canvasId: 'draft-1', at: 12 },
            { type: 'roughCanvas.closed', canvasId: 'draft-1', at: 13 }
        ]);
        assert.equal(warnings.length, 1);
        bridge.ear.notifyRoughCanvas = () => { throw new Error('offline'); };
        assert.doesNotThrow(() => target.dispatchEvent(event('akari.sketch.opened', { key: 'c-0001', at: 14 })));
        assert.equal(warnings.length, 2);
        bridge.onStop();
        target.dispatchEvent(event('akari.sketch.closed', { key: 'c-0001', at: 15 }));
        assert.equal(calls.length, 2);
    } finally {
        globalThis.window = previousWindow;
        console.warn = previousWarn;
    }
});
