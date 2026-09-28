import { existsSync, realpathSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { isTimelineEditFileName, timelineCaptionsFileName, timelineEditFileName, timelineSlugFromEditFileName } from '../common/timeline-files';

/** Accept only a timeline file directly in the selected project directory. */
export function timelineEditPath(projectRoot: string, editUri?: string): string {
    const root = resolve(projectRoot);
    if (!editUri) return join(root, 'edit.json');
    let target: string;
    try { target = resolve(fileURLToPath(editUri)); }
    catch { throw new Error('編集データの URI が不正です。'); }
    const rel = relative(root, target);
    if (!isTimelineEditFileName(basename(target)) || !rel || rel === '..'
        || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error('編集データはプロジェクト内の edit.json または edit.<slug>.json を指定してください。');
    }
    const realRoot = realpathSync(root);
    const realParent = realpathSync(dirname(target));
    const parentRel = relative(realRoot, realParent);
    if (parentRel === '..' || parentRel.startsWith(`..${sep}`) || isAbsolute(parentRel)
        || existsSync(target) && relative(dirname(realpathSync(target)), realParent) !== '') {
        throw new Error('プロジェクト外の編集データは指定できません。');
    }
    return target;
}

export function timelineCaptionsPath(editPath: string): string {
    const name = basename(editPath);
    if (!isTimelineEditFileName(name)) throw new Error('編集データのファイル名が不正です。');
    return join(dirname(editPath), timelineCaptionsFileName(timelineSlugFromEditFileName(name)));
}

export function timelineEditPathForCaptions(captionsPath: string, projectRoot: string): string {
    const name = basename(captionsPath);
    const editName = name.startsWith('captions') ? `edit${name.slice('captions'.length)}` : '';
    if (!isTimelineEditFileName(editName)) throw new Error('字幕ファイル名が不正です。');
    const editPath = join(dirname(captionsPath), timelineEditFileName(timelineSlugFromEditFileName(editName)));
    timelineEditPath(projectRoot, pathToFileURL(editPath).toString());
    if (existsSync(captionsPath)
        && relative(dirname(realpathSync(captionsPath)), realpathSync(dirname(captionsPath))) !== '') {
        throw new Error('プロジェクト外の字幕は指定できません。');
    }
    return editPath;
}
