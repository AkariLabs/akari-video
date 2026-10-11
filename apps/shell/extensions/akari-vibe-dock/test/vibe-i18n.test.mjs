import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/browser/vibe-text.js');
const ja = require('../../../../../packages/i18n/locales/ja/vibe.json');
const en = require('../../../../../packages/i18n/locales/en/vibe.json');

test('every static vibe key exists in matching catalogs', () => {
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
    walk(new URL('../src/', import.meta.url).pathname);
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    for (const key of keys) {
        assert.ok(Object.hasOwn(ja, key), `Missing Japanese: ${key}`);
        assert.ok(Object.hasOwn(en, key), `Missing English: ${key}`);
    }
    for (const key of Object.keys(ja)) {
        const params = value => [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
        assert.deepEqual(params(ja[key]), params(en[key]), `Placeholders differ: ${key}`);
    }
});

test('dock controls follow UI language', () => {
    try {
        setLanguage('ja');
        assert.equal(t('vibe.dock.point.action'), '指す');
        assert.equal(t('vibe.listening.settings.testListeningAction'), '試し聞き');
        assert.equal(t('vibe.dock.tabs.nowLabel'), 'いま');
        setLanguage('en');
        assert.equal(t('vibe.dock.point.action'), 'Point');
        assert.equal(t('vibe.dock.target.status', { name: 'Canvas' }), 'Target: Canvas');
        assert.equal(t('vibe.listening.settings.testListeningAction'), 'Test listening');
        assert.equal(t('vibe.dock.tabs.nowLabel'), 'Now');
    } finally { setLanguage(undefined); }
});
