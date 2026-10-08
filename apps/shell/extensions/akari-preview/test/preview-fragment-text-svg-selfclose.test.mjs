import assert from 'node:assert/strict';
import test from 'node:test';
import { patchFragmentSourceText } from '../lib/browser/fragment-source-write.js';

const source = '<div><svg><g><path d="M0 0"/><rect width="2"/></g></svg><span>Old</span></div>';
const expanded = '<div><svg><g><path d="M0 0"></path><rect width="2"></rect></g></svg><span>New</span></div>';

test('shell browser import writes only edited text across SVG self-closing tags', () => {
    assert.equal(patchFragmentSourceText(source, expanded), source.replace('Old', 'New'));
});

test('shell browser import reports the first structural difference', () => {
    const changed = expanded.replace('<rect width="2"></rect>', '<circle></circle><rect width="2"></rect>');
    assert.throws(() => patchFragmentSourceText(source, changed),
        /断片の構造が変わったため、元ソースの文字だけを安全に保存できません（最初の違い: 6 番目・元 <rect> \/ 編集後 <circle>）/u);
});

test('shell browser import reports when one tag sequence ends first', () => {
    const edited = expanded + '<i></i>';
    assert.throws(() => patchFragmentSourceText(source, edited),
        /最初の違い: 13 番目・元 なし \/ 編集後 <i>/u);
});
