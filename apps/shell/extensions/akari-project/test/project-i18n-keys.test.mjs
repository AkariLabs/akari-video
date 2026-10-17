import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/common/project-text.js');
const ja = require('../../../../../packages/i18n/locales/ja/project.json');
const en = require('../../../../../packages/i18n/locales/en/project.json');
const sourceRoot = new URL('../src/', import.meta.url);

function* sources(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) yield* sources(file);
        else if (/\.tsx?$/.test(entry.name)) yield file;
    }
}

function placeholders(value) {
    return [...new Set([...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]))].sort();
}

test('all static project t() keys exist in both catalogs', () => {
    const keys = new Set();
    for (const file of sources(sourceRoot.pathname)) {
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) keys.add(match[1]);
    }
    assert.ok(keys.size > 500, `expected broad coverage, found ${keys.size} keys`);
    for (const key of keys) {
        assert.ok(Object.hasOwn(ja, key) || Object.hasOwn(ja, `${key}_other`), `missing ja key: ${key}`);
        assert.ok(Object.hasOwn(en, key) || Object.hasOwn(en, `${key}_other`), `missing en key: ${key}`);
    }
});

test('project catalogs have identical keys and placeholders', () => {
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    for (const key of Object.keys(ja)) assert.deepEqual(placeholders(ja[key]), placeholders(en[key]), key);
});

test('project keys describe their UI role without numbered placeholders or source folders', () => {
    for (const key of Object.keys(en)) {
        assert.match(key, /^project(?:\.[a-z][a-zA-Z0-9]*){3,}(?:_(?:one|other))?$/);
        assert.doesNotMatch(key, /(?:text|message|label|item|entry|string)\d+$/i);
        assert.doesNotMatch(key, /\.(?:browser|common|node|electronMain)\./);
    }
});

test('project text follows the selected language and plural rules', () => {
    try {
        setLanguage('ja');
        assert.equal(t('project.materials.inspector.assetInformationLabel'), '素材の情報');
        assert.equal(t('project.library.home.brandKitLabel'), 'チャンネルの設定');
        assert.equal(t('project.catalog.breakdown.count', { n: 1 }), '1 件');
        setLanguage('en');
        assert.equal(t('project.materials.inspector.assetInformationLabel'), 'Asset information');
        assert.equal(t('project.library.home.brandKitLabel'), 'Channel settings');
        assert.equal(t('project.catalog.breakdown.count', { n: 1 }), '1 item');
        assert.equal(t('project.catalog.breakdown.count', { n: 2 }), '2 items');
    } finally {
        setLanguage(undefined);
    }
});
