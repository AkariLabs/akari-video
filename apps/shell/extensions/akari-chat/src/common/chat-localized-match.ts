import { t } from '@akari-video/i18n';

const variants = (key: string): string[] => [t(key, {}, 'ja'), t(key, {}, 'en')];

export function matchesLocalizedValue(value: string, key: string): boolean {
    return variants(key).includes(value);
}

export function includesLocalizedValue(value: string, key: string): boolean {
    return variants(key).some(label => value.includes(label));
}

export function localizedPattern(keys: readonly string[], english: readonly string[] = []): RegExp {
    const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp([...new Set([...english, ...keys.flatMap(variants)])].map(escape).join('|'), 'iu');
}
