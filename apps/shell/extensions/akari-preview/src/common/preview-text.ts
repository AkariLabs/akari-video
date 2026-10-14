import { getLanguage } from '@akari-video/i18n';
import * as ja from '../../../../../../packages/i18n/locales/ja/preview.json';
import * as en from '../../../../../../packages/i18n/locales/en/preview.json';

export function t(key: string, params: Record<string, string | number> = {}): string {
    const language = getLanguage();
    const catalog: Record<string, string> = language === 'ja' ? ja : en;
    const english: Record<string, string> = en;
    let selected = key;
    if (typeof params.n === 'number' && (catalog[`${key}_one`] !== undefined || catalog[`${key}_other`] !== undefined
        || english[`${key}_one`] !== undefined || english[`${key}_other`] !== undefined)) {
        selected += language === 'ja' ? '_other' : `_${new Intl.PluralRules(language).select(params.n)}`;
    }
    const text = catalog[selected] ?? english[selected]
        ?? (selected.endsWith('_one') ? catalog[`${key}_other`] ?? english[`${key}_other`] : undefined)
        ?? key;
    return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
        params[name] === undefined ? match : String(params[name]));
}

export function scriptDictionary(values: Record<string, string>): string {
    return JSON.stringify(values).replace(/</g, '\\u003c');
}

export function webviewScriptText(source: string): string {
    // Common helpers are serialized with Function#toString. Their compiled imports
    // refer to the host module alias, which does not exist in the webview.
    return source.replace(/\(0,\s*[$A-Z_a-z][\w$]*\.t\)\(/g, 't(')
        .replace(/\bpreview_text_\d+\.t\b/g, 't');
}
