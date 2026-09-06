import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAutonomy } from '../../lib/common/intake-autonomy.js';

const submitted = {
    version: 1,
    title: '動画',
    tasks: ['silence-cut', 'bgm-sfx'],
    target: { duration_s: 30, keep_length: false, taste: '自然に' },
    autonomy: 'checkpoint',
    status: 'submitted',
    submitted_at: '2026-09-06T00:00:00Z'
};

test('submitted: other fields and key order are preserved', () => {
    const source = `${JSON.stringify(submitted, null, 2)}\n`;
    const result = applyAutonomy(source, 'full-auto');
    assert.equal(result, source.replace('"autonomy": "checkpoint"', '"autonomy": "full-auto"'));
    assert.deepEqual(Object.keys(JSON.parse(result)), Object.keys(submitted));
});

test('draft: only autonomy changes without submitting', () => {
    const draft = { ...submitted, tasks: [], status: 'draft', submitted_at: null };
    const result = JSON.parse(applyAutonomy(JSON.stringify(draft), 'collaborative'));
    assert.deepEqual(result, { ...draft, autonomy: 'collaborative' });
});

test('autonomy outside the enum throws', () => {
    for (const value of ['invalid', '', null, undefined, 1]) {
        assert.throws(() => applyAutonomy(JSON.stringify(submitted), value));
    }
});

test('broken JSON and non-object JSON throw', () => {
    for (const source of ['{', '', 'null', '[]', '"text"', '42']) {
        assert.throws(() => applyAutonomy(source, 'checkpoint'));
    }
});

test('output uses two-space indentation and one trailing newline', () => {
    assert.equal(applyAutonomy('{"autonomy":"full-auto"}', 'checkpoint'), '{\n  "autonomy": "checkpoint"\n}\n');
});
