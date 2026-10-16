import { constants, existsSync, promises as fs } from 'fs';
import type { Stats } from 'fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'path';
import { execFile } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { promisify } from 'util';
import { childProcessEnv } from '@akari-video/i18n';

export interface SceneAssetDependencies { link: typeof fs.link; copyFile: typeof fs.copyFile }

async function sameExisting(source: string, target: string, sourceStat: Stats): Promise<boolean> {
    let existing;
    try { existing = await fs.lstat(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
    if (!existing.isFile() || existing.size !== sourceStat.size) return false;
    if (existing.dev === sourceStat.dev && existing.ino === sourceStat.ino) return true;
    const [left, right] = await Promise.all([fs.open(source, 'r'), fs.open(target, 'r')]);
    try {
        const leftBuffer = Buffer.allocUnsafe(64 * 1024);
        const rightBuffer = Buffer.allocUnsafe(64 * 1024);
        for (let offset = 0; offset < sourceStat.size; offset += leftBuffer.length) {
            const length = Math.min(leftBuffer.length, sourceStat.size - offset);
            const [a, b] = await Promise.all([
                left.read(leftBuffer, 0, length, offset), right.read(rightBuffer, 0, length, offset)
            ]);
            if (a.bytesRead !== length || b.bytesRead !== length
                || !leftBuffer.subarray(0, length).equals(rightBuffer.subarray(0, length))) return false;
        }
        return true;
    } finally { await Promise.all([left.close(), right.close()]); }
}

/** Make a scene-local path before passing the material to the existing timeline path. */
export async function importCommonAsset(sceneRoot: string, source: string,
    dependencies: SceneAssetDependencies = { link: fs.link, copyFile: fs.copyFile }): Promise<string> {
    const scene = await fs.realpath(sceneRoot);
    if (basename(dirname(scene)) !== 'scenes') throw new Error('Not a scene folder');
    const project = dirname(dirname(scene));
    await fs.stat(join(project, '.akari'));
    const assets = await fs.realpath(join(project, 'assets'));
    const sourceReal = await fs.realpath(source);
    const sourceStat = await fs.stat(sourceReal);
    if (!sourceReal.startsWith(`${assets}${sep}`) || !sourceStat.isFile()) throw new Error('Not a common asset');
    const subpath = relative(assets, sourceReal);
    if (!subpath || subpath.startsWith('..')) throw new Error('Not a common asset');
    const targetDirectory = join(scene, 'assets', dirname(subpath));
    await fs.mkdir(targetDirectory, { recursive: true });
    const targetDirectoryReal = await fs.realpath(targetDirectory);
    if (!targetDirectoryReal.startsWith(`${scene}${sep}`)) throw new Error('Asset directory escapes the scene');
    const extension = extname(subpath);
    const stem = basename(subpath, extension);
    for (let index = 1; ; index++) {
        const name = index === 1 ? basename(subpath) : `${stem}-${index}${extension}`;
        const target = join(targetDirectoryReal, name);
        try {
            await dependencies.link(sourceReal, target);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                if (await sameExisting(sourceReal, target, sourceStat)) return relative(scene, target).split(sep).join('/');
                continue;
            }
            if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
            try { await dependencies.copyFile(sourceReal, target, constants.COPYFILE_EXCL); }
            catch (copyError) {
                if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
                    if (await sameExisting(sourceReal, target, sourceStat)) return relative(scene, target).split(sep).join('/');
                    continue;
                }
                throw copyError;
            }
        }
        return relative(scene, target).split(sep).join('/');
    }
}

/** Source URIs already represented by a scene-local hard link are omitted from the shared row. */
export async function unlinkedCommonAssetUris(sceneUri: string, sourceUris: string[]): Promise<string[]> {
    const scene = await fs.realpath(fileURLToPath(sceneUri));
    if (basename(dirname(scene)) !== 'scenes') return sourceUris;
    const inodes = new Set<string>();
    const walk = async (directory: string): Promise<void> => {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries) {
            const file = join(directory, entry.name);
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile()) { const stat = await fs.stat(file); inodes.add(`${stat.dev}:${stat.ino}`); }
        }
    };
    await walk(join(scene, 'assets'));
    const remaining: string[] = [];
    for (const uri of sourceUris) {
        try { const stat = await fs.stat(fileURLToPath(uri)); if (!inodes.has(`${stat.dev}:${stat.ino}`)) remaining.push(uri); }
        catch { remaining.push(uri); }
    }
    return remaining;
}

const launcherModule = (name: string): string => join(dirname(require.resolve('akari-video/package.json')), 'src', name);

const SCAFFOLD_MODULES = ['packages/project-scaffold/src/index.mjs', 'lib/packages/project-scaffold/src/index.mjs'];
const PROJECT_TEMPLATES = ['templates/project-default', 'lib/templates/project-default'];
const UPWARD_SEARCH_MAX_DEPTH = 12;

/** Match the new-project popup's upward search, including the paths copied into app.asar/lib. */
export function sceneLauncherAssetCandidates(startDirs: readonly string[]): { scaffoldModules: string[]; templateDirs: string[] } {
    const candidates = (targets: readonly string[]): string[] => {
        const paths: string[] = [];
        for (const start of startDirs) {
            let dir = resolve(start);
            for (let depth = 0; depth < UPWARD_SEARCH_MAX_DEPTH; depth++) {
                for (const target of targets) paths.push(resolve(dir, target));
                const parent = dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
        }
        return paths;
    };
    return { scaffoldModules: candidates(SCAFFOLD_MODULES), templateDirs: candidates(PROJECT_TEMPLATES) };
}

export function selectSceneLauncherAssets(
    candidates: ReturnType<typeof sceneLauncherAssetCandidates>, files: ReadonlySet<string>, directories: ReadonlySet<string>
): { scaffoldModulePath: string; templateDir: string } {
    const scaffoldModulePath = candidates.scaffoldModules.find(path => files.has(path));
    const templateDir = candidates.templateDirs.find(path => directories.has(path));
    if (!scaffoldModulePath || !templateDir) throw new Error('Project scaffold or template not found');
    return { scaffoldModulePath, templateDir };
}

async function launcherSceneAssets(): Promise<{ scaffoldModulePath: string; templateDir: string }> {
    const candidates = sceneLauncherAssetCandidates([__dirname, process.cwd()]);
    const files = new Set<string>();
    const directories = new Set<string>();
    await Promise.all([
        ...candidates.scaffoldModules.map(async path => { if ((await fs.stat(path).catch(() => undefined))?.isFile()) files.add(path); }),
        ...candidates.templateDirs.map(async path => { if ((await fs.stat(path).catch(() => undefined))?.isDirectory()) directories.add(path); })
    ]);
    return selectSceneLauncherAssets(candidates, files, directories);
}

const runLauncher = async (name: string, imports: string, body: string, args: string[]): Promise<void> => {
    const script = `import ${imports} from ${JSON.stringify(pathToFileURL(launcherModule(name)).href)};\n${body}`;
    try {
        await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, ...args], {
            env: childProcessEnv({ ...process.env, ELECTRON_RUN_AS_NODE: '1' })
        });
    } catch (error) {
        const stderr = (error as Error & { stderr?: string }).stderr?.trim();
        throw new Error(stderr || (error as Error).message);
    }
};

export async function addSceneFromLauncher(rootUri: string, id: string): Promise<string> {
    const root = fileURLToPath(rootUri);
    const assets = await launcherSceneAssets();
    await runLauncher('project-command.mjs', '{ addScene }',
        'await addScene(process.argv[1], process.argv[2], JSON.parse(process.argv[3]));', [root, id, JSON.stringify(assets)]);
    return pathToFileURL(join(root, 'scenes', id)).href;
}

export async function importCommonSceneAsset(sceneUri: string, sourceUri: string): Promise<string> {
    const scene = fileURLToPath(sceneUri);
    const source = fileURLToPath(sourceUri);
    const relativePath = await importCommonAsset(scene, source);
    const project = dirname(dirname(scene));
    if (existsSync(join(project, '.akari', 'manifest.json'))) {
        const sourceRelative = relative(join(project, 'assets'), source).split(sep);
        const extension = extname(source).toLowerCase();
        const category = sourceRelative.length > 1 ? sourceRelative[0]
            : /\.(mp4|mov|m4v|webm|mkv|avi)$/.test(extension) ? 'video'
                : /\.(mp3|wav|m4a|aac|flac|ogg)$/.test(extension) ? 'audio' : 'still';
        const id = sourceRelative.length > 1 ? sourceRelative[1] : basename(source, extension);
        const assetId = `asset:${category}/${id}`;
        const sourceWhere = relative(project, source).split(sep).join('/');
        await runLauncher('project-manifest.mjs', '{ readManifest, writeManifest }', `
const [root, sceneId, derivedId, category, sourceWhere] = process.argv.slice(1);
const manifest = await readManifest(root);
const matchesWhere = node => node.kind === 'asset' && typeof node.where === 'string'
  && (node.where === sourceWhere || (node.where.split('/').length >= 3 && sourceWhere.startsWith(node.where + '/')));
const known = manifest.nodes.find(matchesWhere) || manifest.nodes.find(node => node.kind === 'asset' && node.id === derivedId);
const assetId = known?.id || derivedId;
if (!manifest.nodes.some(node => node.id === assetId)) manifest.nodes.push({ id: assetId, kind: 'asset', rev: 0, category });
if (!manifest.nodes.some(node => node.id === 'scene:' + sceneId)) manifest.nodes.push({ id: 'scene:' + sceneId, kind: 'scene', rev: 0, where: 'scenes/' + sceneId });
if (!manifest.edges.some(edge => edge.from === 'scene:' + sceneId && edge.uses === assetId)) manifest.edges.push({ from: 'scene:' + sceneId, uses: assetId });
await writeManifest(root, manifest);`, [project, basename(scene), assetId, category, sourceWhere]);
    }
    return relativePath;
}
