import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { CAPTION_PANEL_FONTS, CAPTION_PANEL_FONT_EN_TITLES } from '../lib/common/caption-panel-catalog.js';
import { captionPanelFontControlName, captionPanelFontName } from '../lib/browser/inspector/caption-panels.js';
import { libraryFontLabel } from '../../akari-project/lib/common/library-font-label.js';

test('caption and library shelves show the same English font name from catalog metadata', () => {
    const root = new URL('../../../../../', import.meta.url);
    const catalog = new URL('catalog/font/', root);
    const ids = readdirSync(catalog).filter(id => existsSync(new URL(`${id}/meta.json`, catalog)));
    assert.equal(ids.length, CAPTION_PANEL_FONTS.length);
    for (const id of ids) {
        const meta = JSON.parse(readFileSync(new URL(`${id}/meta.json`, catalog), 'utf8'));
        const font = CAPTION_PANEL_FONTS.find(entry => entry.id === id);
        assert.ok(font, id);
        assert.equal(CAPTION_PANEL_FONT_EN_TITLES[id], meta.i18n.en.title);
        assert.equal(captionPanelFontName(font, 'en'), libraryFontLabel(id, meta.i18n.en.title, meta.title, 'en').display);
        assert.equal(captionPanelFontName(font, 'ja'), font.displayName ?? font.title);
        assert.equal(captionPanelFontControlName(font, 'ja'), font.title);
        assert.equal(captionPanelFontControlName(font, 'en'), meta.i18n.en.title);
    }
});

test('recent-font button and weight-toggle name keep the Japanese base title', () => {
    const font = CAPTION_PANEL_FONTS.find(entry => entry.displayName && entry.displayName !== entry.title);
    assert.ok(font);
    assert.equal(captionPanelFontControlName(font, 'ja'), font.title);
    assert.notEqual(captionPanelFontControlName(font, 'ja'), captionPanelFontName(font, 'ja'));
    const source = readFileSync(new URL('../src/browser/inspector/caption-panels.ts', import.meta.url), 'utf8');
    assert.match(source, /button\(document, captionPanelFontControlName\(font, getLanguage\(\)\)/u);
    assert.match(source, /fontName: captionPanelFontControlName\(font, getLanguage\(\)\)/u);
});

test('library font label defaults to the active UI language', () => {
    const font = CAPTION_PANEL_FONTS.find(entry => entry.id === 'noto-sans-jp');
    assert.ok(font);
    try {
        setLanguage('en');
        assert.equal(libraryFontLabel(font.id, CAPTION_PANEL_FONT_EN_TITLES[font.id], font.title).display,
            captionPanelFontName(font, 'en'));
        setLanguage('ja');
        assert.equal(libraryFontLabel(font.id, font.title, font.title).display, font.displayName);
    } finally { setLanguage(undefined); }
});
