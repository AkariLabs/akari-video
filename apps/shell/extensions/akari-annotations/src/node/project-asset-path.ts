import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';

interface AssetResolverModule {
    resolveProjectAssetPath(project: string, declared: string, env?: NodeJS.ProcessEnv): Promise<string | null>;
}
interface ProjectReferencesModule {
    readProjectReferences(project: string): Promise<Array<{ category: string; id: string }>>;
}
interface LibraryRootsModule {
    resolveAssetLibraryRoots(env?: NodeJS.ProcessEnv): { read: string[] };
}

function inside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function declaredParts(declared: string): string[] {
    if (typeof declared !== 'string' || !declared || isAbsolute(declared) || /^[a-z]:/iu.test(declared)) {
        throw new Error('素材パスがプロジェクトの外を指しています');
    }
    const parts = declared.replace(/\\/gu, '/').split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error('素材パスがプロジェクトの外を指しています');
    }
    return parts;
}

let modules: Promise<{ resolver: AssetResolverModule; references: ProjectReferencesModule; roots: LibraryRootsModule }> | undefined;
function loadModules(): Promise<{ resolver: AssetResolverModule; references: ProjectReferencesModule; roots: LibraryRootsModule }> {
    if (!modules) modules = (async () => {
        const candidates: string[] = [];
        if (typeof process.resourcesPath === 'string') candidates.push(resolve(process.resourcesPath, 'packages'));
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            candidates.push(resolve(ancestor, 'packages'));
            const parent = dirname(ancestor);
            if (parent === ancestor) break;
            ancestor = parent;
        }
        for (const candidate of candidates) {
            const entry = join(candidate, 'asset-resolver', 'src', 'shell-reference.mjs');
            if (!(await fs.stat(entry).then(stat => stat.isFile()).catch(() => false))) continue;
            const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
            const [resolver, references, roots] = await Promise.all([
                importEsm(pathToFileURL(entry).href),
                importEsm(pathToFileURL(join(candidate, 'asset-resolver', 'src', 'project-references.mjs')).href),
                importEsm(pathToFileURL(join(candidate, 'creator-root', 'src', 'index.mjs')).href)
            ]);
            return { resolver, references, roots };
        }
        throw new Error('素材の参照 resolver が見つかりません');
    })();
    return modules;
}

/** Identify an already-resolved library file without widening permission to its siblings. */
export async function referencedLibraryMediaFile(project: string, requestedPath: string,
    env = process.env): Promise<string | null> {
    if (!isAbsolute(requestedPath)) return null;
    const { references, roots } = await loadModules();
    const ledger = await references.readProjectReferences(await fs.realpath(project));
    const requested = resolve(requestedPath);
    for (const library of roots.resolveAssetLibraryRoots(env).read) {
        let libraryRoot: string;
        try { libraryRoot = await fs.realpath(library); } catch { continue; }
        for (const base of [resolve(library), libraryRoot]) {
            if (!inside(base, requested)) continue;
            const parts = relative(base, requested).split(sep);
            if (parts.length < 3 || parts.some(part => !part || part === '.' || part === '..')) continue;
            const [category, id] = parts;
            if (!ledger.some(entry => entry.category === category && entry.id === id)) continue;
            const idDirectory = resolve(libraryRoot, category, id);
            try {
                if (await fs.realpath(idDirectory) !== idDirectory) continue;
                const actual = await fs.realpath(requested);
                if (inside(idDirectory, actual) && (await fs.stat(actual)).isFile()) return actual;
            } catch { /* missing or escaped reference */ }
        }
    }
    return null;
}

/** Resolve one declared project path through the same ledger-backed resolver as preview. */
export async function resolveProjectMediaFile(project: string, declared: string, env = process.env): Promise<string> {
    const parts = declaredParts(declared);
    const root = await fs.realpath(project);
    const { resolver, roots } = await loadModules();
    const actual = await resolver.resolveProjectAssetPath(root, declared, env).catch(error => {
        if (error instanceof Error && error.message.includes('プロジェクトの外')) {
            throw new Error('素材はプロジェクト内で指定してください。');
        }
        throw error;
    });
    if (!actual) throw Object.assign(new Error(`素材が見つかりません: ${declared}`), { code: 'ENOENT' });
    if (inside(root, actual)) return actual;
    if (parts[0] !== 'assets' || parts.length < 4) throw new Error('素材パスがプロジェクトの外を指しています');
    for (const library of roots.resolveAssetLibraryRoots(env).read) {
        try {
            const libraryRoot = await fs.realpath(library);
            const idDirectory = resolve(libraryRoot, parts[1], parts[2]);
            // A symlink replacing the id directory must not widen its boundary.
            if (!inside(libraryRoot, idDirectory) || await fs.realpath(idDirectory) !== idDirectory) continue;
            if (inside(idDirectory, actual)) return actual;
        } catch { /* try the next configured library */ }
    }
    throw new Error('素材パスがプロジェクトの外を指しています');
}

/** Validate a project-local destination, creating only its parent directories. */
export async function projectOutputPath(project: string, declared: string): Promise<string> {
    const parts = declaredParts(declared);
    const root = await fs.realpath(project);
    let directory = root;
    for (const part of parts.slice(0, -1)) {
        directory = join(directory, part);
        try { await fs.mkdir(directory); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        if (!inside(root, await fs.realpath(directory))) throw new Error('保存先はプロジェクト内で指定してください。');
    }
    const target = join(directory, parts[parts.length - 1]);
    try {
        if (!inside(root, await fs.realpath(target))) throw new Error('保存先はプロジェクト内で指定してください。');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
}
