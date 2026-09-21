import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryFromCatalog } from './library-catalog.mjs';

import { resourcePath } from '../resources-root.mjs';
const roots = [...new Set([
    resourcePath('assets'),
    fileURLToPath(new URL('../../../../assets/', import.meta.url)),
].filter(Boolean).map(root => path.resolve(root)))];

export function selectLibrarySource({ env = {}, homeDirectory = env.HOME ?? env.USERPROFILE, exists = () => false } = {}) {
    const override = env.AKARI_LIBRARY_SOURCE;
    if (override != null && override !== '' && override !== 'walk' && override !== 'catalog') {
        throw new Error(`Invalid AKARI_LIBRARY_SOURCE: ${override}`);
    }
    if (override === 'walk') return { kind:'walk', label:'walk (AKARI_LIBRARY_SOURCE)' };

    const configured = typeof env.AKARI_CATALOG_JSON === 'string' && env.AKARI_CATALOG_JSON.length
        ? env.AKARI_CATALOG_JSON : null;
    const cached = typeof homeDirectory === 'string' && homeDirectory.length
        ? path.join(homeDirectory, '.akari', 'catalog-cache.json') : null;
    if (configured && exists(configured)) return { kind:'catalog', path:configured, label:'catalog (AKARI_CATALOG_JSON)' };
    if (cached && exists(cached)) return { kind:'catalog', path:cached, label:'catalog (~/.akari/catalog-cache.json)' };
    if (override === 'catalog') throw new Error('AKARI_LIBRARY_SOURCE=catalog but no catalog JSON was found');
    return { kind:'walk', label:'walk (catalog unavailable)' };
}

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))
        .flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : e.name === 'meta.json' ? [path.join(dir,e.name)] : []);
}

function libraryFromWalk() {
    const found = new Map();
    for (const root of roots) for (const file of walk(root)) {
        const meta = JSON.parse(fs.readFileSync(file,'utf8'));
        if (!meta.id || !['overlay','still','scene3d'].includes(meta.category)) continue;
        if (found.has(meta.id)) throw new Error(`W11 ambiguous asset id: ${meta.id}`);
        found.set(meta.id, { ...meta, directory:path.dirname(file) });
    }
    return [...found.values()].sort((a,b) => a.id.localeCompare(b.id,'en'));
}

// The catalog owns membership and metadata. A matching local directory is only
// attached so the existing Node executor can still resolve fragment.html.
function attachLocalDirectories(rows) {
    return rows.map(asset => {
        const directory = roots.map(root => path.join(root, asset.category, asset.id)).find(candidate => fs.existsSync(candidate));
        return directory ? { ...asset, directory } : asset;
    });
}

let initialized = false;
const rowsById = new Map();
export const byId = new Proxy(rowsById, { get(target, key) {
    ensureLibrary();
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
} });
export let library = new Proxy([], { get(_target, key) {
    ensureLibrary();
    const value = Reflect.get(library, key);
    return typeof value === 'function' ? value.bind(library) : value;
} });

function installLibrary(rows) {
    const next = [...rows].sort((a,b) => a.id.localeCompare(b.id,'en'));
    const ids = new Set();
    for (const asset of next) {
        if (!asset?.id || ids.has(asset.id)) throw new Error(`W11 ambiguous asset id: ${asset?.id}`);
        ids.add(asset.id);
    }
    rowsById.clear();
    for (const asset of next) rowsById.set(asset.id, asset);
    library = next;
    initialized = true;
    return library;
}

export function setLibraryCatalog(catalogJson) {
    return installLibrary(libraryFromCatalog(catalogJson));
}

function ensureLibrary() {
    if (initialized) return;
    const environment = typeof process === 'object' && process?.env ? process.env : {};
    const selected = selectLibrarySource({ env:environment, exists:fs.existsSync });
    if (selected.kind === 'catalog') {
        installLibrary(attachLocalDirectories(libraryFromCatalog(fs.readFileSync(selected.path, 'utf8'))));
    } else {
        installLibrary(libraryFromWalk());
    }
    console.error(`[library] source=${selected.label}`);
}
