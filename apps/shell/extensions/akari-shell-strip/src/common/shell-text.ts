import { getLanguage } from '@akari-video/i18n';
import * as ja from '../../../../../../packages/i18n/locales/ja/shell.json';
import * as en from '../../../../../../packages/i18n/locales/en/shell.json';

export function t(key: string, params: Record<string, string | number | null | undefined> = {}): string {
    const language = getLanguage() === 'ja' ? 'ja' : 'en';
    const catalog: Record<string, string> = language === 'ja' ? ja : en;
    const plural = typeof params.n === 'number'
        ? `${key}_${new Intl.PluralRules(language).select(params.n)}` : undefined;
    const fallback = plural?.endsWith('_one') ? `${key}_other` : plural;
    const english: Record<string, string> = en;
    const text = (plural && (catalog[plural] ?? (fallback ? catalog[fallback] : undefined) ?? english[plural] ?? (fallback ? english[fallback] : undefined)))
        ?? catalog[key] ?? english[key] ?? key;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]));
}
