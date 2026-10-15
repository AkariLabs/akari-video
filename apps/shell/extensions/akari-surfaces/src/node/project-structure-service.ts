import { injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { promises as fs } from 'fs';
import { join, relative, isAbsolute, dirname, basename, sep } from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { childProcessEnv } from '@akari-video/i18n';
import { AkariProjectStructureService } from '../common/project-structure-protocol';
import { ManifestCheck, ProjectManifest, SceneEditInput } from '../common/project-structure-model';

const launcherModule = (): string => join(dirname(require.resolve('akari-video/package.json')), 'src', 'project-command.mjs');
async function runProjectCommand(name: 'syncProject' | 'checkProject', root: string): Promise<void> {
    const script = `import { ${name} } from ${JSON.stringify(pathToFileURL(launcherModule()).href)};\nawait ${name}(process.argv[1]);`;
    try {
        await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root], {
            env: childProcessEnv({ ...process.env, ELECTRON_RUN_AS_NODE: '1' })
        });
    } catch (error) {
        const stderr = (error as Error & { stderr?: string }).stderr?.trim();
        throw new Error(stderr || (error as Error).message);
    }
}
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
async function readJson(file: string): Promise<any | undefined> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (missing(error)) return undefined; throw error; }
}
async function projectRoot(uri: string): Promise<string> {
    const parsed = new URI(uri);
    if (parsed.scheme !== 'file') throw new Error('Local project required');
    const folder = await fs.realpath(parsed.path.fsPath());
    const root = basename(dirname(folder)) === 'scenes' && await fs.stat(join(dirname(dirname(folder)), '.akari')).then(s => s.isDirectory(), () => false)
        ? dirname(dirname(folder)) : folder;
    if (!await fs.stat(join(root, '.akari')).then(s => s.isDirectory(), () => false)) throw new Error('Project metadata missing');
    return root;
}
function inside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function hasCaptions(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (!value || typeof value !== 'object') return false;
    const object = value as Record<string, unknown>;
    return ['captions', 'cues', 'items'].some(key => {
        const items = object[key];
        return Array.isArray(items) && items.length > 0;
    });
}

@injectable()
export class AkariProjectStructureServiceImpl implements AkariProjectStructureService {
    async readScenes(projectUri: string): Promise<SceneEditInput[]> {
        const root = await projectRoot(projectUri);
        const folder = join(root, 'scenes');
        const entries = await fs.readdir(folder, { withFileTypes: true }).catch(error => { if (missing(error)) return []; throw error; });
        const scenes: SceneEditInput[] = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const scene = await fs.realpath(join(folder, entry.name));
            if (!inside(folder, scene)) continue;
            const editPath = join(scene, 'edit.json');
            let edit: unknown;
            let editMtime: number | undefined;
            try { edit = await readJson(editPath); editMtime = (await fs.stat(editPath)).mtimeMs; }
            catch { /* Broken edit remains visible as an unreadable row. */ }
            const intake = await readJson(join(scene, '.akari', 'intake.json')).catch(() => undefined);
            const title = typeof intake?.title === 'string' && intake.title.trim() ? intake.title.trim() : entry.name;
            const exports = await fs.readdir(join(scene, 'exports'), { withFileTypes: true }).catch(error => { if (missing(error)) return []; throw error; });
            const exportMtimes = await Promise.all(exports.filter(file => file.isFile()).map(file => fs.stat(join(scene, 'exports', file.name)).then(stat => stat.mtimeMs)));
            const captions = await readJson(join(scene, 'captions.json')).then(hasCaptions, () => false);
            scenes.push({ id: entry.name, title, edit, editMtime, exportMtimes,
                captions });
        }
        return scenes;
    }
    async readManifest(projectUri: string): Promise<ProjectManifest | undefined> {
        return readJson(join(await projectRoot(projectUri), '.akari', 'manifest.json'));
    }
    async readCheck(projectUri: string): Promise<ManifestCheck | undefined> {
        const root = await projectRoot(projectUri);
        const file = join(root, '.akari', 'reports', 'manifest-check.json');
        let check = await readJson(file);
        if (!check && await readJson(join(root, '.akari', 'manifest.json'))) {
            await runProjectCommand('checkProject', root);
            check = await readJson(file);
        }
        return check;
    }
    async sync(projectUri: string): Promise<ProjectManifest | undefined> {
        const root = await projectRoot(projectUri);
        await runProjectCommand('syncProject', root);
        await runProjectCommand('checkProject', root);
        return this.readManifest(projectUri);
    }
}
