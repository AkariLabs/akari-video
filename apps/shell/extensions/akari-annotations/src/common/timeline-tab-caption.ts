import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';

/** 編集データの所在を、ワークスペース名を含む相対パスで表示する。 */
export function timelineTabCaption(root: URI, editUri: URI | undefined): string {
    if (editUri === undefined) {
        return t('annotationscommon.timelineTabCaption.label.timelineNoEditData');
    }
    const relative = root.relative(editUri);
    const target = relative === undefined
        ? editUri.toString()
        : `${root.path.base}/${relative.toString()}`;
    return t('annotationscommon.timelineTabCaption.label.timeline', { target });
}
