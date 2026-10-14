import { t } from '../common/project-text';
import type { DroppedAsset } from './akari-project-protocol';

export const SUPPORTED_DROP_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|png|jpg|jpeg|gif|webp)$/i;

export type ImportFabItemId = 'device' | 'studio' | 'internet';

export interface ImportFabItem {
    readonly id: ImportFabItemId;
    readonly label: string;
    readonly icon: string;
    readonly soon?: string;
    readonly info?: string;
}

export function importFabItems(vibePreviewEnabled = false): readonly ImportFabItem[] {
    return [
        { id: 'device', label: t('project.materials.importMenu.deviceLabel'), icon: 'codicon-device-desktop' },
        { id: 'studio', label: t('project.materials.importMenu.studioLabel'), icon: 'codicon-record', soon: t('project.library.shelf.comingSoonLabel'),
            info: t('project.materials.importMenu.studioComingSoonRecordAudioCaptureMessage') },
        { id: 'internet', label: t('project.materials.importMenu.internetLabel'), icon: 'codicon-globe',
            ...(vibePreviewEnabled ? {} : { soon: t('project.library.shelf.comingSoonLabel'),
                info: t('project.materials.importMenu.internetComingSoonImportPermittedAssetsMessage') }) }
    ];
}

/** FileDialogService の URI に必要な部分だけを受け取り、選択結果をドロップ経路の入力へ変換する。 */
export interface SelectedFileUri {
    readonly path: { readonly base: string; fsPath(): string };
}

export function classifySelectedFiles(selected: SelectedFileUri | readonly SelectedFileUri[] | undefined):
    { accepted: DroppedAsset[]; rejectedCount: number } {
    const accepted: DroppedAsset[] = [];
    let rejectedCount = 0;
    for (const uri of selected ? (Array.isArray(selected) ? selected : [selected]) : []) {
        if (SUPPORTED_DROP_EXTENSIONS.test(uri.path.base)) {
            accepted.push({ name: uri.path.base, sourcePath: uri.path.fsPath() });
        } else {
            rejectedCount++;
        }
    }
    return { accepted, rejectedCount };
}
