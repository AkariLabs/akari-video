import type { TextstylePreset } from './caption-style-preset';
export type LibraryTextstylePreset = TextstylePreset & {
    origin: 'library';
    sampleText?: string;
    previewPath?: string;
    libraryDir?: string;
};
export declare function registerLibraryTextstylePresets(presets: readonly LibraryTextstylePreset[]): void;
export declare function registeredLibraryTextstylePresets(): LibraryTextstylePreset[];
export declare function resolveTextstyleCatalog({ builtin, library }?: {
    builtin?: Record<string, TextstylePreset>;
    library?: readonly LibraryTextstylePreset[];
}): {
    catalog: Record<string, TextstylePreset>;
    conflicts: string[];
    warnings: string[];
};
