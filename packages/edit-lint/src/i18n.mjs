import { readFileSync } from 'node:fs';
const core = await import('../../i18n/index.mjs').catch(() => null);
const normalizeLanguage = core?.normalizeLanguage ?? ((value) => typeof value === 'string' && /^ja/i.test(value) ? 'ja' : 'en');
const getLanguage = core?.getLanguage ?? (() => normalizeLanguage(process.env.AKARI_LANG ?? Intl.DateTimeFormat().resolvedOptions().locale));

function catalog(language) {
  try { return JSON.parse(readFileSync(new URL(`../../i18n/locales/${language}/lint-messages.json`, import.meta.url), 'utf8')); }
  catch { return {}; }
}

const catalogs = { ja: catalog('ja'), en: catalog('en') };

export function lintLanguage() {
  return normalizeLanguage(getLanguage());
}

export function lintText(key, params = {}, language = getLanguage()) {
  const selectedLanguage = normalizeLanguage(language);
  const chosen = catalogs[selectedLanguage];
  const n = Number(params.n);
  const suffix = Number.isFinite(n) ? new Intl.PluralRules(selectedLanguage).select(n) : null;
  const requested = suffix && (Object.hasOwn(chosen, `${key}_${suffix}`) || Object.hasOwn(catalogs.en, `${key}_${suffix}`))
    ? `${key}_${suffix}` : key;
  const fallback = requested.endsWith('_one') ? `${key}_other` : requested;
  const value = chosen[requested] ?? chosen[fallback] ?? catalogs.en[requested] ?? catalogs.en[fallback] ?? key;
  return value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) => params[name] === undefined ? match : String(params[name]));
}

/** Keep diagnostics readable while their catalog entries are being added. */
export function lintTextWithFallback(key, params, fallback) {
  const translated = lintText(key, params);
  return translated === key ? fallback : translated;
}

export function lintValue(prefix, value) {
  if (getLanguage() === 'ja' || typeof value !== 'string') return value;
  const entry = Object.entries(catalogs.ja).find(([key, source]) => key.startsWith(prefix) && source === value);
  return entry ? lintText(entry[0]) : value;
}
