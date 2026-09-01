import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { rowIssues, summarizeQc, visibleLength } = require('../lib/common/daihon-qc.js');

const row = (overrides = {}) => ({
    id: 'c-0001', start: 0, end: 3, outStart: 0, outEnd: 3,
    text: 'abc', style: null,
    words: [
        { text: 'a', start: 0, end: 1 },
        { text: 'b', start: 1, end: 2 },
        { text: 'c', start: 2, end: 3 }
    ],
    fragmentBreakWordIndex: null, edited: false, timeDomain: 'source',
    ...overrides
});

test('visibleLength は空白と句読点を数えない', () => {
    assert.equal(visibleLength(' こん、にちは！\n世界。 '), 7);
});

test('8.1 字/秒は fast になる', () => {
    const issues = rowIssues(row({ text: 'あ'.repeat(81), end: 10, outEnd: 10, words: null }));
    assert.deepEqual(issues.find(issue => issue.kind === 'fast'), {
        kind: 'fast', label: '⚡ 速い 8.1 字/秒'
    });
});

test('7.9 字/秒は fast にならない', () => {
    const issues = rowIssues(row({ text: 'あ'.repeat(79), end: 10, outEnd: 10, words: null }));
    assert.equal(issues.some(issue => issue.kind === 'fast'), false);
});

test('0.59 秒は short になる', () => {
    const issues = rowIssues(row({ text: '', end: 0.59, outEnd: 0.59, words: null }));
    assert.equal(issues.some(issue => issue.kind === 'short'), true);
});

test('0.6 秒は short にならない', () => {
    const issues = rowIssues(row({ text: '', end: 0.6, outEnd: 0.6, words: null }));
    assert.equal(issues.some(issue => issue.kind === 'short'), false);
});

test('語が行の時間範囲外なら karaoke-unhealthy になる', () => {
    const words = row().words.map(word => ({ ...word }));
    words[2].end = 3.01;
    assert.equal(rowIssues(row({ words })).some(issue => issue.kind === 'karaoke-unhealthy'), true);
});

test('語の start が非単調なら karaoke-unhealthy になる', () => {
    const words = [
        { text: 'a', start: 0, end: 1 },
        { text: 'b', start: 1.5, end: 2 },
        { text: 'c', start: 1.4, end: 2.5 }
    ];
    assert.equal(rowIssues(row({ words })).some(issue => issue.kind === 'karaoke-unhealthy'), true);
});

test('語テキストの連結が本文と違えば karaoke-unhealthy になる', () => {
    assert.equal(rowIssues(row({ text: 'abd' })).some(issue => issue.kind === 'karaoke-unhealthy'), true);
});

test('karaoke style で words が無ければ karaoke-missing になる', () => {
    assert.deepEqual(rowIssues(row({ words: null, style: 'karaoke' })), [
        { kind: 'karaoke-missing', label: 'カラオケなし' }
    ]);
});

test('カット行は他の条件に関係なく issue が空になる', () => {
    assert.deepEqual(rowIssues(row({
        outStart: null, outEnd: null, end: 0.1, text: 'あ'.repeat(30), words: null, style: 'karaoke'
    })), []);
});

test('summarizeQc は issue 合計・問題行数・kind 別件数を返す', () => {
    const rows = [
        row({ id: 'fast', text: 'あ'.repeat(9), end: 1, outEnd: 1, words: null }),
        row({ id: 'short', text: '', end: 0.5, outEnd: 0.5, words: null }),
        row({ id: 'unhealthy', text: 'abd' }),
        row({ id: 'missing', words: null, style: 'reveal-word' }),
        row({ id: 'ok' })
    ];
    assert.deepEqual(summarizeQc(rows), {
        issueCount: 4,
        rowCount: 4,
        byKind: { fast: 1, short: 1, 'karaoke-unhealthy': 1, 'karaoke-missing': 1 }
    });
});
