import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { AkariLocalizationContribution } from '../../lib/node/akari-localization-contribution.js';

const require = createRequire(import.meta.url);
const { LocalizationProvider } = require('@theia/core/lib/node/i18n/localization-provider');
const { LocalizationRegistry } = require('@theia/core/lib/node/i18n/localization-contribution');
const { TheiaLocalizationContribution } = require('@theia/core/lib/node/i18n/theia-localization-contribution');
const { I18nPreloadContribution } = require('@theia/core/lib/browser/preload/i18n-preload-contribution');
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
const { nls } = require('@theia/core/lib/common/nls');
const { getLanguage, setLanguage } = require('@akari-video/i18n');

test('Japanese AKARI text does not enable Theia Japanese translations', async () => {
    const provider = new LocalizationProvider();
    const registry = new LocalizationRegistry();
    registry.localizationProvider = provider;
    await new TheiaLocalizationContribution().registerLocalizations(registry);
    await new AkariLocalizationContribution().registerLocalizations(registry);

    const ja = await provider.loadLocalization('ja');
    const en = await provider.loadLocalization('en');
    const menuKey = 'terminal:profile:default';
    assert.equal(ja.translations[menuKey], 'デフォルトのターミナルプロファイルを選択');
    assert.notEqual(ja.languagePack, true);
    assert.deepEqual(provider.getAvailableLanguages().map(language => language.languageId), ['en']);
    assert.equal(en.languagePack, true);
    assert.deepEqual(en.translations, {});

    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousLocale = Object.getOwnPropertyDescriptor(nls, 'locale');
    const previousLocalization = Object.getOwnPropertyDescriptor(nls, 'localization');
    const storage = new Map([['akari.ui.language', 'auto'], ['localeId', 'ja']]);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        localStorage: { getItem: key => storage.get(key) ?? null }
    } });
    try {
        FrontendApplicationConfigProvider.set({});
        const preload = new I18nPreloadContribution();
        preload.localizationServer = provider;
        preload.replacementContributions = { getContributions: () => [] };
        delete nls.localization;
        nls.locale = 'ja';
        setLanguage(undefined);

        await preload.initialize();
        assert.equal(nls.locale, undefined);
        assert.equal(nls.localization, undefined);
        assert.equal(nls.localize(menuKey, 'Select Default Terminal Profile'), 'Select Default Terminal Profile');
        assert.equal(getLanguage(), 'ja');

        storage.set('localeId', 'en');
        nls.locale = 'en';
        await preload.initialize();
        assert.equal(nls.localization.languagePack, true);
        assert.deepEqual(nls.localization.translations, {});
        assert.equal(getLanguage(), 'en');
    } finally {
        setLanguage(undefined);
        if (previousLocale) Object.defineProperty(nls, 'locale', previousLocale);
        else delete nls.locale;
        if (previousLocalization) Object.defineProperty(nls, 'localization', previousLocalization);
        else delete nls.localization;
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else delete globalThis.window;
    }
});
