/** Node-only loader. Mirrored from creator-root resolveAssetLibraryRoots; keep the case table in sync. */
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { LibraryTextstylePreset } from './textstyle-catalog-merge';
import { resolveTextstyleCatalog } from './textstyle-catalog-merge';

type LibraryEnv = NodeJS.ProcessEnv;
const LIBRARY_LOCATION_VERSION = 0;
const ID = /^[a-z0-9][a-z0-9-]*$/;

export function resolveTextstyleLibraryRoots(env: LibraryEnv = process.env,
    { platform = process.platform }: { platform?: NodeJS.Platform } = {}): { write: string; read: string[]; source: string } {
    const homeDir = platform === 'win32'
        ? env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : homedir())
        : env.HOME || homedir();
    const home = env.AKARI_HOME || join(homeDir, '.akari');
    const legacy = resolve(home, 'assets');
    let location: { root: string; state: string; previousRoot?: string } | undefined;
    try {
        const parsed = JSON.parse(readFileSync(join(home, 'library-location.json'), 'utf8'));
        if (parsed?.version === LIBRARY_LOCATION_VERSION && typeof parsed.root === 'string' && isAbsolute(parsed.root)
            && ['pending', 'migrating', 'done', 'declined'].includes(parsed.state)
            && (parsed.previousRoot === undefined || typeof parsed.previousRoot === 'string' && isAbsolute(parsed.previousRoot))) {
            location = parsed;
        }
    } catch { /* no location file */ }
    const write = env.AKARI_LIBRARY_ROOT ? resolve(env.AKARI_LIBRARY_ROOT)
        : location && ['migrating', 'done'].includes(location.state) ? resolve(location.root)
            : location?.previousRoot ? resolve(location.previousRoot) : legacy;
    const seen = new Set<string>();
    const read = [write, location?.previousRoot, legacy].filter((root): root is string => {
        if (!root) return false;
        let actual: string;
        try { actual = realpathSync(root); } catch { actual = root; }
        if (seen.has(actual)) return false;
        seen.add(actual);
        return true;
    });
    return { write, read, source: env.AKARI_LIBRARY_ROOT ? 'env'
        : location && (['migrating', 'done'].includes(location.state) || location.previousRoot) ? 'location' : 'legacy' };
}

export function readLibraryTextstylePresets({ roots }: { roots: readonly string[] }):
    { presets: LibraryTextstylePreset[]; warnings: string[] } {
    const presets: LibraryTextstylePreset[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
        const categoryDir = join(root, 'textstyle');
        let entries;
        try { entries = readdirSync(categoryDir, { withFileTypes: true }); }
        catch { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const libraryDir = join(categoryDir, entry.name);
            try {
                const raw = JSON.parse(readFileSync(join(libraryDir, 'preset.json'), 'utf8'));
                if (raw?.format !== 'akari-textstyle' || typeof raw.id !== 'string'
                    || !ID.test(raw.id) || raw.id !== entry.name
                    || !raw.style || typeof raw.style !== 'object' || Array.isArray(raw.style)) {
                    throw new Error('format / id / style が不正です');
                }
                if (seen.has(raw.id)) continue;
                seen.add(raw.id);
                let title: string | undefined;
                try { title = JSON.parse(readFileSync(join(libraryDir, 'meta.json'), 'utf8')).title; }
                catch { /* optional name fallback */ }
                presets.push({ id: raw.id,
                    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name
                        : typeof title === 'string' && title.trim() ? title : raw.id,
                    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category : 'library',
                    style: raw.style, origin: 'library',
                    sampleText: typeof raw.sample_text === 'string' ? raw.sample_text : undefined,
                    previewPath: join(libraryDir, 'preview.png'), libraryDir });
            } catch (error) {
                warnings.push(`captions.style-preset-library-invalid: ${libraryDir}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return { presets, warnings };
}

export function loadTextstyleCatalogSync({ env = process.env, roots }: { env?: LibraryEnv; roots?: readonly string[] } = {}) {
    const library = readLibraryTextstylePresets({ roots: roots ?? resolveTextstyleLibraryRoots(env).read });
    const merged = resolveTextstyleCatalog({ library: library.presets });
    return { ...merged, warnings: [...library.warnings, ...merged.warnings], library: library.presets };
}
