export type TextstylePreset = {
    id: string;
    name: string;
    category: string;
    style: Record<string, unknown>;
};
export type TextstyleCatalog = ReadonlyMap<string, TextstylePreset> | Record<string, TextstylePreset>;
export declare function mergePresetTextStyle(presetStyle: Record<string, unknown>, recordStyle: unknown): Record<string, unknown>;
export declare function resolveCaptionStylePreset<T extends Record<string, unknown>>(record: T, catalog: TextstyleCatalog): {
    record: T;
    resolved: boolean;
};
export declare function applyCaptionStylePresets<T>(root: T, catalog: TextstyleCatalog): {
    root: T;
    unresolved: string[];
};
