import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/browser/transcript-text.js');
const ja = require('../../../../../packages/i18n/locales/ja/transcript.json');
const en = require('../../../../../packages/i18n/locales/en/transcript.json');

test('every static transcript key exists in matching catalogs', () => {
    const keys = new Set();
    const walk = dir => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (/\.tsx?$/.test(entry.name)) {
                const source = readFileSync(path, 'utf8');
                for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) keys.add(match[1]);
            }
        }
    };
    walk(fileURLToPath(new URL('../src/', import.meta.url)));
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    for (const key of keys) {
        assert.ok(Object.hasOwn(ja, key) || Object.hasOwn(ja, `${key}_other`), `Missing Japanese: ${key}`);
        assert.ok(Object.hasOwn(en, key) || Object.hasOwn(en, `${key}_other`), `Missing English: ${key}`);
    }
    for (const key of Object.keys(ja)) {
        const params = value => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
        assert.deepEqual(params(ja[key]), params(en[key]), `Placeholders differ: ${key}`);
    }
});

test('transcript messages preserve Japanese and support English word order', () => {
    try {
        setLanguage('ja');
        assert.equal(t('transcript.editor.seek.done', { time: '0:12' }), '0:12 にプレビューをシークしました。');
        assert.equal(t('transcript.editor.title.label'), '文字起こし');
        assert.equal(t('transcript.daihon.editor.scriptLabel'), '台本');
        assert.equal(t('transcript.editor.save.count', { n: 1 }), '1 行を保存しました');
        setLanguage('en');
        assert.equal(t('transcript.editor.seek.done', { time: '0:12' }), 'Preview seeked to 0:12.');
        assert.equal(t('transcript.editor.title.label'), 'Transcript');
        assert.equal(t('transcript.daihon.editor.scriptLabel'), 'Script');
    } finally { setLanguage(undefined); }
});
