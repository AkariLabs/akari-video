import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { errorHtml } = require('../lib/common/error-html.js');

test('errorHtml はタグ記号を escape する', () => {
  assert.match(errorHtml('<b>broken</b>'), /&lt;b&gt;broken&lt;\/b&gt;/);
});

test('errorHtml は ampersand と引用符を escape する', () => {
  assert.match(errorHtml('a & "b"'), /a &amp; &quot;b&quot;/);
});

test('errorHtml は実行可能な script 要素を含まない', () => {
  assert.doesNotMatch(errorHtml('<script>alert(1)</script>'), /<script/i);
});

test('errorHtml は空文字でも完全な静的文書を返す', () => {
  assert.match(errorHtml(''), /^<!doctype html>[\s\S]*<pre><\/pre><\/html>$/);
});
