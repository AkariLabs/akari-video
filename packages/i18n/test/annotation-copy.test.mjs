import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../index.mjs';

test('color enable switch reads Enabled in English', () => {
    assert.equal(t('annotations.inspectorWidget.text.valid', {}, 'en'), 'Enabled');
    assert.equal(t('annotations.inspectorWidget.text.valid', {}, 'ja'), '有効');
});

test('concatenated transition warning has English spacing and unchanged Japanese text', () => {
    const first = 'annotations.timeline.text.thisTransitionCannotBeExportedUsingPipOr';
    const second = 'annotations.timeline.text.pleaseDeleteItOrRevertTheFootageTo';
    assert.match(t(first, { track: '' }, 'en') + t(second, {}, 'en'), /methods\. Delete/u);
    assert.match(t(first, { track: '' }, 'ja') + t(second, {}, 'ja'), /。削除/u);
});
