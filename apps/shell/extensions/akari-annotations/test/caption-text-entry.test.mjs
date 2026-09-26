import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captionEditFocusWithinMarkedWidget } from '../lib/common/caption-edit-focus.js';

const inspector = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const contextBar = readFileSync(new URL('../src/browser/context-bar-controller.ts', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../../akari-preview/src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('forwarded iframe keys are ignored by the context bar while caption edit owns focus', () => {
    const iframe = {};
    const marked = { contains: node => node === iframe };
    assert.equal(captionEditFocusWithinMarkedWidget(iframe, [marked]), true);
    assert.equal(captionEditFocusWithinMarkedWidget({}, [marked]), false);
    const keydown = contextBar.slice(contextBar.indexOf('protected handleKeydown(event: KeyboardEvent)'));
    assert.match(keydown, /captionEditFocusWithinMarkedWidget\(document\.activeElement,[\s\S]*?data-akari-caption-editing-focus="true"[\s\S]*?\)\) return;/);
    assert.ok(keydown.indexOf('captionEditFocusWithinMarkedWidget') < keydown.indexOf('const inPreview'));
    assert.match(preview, /shouldStopEditableDeletionKeydownFn\([\s\S]*?event\.stopPropagation\(\)/);
});

test('caption textarea keeps original newlines on blur and saves added newlines', async () => {
    assert.match(inspector, /name: 'caption-text', label: 'テキスト', inputKind: 'caption-text'/);
    assert.match(inspector, /field\.inputKind === 'caption-text'\) \{\s*const textarea = document\.createElement\('textarea'\)/);
    assert.match(inspector, /textarea\.rows = 2;\s*textarea\.value = editValue;/);
    assert.match(inspector, /textarea\.addEventListener\('input', fit\)/);
    assert.match(inspector, /key === 'Enter' && \(navigator\.platform\.includes\('Mac'\) \? keyboard\.metaKey : keyboard\.ctrlKey\)/);
    assert.match(inspector, /key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*input\.value = editValue;\s*input\.blur\(\)/);
    const start = inspector.indexOf('const commitValue = async (nextValue: string');
    const end = inspector.indexOf("if (field.inputKind === 'slider-number')", start);
    assert.ok(start >= 0 && end > start);
    const body = inspector.slice(start, end).replace(/: string/g, '').replace(/: \(\) => void/g, '')
        .replace(/: Promise<boolean>/g, '');
    const writes = [];
    const original = '一行目\n二行目';
    const commit = new Function('editValue', 'write', 'snapshot', `${body}; return commitValue;`)(
        original, async (_snapshot, value) => { writes.push(value); return { ok: true }; }, {}
    );
    assert.equal(await commit(original, () => {}), true);
    assert.deepEqual(writes, []);
    assert.equal(await commit('一行目\n二行目\n三行目', () => {}), true);
    assert.deepEqual(writes, ['一行目\n二行目\n三行目']);
});
