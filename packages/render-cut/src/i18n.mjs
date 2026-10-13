import { readFileSync } from 'node:fs';
const core = await import('../../i18n/index.mjs').catch(() => null);
const normalizeLanguage = core?.normalizeLanguage ?? ((value) => typeof value === 'string' && /^ja/i.test(value) ? 'ja' : 'en');
const getLanguage = core?.getLanguage ?? (() => normalizeLanguage(process.env.AKARI_LANG ?? Intl.DateTimeFormat().resolvedOptions().locale));

function catalog(language) {
  let base = {};
  let local = {};
  try { base = JSON.parse(readFileSync(new URL(`../../i18n/locales/${language}/render.json`, import.meta.url), 'utf8')); }
  catch {}
  try {
    local = JSON.parse(readFileSync(new URL(`./locales/${language}.json`, import.meta.url), 'utf8'));
  }
  catch {}
  return { ...base, ...local };
}

const catalogs = { ja: catalog('ja'), en: catalog('en') };

export function renderText(key, params = {}, language = getLanguage()) {
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
