import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { buildHomeStats } from './home-model';
import { parseIntakeTitle } from '../../common/project-display-name';

export interface SceneRow { id: string; uri: URI; title: string; duration?: string; assets: number; updatedAt?: number }

/** Malformed intake is optional metadata; a valid scene still appears by its folder name. */
export async function readSceneList(files: Pick<FileService, 'resolve' | 'readFile'>, root: URI): Promise<SceneRow[]> {
    let children;
    try { children = (await files.resolve(root.resolve('scenes'))).children ?? []; } catch { return []; }
    const rows = await Promise.all(children.filter(child => child.isDirectory && !child.name.startsWith('.')).map(async child => {
        const uri = child.resource;
        let edit;
        try { edit = await files.resolve(uri.resolve('edit.json'), { resolveMetadata: true }); if (!edit.isFile) return undefined; }
        catch { return undefined; }
        let title = child.name;
        try { title = parseIntakeTitle(JSON.parse((await files.readFile(uri.resolve('.akari/intake.json'))).value.toString())) || title; }
        catch { /* Invalid intake must not hide the scene. */ }
        let duration: string | undefined;
        try { duration = buildHomeStats(JSON.parse((await files.readFile(uri.resolve('edit.json'))).value.toString())).duration; }
        catch { /* Invalid edit metadata still leaves a navigable scene. */ }
        let assets = 0;
        try { assets = (await files.resolve(uri.resolve('assets'))).children?.filter(file => file.isFile && !file.name.startsWith('.')).length ?? 0; }
        catch { /* Empty assets. */ }
        return { id: child.name, uri, title, duration, assets, updatedAt: edit.mtime } as SceneRow;
    }));
    return rows.filter((row): row is SceneRow => !!row).sort((a, b) => a.id.localeCompare(b.id));
}
