import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('<script>window.__akariPreview = ${initialState};</script>');
const end = source.indexOf('${materialIdentity ? `<script>${materialRangeWebviewScript', start);
const outputHtml = source.slice(start, end);

test('output preview embeds each startup script once', () => {
    assert.ok(start >= 0 && end > start);
    assert.equal((outputHtml.match(/previewBootstrapScript\(\)/g) ?? []).length, 1);
    assert.equal((outputHtml.match(/previewChatReviewScript\(\)/g) ?? []).length, 1);
    assert.ok((outputHtml.match(/this\.externalScriptTag\(assets\.scrubAudioJavaScriptUrl\)/g) ?? []).length <= 1);
    assert.match(outputHtml, /<script>\$\{webviewScriptText\(previewBootstrapScript\(\)\)\}<\/script>/);
    assert.match(outputHtml, /<script>\$\{webviewScriptText\(previewChatReviewScript\(\)\)\}<\/script>/);
});
