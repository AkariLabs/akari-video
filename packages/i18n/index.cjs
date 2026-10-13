'use strict';

const { ja, en } = require('./locales/index.cjs');
const LANGUAGE_KEY = 'akari.ui.language';
const LOCALE_KEY = 'localeId';
let languageOverride;
let macOsLanguage;
let childProcessLanguage;
const inheritedAkariLang = typeof process !== 'undefined' ? process.env?.AKARI_LANG : undefined;

function normalizeLanguage(value) {
  return typeof value === 'string' && /^ja/i.test(value) ? 'ja' : 'en';
}

function readStorage(key) {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; }
  catch { return null; }
}

function osLanguage() {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  if (typeof process !== 'undefined' && process.platform === 'darwin') {
    if (macOsLanguage === undefined) {
      macOsLanguage = null;
      try {
        const { execFileSync } = require('node:child_process');
        const output = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], {
          encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']
        });
        const first = output.match(/^\s*\(\s*"?([a-z]{2,3}(?:[-_][a-z0-9]+)*)"?/i);
        macOsLanguage = first?.[1] ?? null;
      } catch { /* An unavailable defaults command falls back to Intl. */ }
    }
    if (macOsLanguage) return macOsLanguage;
  }
  try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en'; }
  catch { return 'en'; }
}

function getLanguage() {
  if (languageOverride) return languageOverride;
  const setting = readStorage(LANGUAGE_KEY);
  if (setting === 'ja' || setting === 'en') return setting;
  const selected = readStorage(LOCALE_KEY);
  if (selected) return normalizeLanguage(selected);
  if (typeof process !== 'undefined' && process.env?.AKARI_LANG) return normalizeLanguage(process.env.AKARI_LANG);
  return normalizeLanguage(osLanguage());
}

function setLanguage(language) {
  if (language === undefined || language === 'auto') { languageOverride = undefined; return getLanguage(); }
  languageOverride = normalizeLanguage(language);
  return languageOverride;
}

function setChildProcessLanguage(choice) {
  childProcessLanguage = choice === 'ja' || choice === 'en' ? choice : undefined;
  if (typeof process !== 'undefined' && process.env) {
    const language = childProcessLanguage ?? inheritedAkariLang;
    if (language === undefined) delete process.env.AKARI_LANG;
    else process.env.AKARI_LANG = language;
  }
}

function childProcessEnv(base = process.env) {
  const env = { ...base };
  const language = childProcessLanguage ?? inheritedAkariLang;
  if (language === undefined) delete env.AKARI_LANG;
  else env.AKARI_LANG = language;
  return env;
}

function t(key, params = {}, language = getLanguage()) {
  const chosen = language === 'ja' ? ja : en;
  const count = Number(params.n);
  const suffix = Number.isFinite(count) ? new Intl.PluralRules(language).select(count) : null;
  const requested = suffix && (Object.hasOwn(chosen, `${key}_${suffix}`) || Object.hasOwn(en, `${key}_${suffix}`)) ? `${key}_${suffix}` : key;
  const fallback = requested.endsWith('_one') ? `${key}_other` : requested;
  const value = chosen[requested] ?? chosen[fallback] ?? en[requested] ?? en[fallback];
  if (value === undefined) {
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') console.warn(`Missing i18n key: ${requested}`);
    return requested;
  }
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => params[name] === undefined ? match : String(params[name]));
}

function intlLocale() { return getLanguage() === 'ja' ? 'ja-JP' : 'en-US'; }
function formatDate(value, style) {
  const date = value instanceof Date ? value : new Date(value);
  if (style === 'time') return date.toLocaleTimeString(intlLocale());
  if (style === 'date') return date.toLocaleDateString(intlLocale());
  if (style && typeof style === 'object') {
    const options = style.options ?? style;
    if (style.kind === 'time') return date.toLocaleTimeString(intlLocale(), options);
    return new Intl.DateTimeFormat(intlLocale(), options).format(date);
  }
  return date.toLocaleString(intlLocale());
}
function formatNumber(value, options) { return new Intl.NumberFormat(intlLocale(), options).format(value); }
function formatCurrency(amountUsd, { yenRate = 150, yenAmount, yenOnly = false, precision = 3 } = {}) {
  if (getLanguage() === 'en') return amountUsd === 0 ? 'Free' : `$${Number(amountUsd).toFixed(precision)}`;
  if (yenOnly) return `¥${formatNumber(yenAmount ?? Math.round(amountUsd * yenRate))}`;
  return `$${Number(amountUsd).toFixed(precision)}（≈ ¥${Math.round(amountUsd * yenRate)}）`;
}
function compareText(a, b, options) { return String(a).localeCompare(String(b), intlLocale(), options); }

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function usableText(value) { return typeof value === 'string' && /\S/u.test(value) ? value : undefined; }
function usableAliases(value) {
  if (!Array.isArray(value)) return undefined;
  const aliases = value.filter(alias => usableText(alias) !== undefined);
  return aliases.length ? aliases : undefined;
}
function translation(record, language) {
  const entries = isRecord(record?.i18n) ? record.i18n : undefined;
  return isRecord(entries?.[language]) ? entries[language] : undefined;
}
function localizedValue(record, field, language) {
  const usable = field === 'aliases' ? usableAliases : usableText;
  return (language === 'ja' ? undefined : usable(translation(record, language)?.[field]))
    ?? (language === 'ja' ? undefined : usable(translation(record, 'en')?.[field]))
    ?? usable(record?.[field])
    ?? (field === 'title' || field === 'name' ? usableText(record?.id) : undefined);
}
function localizedAssetText(meta, field, language) {
  return localizedValue(meta, field, language);
}
function localizedPresetText(row, field, language) {
  return localizedValue(row, field, language);
}
function localizedKnobGroup(meta, group, language) {
  const base = usableText(group);
  if (!base) return group;
  if (language === 'ja') {
    const key = `inspector.knobGroup.${base}.label`;
    return Object.hasOwn(ja, key) ? t(key, {}, 'ja') : base;
  }
  const translated = lang => {
    const groups = translation(meta, lang)?.groups;
    return isRecord(groups) ? usableText(groups[base]) : undefined;
  };
  return translated(language) ?? translated('en') ?? base;
}
function translatedKnobLabel(meta, knob, language) {
  if (language === 'ja') return undefined;
  const key = usableText(knob?.cssVar) ?? usableText(knob?.param) ?? usableText(knob?.name);
  const translated = lang => {
    const knobs = translation(meta, lang)?.knobs;
    return isRecord(knobs) ? usableText(knobs[key]) : undefined;
  };
  return translated(language) ?? translated('en');
}
function localizedKnobLabel(meta, knob, language) {
  const key = usableText(knob?.cssVar) ?? usableText(knob?.param) ?? usableText(knob?.name);
  return translatedKnobLabel(meta, knob, language) ?? usableText(knob?.label) ?? key;
}

module.exports = { localizedAssetText, localizedPresetText, localizedKnobGroup, localizedKnobLabel, translatedKnobLabel, t, getLanguage, setLanguage, setChildProcessLanguage, childProcessEnv, normalizeLanguage, osLanguage, formatDate, formatNumber, formatCurrency, compareText };
