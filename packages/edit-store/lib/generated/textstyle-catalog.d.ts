import type { TextstylePreset } from '../caption-style-preset';
export type LocalizedTextstylePreset = TextstylePreset & {
    i18n?: Record<string, {
        name?: string;
        category?: string;
        sample_text?: string;
    }>;
};
export declare const TEXTSTYLE_CATALOG: Record<string, LocalizedTextstylePreset>;
