import { TEXTSTYLE_CATALOG } from './generated/textstyle-catalog';
import type { TextstylePreset } from './caption-style-preset';

export type LibraryTextstylePreset = TextstylePreset & {
    origin: 'library';
    sampleText?: string;
    previewPath?: string;
    libraryDir?: string;
};

let registered: LibraryTextstylePreset[] = [];

export function registerLibraryTextstylePresets(presets: readonly LibraryTextstylePreset[]): void {
    registered = [...presets];
}

export function registeredLibraryTextstylePresets(): LibraryTextstylePreset[] {
    return [...registered];
}

export function resolveTextstyleCatalog({ builtin = TEXTSTYLE_CATALOG, library = registered }:
    { builtin?: Record<string, TextstylePreset>; library?: readonly LibraryTextstylePreset[] } = {}):
    { catalog: Record<string, TextstylePreset>; conflicts: string[]; warnings: string[] } {
    const catalog: Record<string, TextstylePreset> = { ...builtin };
    const conflicts: string[] = [];
    const warnings: string[] = [];
    for (const preset of library) {
        if (Object.prototype.hasOwnProperty.call(builtin, preset.id)) {
            conflicts.push(preset.id);
            warnings.push(`captions.style-preset-library-shadowed: ${preset.id} はライブラリ由来ですが組み込みプリセットと同じ id のため組み込みを使います`);
        } else if (!Object.prototype.hasOwnProperty.call(catalog, preset.id)) {
            catalog[preset.id] = preset;
        }
    }
    return { catalog, conflicts, warnings };
}
