import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t } = require('../lib/common/preview-text.js');
const ja = require('../../../../../packages/i18n/locales/ja/preview.json');
const en = require('../../../../../packages/i18n/locales/en/preview.json');
const src = join(import.meta.dirname, '../src');

function* sourceFiles(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* sourceFiles(path);
        else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) yield path;
    }
}

test('every static preview t key exists in both catalogs', () => {
    let count = 0;
    for (const path of sourceFiles(src)) {
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/\bt\(\s*(['"])(preview\.[^'"]+)\1/g)) {
            count++;
            assert.ok(Object.hasOwn(ja, match[2]) || Object.hasOwn(ja, `${match[2]}_other`), `${path}: missing Japanese ${match[2]}`);
            assert.ok(Object.hasOwn(en, match[2]) || Object.hasOwn(en, `${match[2]}_other`), `${path}: missing English ${match[2]}`);
        }
    }
    assert.ok(count > 100, `expected broad preview coverage, found ${count}`);
});

test('preview catalog keys and placeholders match', () => {
    assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
    const names = text => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(match => match[1]).sort();
    for (const key of Object.keys(ja)) assert.deepEqual(names(ja[key]), names(en[key]), key);
});

test('preview window supplies translations before its scripts run', () => {
    const handler = readFileSync(join(src, 'browser/akari-preview-open-handler.ts'), 'utf8');
    assert.match(handler, /<html lang="\$\{getLanguage\(\)\}">/);
    const dictionary = handler.indexOf('<script type="application/json" id="akari-preview-text">${previewText}</script>');
    const guard = handler.indexOf('<script>${webviewScriptText(previewDiagnosticsGuardScript())}</script>');
    assert.ok(dictionary >= 0 && dictionary < guard);
    const list = handler.match(/const scriptKeys = \[([\s\S]*?)\n        \];/);
    assert.ok(list);
    const available = new Set([...list[1].matchAll(/'(preview\.[^']+)'/g)].map(match => match[1]));
    const scripts = ['preview-script-bootstrap.ts', 'preview-script-diagnostics.ts',
        'preview-script-frame-engine-bootstrap.ts', 'preview-script-frame-engine-watchdog.ts',
        'preview-script-host-adapter.ts'];
    const scriptSources = scripts.map(name => readFileSync(join(src, 'browser', name), 'utf8'));
    const serialized = new Set(scriptSources.flatMap(source => [...source.matchAll(/\b([A-Za-z]\w*)\.toString\(\)/g)]
        .map(match => match[1])));
    const commonSources = [...sourceFiles(join(src, 'common'))].map(path => readFileSync(path, 'utf8'))
        .filter(source => [...serialized].some(name => new RegExp(`\\b(?:function|const|class)\\s+${name}\\b`).test(source)));
    for (const source of [...scriptSources, ...commonSources]) {
        for (const match of source.matchAll(/\b(?:t|translate)\(\s*'(preview\.[^']+)'/g))
            assert.ok(available.has(match[1]), `webview dictionary missing ${match[1]}`);
    }
});

test('preview messages switch between original Japanese and English', () => {
    try {
        setLanguage('ja');
        assert.equal(t('preview.previewWindow.transport.playAction'), '再生');
        assert.equal(t('preview.generationOverlay.status.generatingPercentStatus', { percent: 48 }), '生成中 48%');
        assert.equal(t('preview.diagnostics.overlay.copyDiagnosticsAction'), '診断をコピー');
        setLanguage('en');
        assert.equal(t('preview.previewWindow.transport.playAction'), 'Play');
        assert.equal(t('preview.generationOverlay.status.generatingPercentStatus', { percent: 48 }), 'Generating 48%');
        assert.equal(t('preview.diagnostics.overlay.copyDiagnosticsAction'), 'Copy diagnostics');
    } finally {
        setLanguage(undefined);
    }
});

test('the sole update action is selected independently of its translated label', () => {
    const source = readFileSync(join(src, 'browser/akari-preview-open-handler.ts'), 'utf8');
    assert.match(source, /if \(choice !== undefined\)/);
    assert.doesNotMatch(source, /choice === t\(/);
    try {
        setLanguage('ja');
        assert.equal(t('preview.outputPreview.window.checkUpdatesAction'), 'アップデートを確認');
        setLanguage('en');
        assert.equal(t('preview.outputPreview.window.checkUpdatesAction'), 'Check for updates');
    } finally { setLanguage(undefined); }
});

test('long-GOP warning is injected from render catalog and translated in the frame-engine preview', () => {
    const handler = readFileSync(join(src, 'browser/akari-preview-open-handler.ts'), 'utf8');
    const bootstrap = readFileSync(join(src, 'browser/preview-script-frame-engine-bootstrap.ts'), 'utf8');
    assert.match(handler, /'render\.frameEngine\.warning\.longGop': renderT\('render\.frameEngine\.warning\.longGop'\)/);
    assert.match(bootstrap, /detail\?\.code === 'long-gop'/);
    assert.match(bootstrap, /t\('render\.frameEngine\.warning\.longGop'/);
});
