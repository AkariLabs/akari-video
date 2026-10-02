"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTextstyleLibraryRoots = resolveTextstyleLibraryRoots;
exports.readLibraryTextstylePresets = readLibraryTextstylePresets;
exports.loadTextstyleCatalogSync = loadTextstyleCatalogSync;
/** Node-only loader. Mirrored from creator-root resolveAssetLibraryRoots; keep the case table in sync. */
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const textstyle_catalog_merge_1 = require("./textstyle-catalog-merge");
const LIBRARY_LOCATION_VERSION = 0;
const ID = /^[a-z0-9][a-z0-9-]*$/;
function resolveTextstyleLibraryRoots(env = process.env, { platform = process.platform } = {}) {
    const homeDir = platform === 'win32'
        ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : (0, node_os_1.homedir)())
        : env.HOME || (0, node_os_1.homedir)();
    const home = env.AKARI_HOME || (0, node_path_1.join)(homeDir, '.akari');
    const legacy = (0, node_path_1.resolve)(home, 'assets');
    let location;
    try {
        const parsed = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(home, 'library-location.json'), 'utf8'));
        if (parsed?.version === LIBRARY_LOCATION_VERSION && typeof parsed.root === 'string' && (0, node_path_1.isAbsolute)(parsed.root)
            && ['pending', 'migrating', 'done', 'declined'].includes(parsed.state)
            && (parsed.previousRoot === undefined || typeof parsed.previousRoot === 'string' && (0, node_path_1.isAbsolute)(parsed.previousRoot))) {
            location = parsed;
        }
    }
    catch { /* no location file */ }
    const write = env.AKARI_LIBRARY_ROOT ? (0, node_path_1.resolve)(env.AKARI_LIBRARY_ROOT)
        : location && ['migrating', 'done'].includes(location.state) ? (0, node_path_1.resolve)(location.root)
            : location?.previousRoot ? (0, node_path_1.resolve)(location.previousRoot) : legacy;
    const seen = new Set();
    const read = [write, location?.previousRoot, legacy].filter((root) => {
        if (!root)
            return false;
        let actual;
        try {
            actual = (0, node_fs_1.realpathSync)(root);
        }
        catch {
            actual = root;
        }
        if (seen.has(actual))
            return false;
        seen.add(actual);
        return true;
    });
    return { write, read, source: env.AKARI_LIBRARY_ROOT ? 'env'
            : location && (['migrating', 'done'].includes(location.state) || location.previousRoot) ? 'location' : 'legacy' };
}
function readLibraryTextstylePresets({ roots }) {
    const presets = [];
    const warnings = [];
    const seen = new Set();
    for (const root of roots) {
        const categoryDir = (0, node_path_1.join)(root, 'textstyle');
        let entries;
        try {
            entries = (0, node_fs_1.readdirSync)(categoryDir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const libraryDir = (0, node_path_1.join)(categoryDir, entry.name);
            try {
                const raw = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(libraryDir, 'preset.json'), 'utf8'));
                if (raw?.format !== 'akari-textstyle' || typeof raw.id !== 'string'
                    || !ID.test(raw.id) || raw.id !== entry.name
                    || !raw.style || typeof raw.style !== 'object' || Array.isArray(raw.style)) {
                    throw new Error('format / id / style が不正です');
                }
                if (seen.has(raw.id))
                    continue;
                seen.add(raw.id);
                let title;
                try {
                    title = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(libraryDir, 'meta.json'), 'utf8')).title;
                }
                catch { /* optional name fallback */ }
                presets.push({ id: raw.id,
                    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name
                        : typeof title === 'string' && title.trim() ? title : raw.id,
                    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category : 'library',
                    style: raw.style, origin: 'library',
                    sampleText: typeof raw.sample_text === 'string' ? raw.sample_text : undefined,
                    previewPath: (0, node_path_1.join)(libraryDir, 'preview.png'), libraryDir });
            }
            catch (error) {
                warnings.push(`captions.style-preset-library-invalid: ${libraryDir}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return { presets, warnings };
}
function loadTextstyleCatalogSync({ env = process.env, roots } = {}) {
    const library = readLibraryTextstylePresets({ roots: roots ?? resolveTextstyleLibraryRoots(env).read });
    const merged = (0, textstyle_catalog_merge_1.resolveTextstyleCatalog)({ library: library.presets });
    return { ...merged, warnings: [...library.warnings, ...merged.warnings], library: library.presets };
}
