import { t } from '@akari-video/i18n';
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
    catch { throw new Error(t('annotationscommon.timelineTarget.error.invalidEditDataUri')); }
    const rel = relative(root, target);
    if (!isTimelineEditFileName(basename(target)) || !rel || rel === '..'
        || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(t('annotationscommon.timelineTarget.error.chooseEditJsonEditSlugJsonInside'));
    }
    const realRoot = realpathSync(root);
    const realParent = realpathSync(dirname(target));
    const parentRel = relative(realRoot, realParent);
    if (parentRel === '..' || parentRel.startsWith(`..${sep}`) || isAbsolute(parentRel)
        || existsSync(target) && relative(dirname(realpathSync(target)), realParent) !== '') {
        throw new Error(t('annotationscommon.timelineTarget.error.editDataOutsideProjectCannotBeUsed'));
    }
    return target;
}

export function timelineCaptionsPath(editPath: string): string {
    const name = basename(editPath);
    if (!isTimelineEditFileName(name)) throw new Error(t('annotationscommon.timelineTarget.error.invalidEditDataFilename'));
    return join(dirname(editPath), timelineCaptionsFileName(timelineSlugFromEditFileName(name)));
}

export function timelineEditPathForCaptions(captionsPath: string, projectRoot: string): string {
    const name = basename(captionsPath);
    const editName = name.startsWith('captions') ? `edit${name.slice('captions'.length)}` : '';
    if (!isTimelineEditFileName(editName)) throw new Error(t('annotationscommon.timelineTarget.error.invalidCaptionFilename'));
    const editPath = join(dirname(captionsPath), timelineEditFileName(timelineSlugFromEditFileName(editName)));
    timelineEditPath(projectRoot, pathToFileURL(editPath).toString());
    if (existsSync(captionsPath)
        && relative(dirname(realpathSync(captionsPath)), realpathSync(dirname(captionsPath))) !== '') {
        throw new Error(t('annotationscommon.timelineTarget.error.captionsOutsideProjectCannotBeUsed'));
    }
    return editPath;
}
