import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('caption tools reach the host through a bridge defined in the adapter scope', () => {
    const adapterStart = source.indexOf('protected hostAdapterScript(): string');
    const bootstrapStart = source.indexOf('protected previewBootstrapScript(): string');
    const adapter = source.slice(adapterStart, bootstrapStart);
    const bootstrap = source.slice(bootstrapStart);
    const bridgeStart = adapter.indexOf('window.akari.requestCaptionInspector = field =>');
    const bridgeEnd = adapter.indexOf('};', bridgeStart) + 2;
    const toolStart = bootstrap.indexOf('const requestCaptionInspector = field =>');
    const toolEnd = bootstrap.indexOf('};', toolStart) + 2;
    assert.ok(adapterStart >= 0 && bootstrapStart > adapterStart && bridgeStart >= 0 && bridgeEnd > bridgeStart);
    assert.ok(toolStart >= 0 && toolEnd > toolStart);
    assert.ok(adapter.indexOf('const vscode = acquireVsCodeApi();') < bridgeStart);
    assert.doesNotMatch(bootstrap, /\bvscode\.postMessage\(/,
        'the other script IIFE must not reference the adapter-local vscode');

    const messages = [];
    const sharedWindow = { akari: {} };
    vm.runInNewContext(adapter.slice(bridgeStart, bridgeEnd), {
        window: sharedWindow, vscode: { postMessage: message => messages.push(message) }
    });
    const tools = vm.createContext({ window: sharedWindow });
    vm.runInContext(bootstrap.slice(toolStart, toolEnd), tools);
    for (const field of ['caption-style', 'caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color']) {
        vm.runInContext(`requestCaptionInspector('${field}')`, tools);
    }
    assert.deepEqual(messages.map(message => ({ ...message })), [
        'caption-style', 'caption-style-color', 'caption-style-stroke-color', 'caption-style-bg-color'
    ].map(field => ({ type: 'akari-preview-caption-inspector', field })));
    assert.match(bootstrap, /captionTool\('inspector'\)\.addEventListener\('click', \(\) => requestCaptionInspector\('caption-style'\)\)/);
    assert.match(bootstrap, /\[data-palette-more\][\s\S]*requestCaptionInspector\(captionPaletteTab/);
});
