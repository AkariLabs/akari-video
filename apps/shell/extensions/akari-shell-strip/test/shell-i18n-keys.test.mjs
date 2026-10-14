import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ja = require('../../../../../packages/i18n/locales/ja/shell.json');
const en = require('../../../../../packages/i18n/locales/en/shell.json');
const { t } = require('../lib/common/shell-text.js');

function* sources(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(directory, item.name);
        if (item.isDirectory()) yield* sources(name);
        else if (/\.tsx?$/.test(item.name)) yield name;
    }
}

const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();

test('shell static translation keys exist in both catalogs', () => {
    const keys = new Set();
    for (const filename of sources(path.join(extension, 'src'))) {
        for (const match of fs.readFileSync(filename, 'utf8').matchAll(/\bt\(['"]([^'"]+)['"]/g)) keys.add(match[1]);
    }
    for (const key of keys) {
        assert.ok(Object.hasOwn(ja, key) || Object.hasOwn(ja, `${key}_other`), `Missing ja key: ${key}`);
        assert.ok(Object.hasOwn(en, key) || Object.hasOwn(en, `${key}_other`), `Missing en key: ${key}`);
    }
    assert.ok(keys.size > 50, 'Expected all migrated UI keys');
});

test('shell catalogs match in keys and placeholders', () => {
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    for (const key of Object.keys(ja)) assert.deepEqual(placeholders(ja[key]), placeholders(en[key]), key);
});

test('shell UI text follows selected language', () => {
    try {
        setLanguage('ja');
        assert.equal(t('shell.leftRail.export.exportAction'), '書き出し');
        setLanguage('en');
        assert.equal(t('shell.leftRail.export.exportAction'), 'Export');
        setLanguage('ja');
        assert.equal(t('shell.export.toolbarCommand.exportAction'), '書き出し…');
        setLanguage('en');
        assert.equal(t('shell.export.toolbarCommand.exportAction'), 'Export…');
        setLanguage('ja');
        assert.equal(t('shell.export.progress.preparingStatus'), '準備');
        setLanguage('en');
        assert.equal(t('shell.export.progress.preparingStatus'), 'Preparing');
        setLanguage('ja');
        assert.equal(t('shell.export.renderProgress.additionalReasons', { n: 1 }), '、他 1 件');
        assert.equal(t('shell.export.renderProgress.additionalReasons', { n: 2 }), '、他 2 件');
        setLanguage('en');
        assert.equal(t('shell.export.renderProgress.additionalReasons', { n: 2 }), ', 2 more');
        assert.equal(t('shell.settings.providers.transcriptLabel'), 'Transcript');
        setLanguage('ja');
        assert.equal(t('shell.settings.providers.transcriptLabel'), '文字起こし');
    } finally { setLanguage(undefined); }
});
