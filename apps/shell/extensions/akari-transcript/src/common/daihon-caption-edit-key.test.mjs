import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { daihonCaptionEditKey } = require('../../lib/common/daihon-caption-edit-key.js');

test('台本の Enter は IME 変換中に編集を閉じない', () => {
    assert.equal(daihonCaptionEditKey('Enter', true, 13), 'none');
    assert.equal(daihonCaptionEditKey('Enter', false, 229), 'none');
    assert.equal(daihonCaptionEditKey('Enter', false, 13), 'commit');
    assert.equal(daihonCaptionEditKey('Escape', false, 27), 'cancel');
});
