import { getLanguage } from '@akari-video/i18n';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ja: Record<string, string> = require('../../../../../../packages/i18n/locales/ja/vibe.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require('../../../../../../packages/i18n/locales/en/vibe.json');

export function t(key: string, params: Record<string, string | number> = {}): string {
    const language = getLanguage();
    const catalog: Record<string, string> = language === 'ja' ? ja : en;
    const count = params.n;
    const suffix = typeof count === 'number' && (catalog[`${key}_one`] || catalog[`${key}_other`])
        ? `_${new Intl.PluralRules(language).select(count)}` : '';
    const text = catalog[key + suffix] ?? en[key + suffix] ?? catalog[key] ?? en[key] ?? key;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]));
}
