import type { DroppedAsset } from './akari-project-protocol';

export const SUPPORTED_DROP_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|png|jpg|jpeg|gif|webp)$/i;

export type ImportFabItemId = 'device' | 'studio' | 'internet';

export interface ImportFabItem {
    readonly id: ImportFabItemId;
    readonly label: string;
    readonly icon: string;
    readonly soon?: '近日';
    readonly info?: string;
}

export function importFabItems(): readonly ImportFabItem[] {
    return [
        { id: 'device', label: 'デバイスから', icon: 'codicon-device-desktop' },
        { id: 'studio', label: 'スタジオ', icon: 'codicon-record', soon: '近日',
            info: 'スタジオ（近日）: マイクで録音・画面キャプチャ・カメラで撮影を 1 つの画面で。止めると素材に入ります。' },
        { id: 'internet', label: 'インターネットから', icon: 'codicon-globe' }
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
