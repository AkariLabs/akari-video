// task/2026-08-25-shell-binary-open-dialog: パートナー拡張の追従オープンにより、Theia
// FileResource のバイナリ確認ダイアログが生成物ごとに連発する問題をここで抑止する。
// ユーザー起点のメディアオープンは専用 open handler が先に拾うため影響しない。
import URI from '@theia/core/lib/common/uri';
import { FileResourceResolver } from '@theia/filesystem/lib/browser/file-resource';
import { injectable } from '@theia/core/shared/inversify';

const SUPPRESSED_BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.heic', '.heif',
    '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
    '.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg',
    '.glb', '.zip', '.pdf', '.woff', '.woff2', '.ttf', '.otf'
]);

export function isSuppressedBinaryExtension(ext: string): boolean {
    return SUPPRESSED_BINARY_EXTENSIONS.has(ext.toLowerCase());
}

@injectable()
export class AkariFileResourceResolver extends FileResourceResolver {
    protected override shouldOpenAsText(uri: URI, error: string): Promise<boolean> {
        if (isSuppressedBinaryExtension(uri.path.ext)) {
            return Promise.resolve(false);
        }
        return super.shouldOpenAsText(uri, error);
    }
}
