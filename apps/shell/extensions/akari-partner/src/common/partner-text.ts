import { getLanguage } from '@akari-video/i18n';
import * as ja from '../../../../../../packages/i18n/locales/ja/partner.json';
import * as en from '../../../../../../packages/i18n/locales/en/partner.json';

export function catalogMessages(): Record<string, string> {
    return { ...en, ...(getLanguage() === 'ja' ? ja : {}) };
}

export function t(key: string, params: Record<string, string | number | null | undefined> = {}): string {
    const language = getLanguage() === 'ja' ? 'ja' : 'en';
    const catalog: Record<string, string> = language === 'ja' ? ja : en;
    const plural = typeof params.n === 'number'
        ? `${key}_${new Intl.PluralRules(language).select(params.n)}` : undefined;
    const english: Record<string, string> = en;
    const text = (plural && (catalog[plural] ?? english[plural])) ?? catalog[key] ?? english[key] ?? key;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]));
}
