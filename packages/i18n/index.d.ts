export type Language = 'ja' | 'en';
export function normalizeLanguage(value: string | undefined): Language;
export function osLanguage(): string;
export function getLanguage(): Language;
export function setLanguage(value: Language | 'auto' | undefined): Language;
export function setChildProcessLanguage(choice: Language | 'auto'): void;
export function childProcessEnv<T extends Record<string, string | null | undefined>>(base: T): T;
export function childProcessEnv(): Record<string, string | undefined>;
export function t(key: string, params?: Record<string, string | number | boolean>, language?: Language): string;
export function formatDate(value: Date | string | number, style?: 'date' | 'time' | (Intl.DateTimeFormatOptions & { kind?: 'time' }) | { options: Intl.DateTimeFormatOptions; kind?: 'time' }): string;
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
export function formatCurrency(amountUsd: number, options?: { yenRate?: number; yenAmount?: number; yenOnly?: boolean; precision?: number }): string;
export function compareText(a: string, b: string, options?: Intl.CollatorOptions): number;

export interface AssetTranslation { title?: string; aliases?: string[]; description?: string; when_to_use?: string; knobs?: Record<string, string>; groups?: Record<string, string> }
export interface LocalizableAsset { id?: string; title?: string; aliases?: string[]; description?: string; when_to_use?: string; i18n?: Record<string, AssetTranslation> }
export function localizedAssetText<F extends 'title' | 'description' | 'when_to_use' | 'aliases'>(meta: LocalizableAsset, field: F, language: string): F extends 'aliases' ? string[] | undefined : string | undefined;
export function localizedKnobLabel(meta: { id?: string; i18n?: Record<string, AssetTranslation> }, knob: { cssVar?: string; param?: string; name?: string; label?: string }, language: string): string | undefined;
export function localizedPresetText(row: { id?: string; i18n?: Record<string, Record<string, string>>; [key: string]: unknown }, field: 'name' | 'category' | 'description' | 'sample_text' | 'when_to_use', language: string): string | undefined;
export function localizedKnobGroup(meta: { i18n?: Record<string, AssetTranslation> }, group: string, language: string): string;
export function translatedKnobLabel(meta: { i18n?: Record<string, AssetTranslation> }, knob: { cssVar?: string; param?: string; name?: string }, language: string): string | undefined;
