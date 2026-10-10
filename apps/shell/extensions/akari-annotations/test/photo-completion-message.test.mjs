import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSourceFile } from './helpers/widget-source.mjs';
import test from 'node:test';

setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });

test('photo completion notice conjugates the action and keeps other labels intact', () => {
    const source = readSourceFile('widget').text;
    const expression = source.match(/this\.footer\.textContent = (label === t\('annotations\.timeline\.text\.eraseTheBackground'\)[^;]+);/u)?.[1];
    assert.ok(expression);
    const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/annotations.json', import.meta.url), 'utf8'));
    assert.equal(ja['annotations.timeline.text.iDeletedTheBackground'], '背景を消しました。');
    assert.equal(ja['annotations.timeline.text.iDid'], '{action}しました。');
    const message = new Function('label', 't', `return ${expression};`);
    assert.equal(message('背景を消す', annotationT), '背景を消しました。');
    assert.equal(message('エリアを追加', annotationT), 'エリアを追加しました。');
    assert.equal(message('クリップの変形を変更', annotationT), 'クリップの変形を変更しました。');
});
