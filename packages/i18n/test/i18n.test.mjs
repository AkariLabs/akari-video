import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as esm from '../index.mjs';
const cjs = createRequire(import.meta.url)('../index.cjs');

function isolatedI18n({ osLocale = 'en-US', env = {}, storage, navigatorLanguage, catalogs, warnings = [], platform = 'linux', defaults, calls = [] } = {}) {
  const source = readFileSync(new URL('../index.cjs', import.meta.url), 'utf8');
  const module = { exports: {} };
  const mockIntl = Object.create(Intl);
  mockIntl.DateTimeFormat = () => ({ resolvedOptions: () => ({ locale: osLocale }) });
  const context = {
    module,
    require: (name) => name === 'node:child_process'
      ? { execFileSync: (...args) => { calls.push(args); if (defaults instanceof Error) throw defaults; return defaults ?? ''; } }
      : { ja: catalogs?.ja ?? {}, en: catalogs?.en ?? {} },
    Intl: mockIntl,
    process: { env, platform },
    console: { warn: message => warnings.push(message) }
  };
  if (storage) context.window = { localStorage: { getItem: key => storage.get(key) ?? null } };
  if (navigatorLanguage) context.navigator = { language: navigatorLanguage };
  runInNewContext(source, context);
  return module.exports;
}

test('ESM and CJS share the catalog', () => {
  assert.equal(esm.t, cjs.t);
  assert.equal(esm.setLanguage, cjs.setLanguage);
  assert.equal(esm.t('settings.appearance.language.ja', {}, 'ja'), '日本語');
});
test('language selection and fallback', () => {
  assert.equal(esm.normalizeLanguage('fr-FR'), 'en');
  const old = process.env.AKARI_LANG;
  try {
    esm.setLanguage(undefined);
    process.env.AKARI_LANG = 'ja-JP';
    assert.equal(esm.getLanguage(), 'ja');
    process.env.AKARI_LANG = 'fr-FR';
    assert.equal(esm.getLanguage(), 'en');
    esm.setLanguage('ja');
    assert.equal(esm.getLanguage(), 'ja');
    esm.setLanguage('en');
    assert.equal(esm.getLanguage(), 'en');
  } finally { if (old === undefined) delete process.env.AKARI_LANG; else process.env.AKARI_LANG = old; esm.setLanguage(undefined); }
});
test('browser setting, auto, OS, and stored Theia locale', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const values = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: key => values.get(key) ?? null } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'ja-JP' } });
  const oldEnv = process.env.AKARI_LANG;
  try {
    delete process.env.AKARI_LANG;
    assert.equal(esm.getLanguage(), 'ja');
    values.set('akari.ui.language', 'en');
    assert.equal(esm.getLanguage(), 'en');
    values.set('akari.ui.language', 'auto');
    assert.equal(esm.getLanguage(), 'ja');
    values.set('localeId', 'en');
    assert.equal(esm.getLanguage(), 'en');
    values.delete('localeId');
    process.env.AKARI_LANG = 'de-DE';
    assert.equal(esm.getLanguage(), 'en');
    values.delete('akari.ui.language');
    values.set('localeId', 'ja');
    assert.equal(esm.getLanguage(), 'ja');
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete globalThis.navigator;
    if (oldEnv === undefined) delete process.env.AKARI_LANG; else process.env.AKARI_LANG = oldEnv;
  }
});
test('Node OS locale is used without browser storage or AKARI_LANG', () => {
  assert.equal(isolatedI18n({ osLocale: 'ja-JP' }).getLanguage(), 'ja');
  assert.equal(isolatedI18n({ osLocale: 'fr-FR' }).getLanguage(), 'en');
});
test('macOS AppleLanguages wins over shell locale and runs defaults once', () => {
  const calls = [];
  const i18n = isolatedI18n({ platform: 'darwin', osLocale: 'en-US', defaults: '(\n    "ja-JP",\n    "en-US"\n)', calls });
  assert.equal(i18n.getLanguage(), 'ja');
  assert.equal(i18n.getLanguage(), 'ja');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'defaults');
  assert.deepEqual(Array.from(calls[0][1]), ['read', '-g', 'AppleLanguages']);
  assert.equal(i18n.osLanguage(), 'ja-JP');
  assert.equal(calls.length, 1);
  assert.equal(isolatedI18n({ platform: 'darwin', navigatorLanguage: 'en-US', defaults: '(\n ja-JP\n)' }).getLanguage(), 'ja');
});
test('AKARI_LANG wins; failed or empty defaults falls back to Intl without retry', () => {
  const calls = [];
  const env = { AKARI_LANG: 'en' };
  const i18n = isolatedI18n({ platform: 'darwin', osLocale: 'ja-JP', env, defaults: new Error('missing'), calls });
  assert.equal(i18n.getLanguage(), 'en');
  assert.equal(calls.length, 0);
  delete env.AKARI_LANG;
  assert.equal(i18n.getLanguage(), 'ja');
  assert.equal(i18n.getLanguage(), 'ja');
  assert.equal(calls.length, 1);
  assert.equal(isolatedI18n({ platform: 'darwin', osLocale: 'ja-JP', defaults: '()', calls: [] }).getLanguage(), 'ja');
});
test('explicit browser setting wins over AKARI_LANG', () => {
  assert.equal(isolatedI18n({ storage: new Map([['akari.ui.language', 'ja']]), env: { AKARI_LANG: 'en' } }).getLanguage(), 'ja');
  assert.equal(isolatedI18n({ storage: new Map([['akari.ui.language', 'en']]), env: { AKARI_LANG: 'ja' } }).getLanguage(), 'en');
});
test('missing keys, interpolation and plurals', () => {
  const catalogs = {
    ja: { 'common.message.greeting': 'こんにちは {name}', 'common.items_other': '{n} 個' },
    en: { 'common.message.greeting': 'Hello {name}', 'common.items_one': '{n} item', 'common.items_other': '{n} items', 'common.fallback': 'English only' }
  };
  const { t } = isolatedI18n({ catalogs });
  assert.equal(t('common.message.greeting', { name: 'Aki' }, 'ja'), 'こんにちは Aki');
  assert.equal(t('common.items', { n: 1 }, 'en'), '1 item');
  assert.equal(t('common.items', { n: 2 }, 'en'), '2 items');
  assert.equal(t('common.items', { n: 1 }, 'ja'), '1 個');
  assert.equal(t('common.fallback', {}, 'ja'), 'English only');
  assert.equal(t('absent.key', {}, 'en'), 'absent.key');
});
test('missing key warns once in development and stays quiet in production', () => {
  const warnings = [];
  const development = isolatedI18n({ warnings, env: { NODE_ENV: 'development' } });
  assert.equal(development.t('absent.key'), 'absent.key');
  assert.deepEqual(warnings, ['Missing i18n key: absent.key']);
  const production = isolatedI18n({ warnings, env: { NODE_ENV: 'production' } });
  assert.equal(production.t('absent.key'), 'absent.key');
  assert.equal(warnings.length, 1);
});
test('Japanese currency and number retain existing form; English uses dollars', () => {
  esm.setLanguage('ja');
  assert.equal(esm.formatCurrency(1, { yenOnly: true, yenAmount: 1500 }), '¥1,500');
  assert.equal(esm.formatCurrency(0.123), '$0.123（≈ ¥18）');
  assert.equal(esm.formatCurrency(1, { yenRate: 160 }), '$1.000（≈ ¥160）');
  assert.equal(esm.formatDate(new Date('2026-10-11T00:00:00Z'), { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }), '2026/10/11');
  assert.equal(esm.formatNumber(1234), '1,234');
  assert.ok(esm.compareText('あ', 'い') < 0);
  assert.equal(esm.formatCurrency(0), '$0.000（≈ ¥0）');
  esm.setLanguage('en');
  assert.equal(esm.formatCurrency(0), 'Free');
  assert.equal(esm.formatCurrency(0.123), '$0.123');
  assert.equal(esm.formatCurrency(1.2, { precision: 2 }), '$1.20');
  const instant = new Date('2026-10-11T14:03:00Z');
  assert.equal(esm.formatDate(instant, 'time'), instant.toLocaleTimeString('en-US'));
  assert.equal(esm.formatDate(instant, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }),
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant));
  esm.setLanguage(undefined);
});
