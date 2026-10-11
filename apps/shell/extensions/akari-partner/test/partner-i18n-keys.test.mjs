import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const extension = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ja = require('../../../../../packages/i18n/locales/ja/partner.json');
const en = require('../../../../../packages/i18n/locales/en/partner.json');
const { t } = require('../lib/common/partner-text.js');

function* sources(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(directory, item.name);
        if (item.isDirectory()) yield* sources(name);
        else if (/\.tsx?$/.test(item.name)) yield name;
    }
}

const placeholders = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();

test('partner static translation keys exist in both catalogs', () => {
    const keys = new Set();
    for (const filename of sources(path.join(extension, 'src'))) {
        for (const match of fs.readFileSync(filename, 'utf8').matchAll(/\bt\(['"]([^'"]+)['"]/g)) keys.add(match[1]);
    }
    for (const key of keys) {
        assert.ok(Object.hasOwn(ja, key), `Missing ja key: ${key}`);
        assert.ok(Object.hasOwn(en, key), `Missing en key: ${key}`);
    }
    assert.ok(keys.size > 50, 'Expected all migrated UI keys');
});

test('partner catalogs match in keys and placeholders', () => {
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    for (const key of Object.keys(ja)) assert.deepEqual(placeholders(ja[key]), placeholders(en[key]), key);
});

test('partner UI text follows selected language', () => {
    try {
        setLanguage('ja');
        assert.equal(t('partner.partnerPanel.onboarding.addPartnerAction'), 'パートナーを追加');
        setLanguage('en');
        assert.equal(t('partner.partnerPanel.onboarding.addPartnerAction'), 'Add partner');
        setLanguage('ja');
        assert.equal(t('partner.partnerPanel.connectDialog.preparingCliStep'), '① CLI 準備中');
        setLanguage('en');
        assert.equal(t('partner.partnerPanel.connectDialog.preparingCliStep'), '① Preparing CLI');
        setLanguage('ja');
        assert.equal(t('partner.partnerPanel.widget.checkingCliLabel'), 'CLI を確認しています…');
        setLanguage('en');
        assert.equal(t('partner.partnerPanel.widget.checkingCliLabel'), 'Checking CLI…');
        setLanguage('ja');
    } finally { setLanguage(undefined); }
});
