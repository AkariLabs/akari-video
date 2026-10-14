import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceUrl = import.meta.url;
const require = createRequire(sourceUrl || pathToFileURL(__filename));
const roots = sourceUrl
  ? ['../../i18n', '../vendor/packages/i18n'].map(root => fileURLToPath(new URL(`${root}/`, sourceUrl)))
  : [...(process.resourcesPath ? [join(process.resourcesPath, 'packages/i18n')] : []),
    resolve(process.cwd(), '../../packages/i18n'), resolve(process.cwd(), 'packages/i18n')];
let core = null;
for (const root of roots) {
  try { core = require(join(root, 'index.cjs')); break; }
  catch { /* Try the packaged copy next. */ }
}
const normalizeLanguage = core?.normalizeLanguage ?? ((value) => typeof value === 'string' && /^ja/i.test(value) ? 'ja' : 'en');
const getLanguage = core?.getLanguage ?? (() => normalizeLanguage(process.env.AKARI_LANG ?? Intl.DateTimeFormat().resolvedOptions().locale));

function catalog(language) {
  for (const root of roots) {
    try { return JSON.parse(readFileSync(join(root, 'locales', language, 'cli.json'), 'utf8')); }
    catch { /* Try the packaged catalog next. */ }
  }
  return {};
}

const catalogs = { ja: catalog('ja'), en: catalog('en') };
export const cliLanguage = getLanguage;

export function cliText(key, params = {}, language = getLanguage()) {
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

export function cliValue(prefix, value) {
  if (getLanguage() === 'ja' || typeof value !== 'string') return value;
  const entry = Object.entries(catalogs.ja).find(([key, source]) => key.startsWith(prefix) && source === value);
  return entry ? cliText(entry[0]) : value;
}
