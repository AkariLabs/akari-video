import { getLanguage } from '@akari-video/i18n';
import * as ja from '../../../../../../packages/i18n/locales/ja/project.json';
import * as en from '../../../../../../packages/i18n/locales/en/project.json';

export function t(key: string, params: Record<string, string | number> = {}): string {
    const language = getLanguage();
    const catalog: Record<string, string> = language === 'ja' ? ja : en;
    const english: Record<string, string> = en;
    const n = params.n;
    const plural = typeof n === 'number' && Number.isFinite(n)
        ? new Intl.PluralRules(language).select(n) : undefined;
    const selected = plural && (catalog[`${key}_${plural}`] !== undefined || english[`${key}_${plural}`] !== undefined)
        ? `${key}_${plural}` : key;
    const alternative = selected.endsWith('_one') ? `${key}_other` : selected;
    const text = catalog[selected] ?? catalog[alternative] ?? english[selected] ?? english[alternative] ?? selected;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]));
}
