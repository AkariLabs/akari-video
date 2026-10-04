import type { LibraryTextstylePreset } from './textstyle-catalog-merge';
type LibraryEnv = NodeJS.ProcessEnv;
export declare function resolveTextstyleLibraryRoots(env?: LibraryEnv, { platform }?: {
    platform?: NodeJS.Platform;
}): {
    write: string;
    read: string[];
    source: string;
};
export declare function readLibraryTextstylePresets({ roots }: {
    roots: readonly string[];
}): {
    presets: LibraryTextstylePreset[];
    warnings: string[];
};
export declare function loadTextstyleCatalogSync({ env, roots }?: {
    env?: LibraryEnv;
    roots?: readonly string[];
}): {
    warnings: string[];
    library: LibraryTextstylePreset[];
    catalog: Record<string, import("./caption-style-preset").TextstylePreset>;
    conflicts: string[];
};
export {};
