import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { clipboard, ipcMain, shell } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { isOSX } from '@theia/core/lib/common/os';
import {
    CHANNEL_COPY_FILE_TO_CLIPBOARD,
    CHANNEL_REVEAL_IN_FILE_MANAGER,
    CopyFileToClipboardResult,
    RevealInFileManagerResult
} from '../electron-common/electron-api';
import { toFileUrl } from '../common/file-url';

/**
 * `shell.showItemInFolder` は macOS（Finder /select）・Windows（`explorer /select,`）・
 * Linux（freedesktop 系ファイルマネージャ）のいずれも Electron 側が吸収するため、
 * ここでの OS 分岐は不要（存在確認はフロントエンド側で FileService を使って先に行う —
 * `akari-project-contribution.ts#revealInFileManager`）。
 */
@injectable()
export class AkariProjectElectronApi implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        ipcMain.handle(CHANNEL_REVEAL_IN_FILE_MANAGER, async (_event, fsPath: unknown): Promise<RevealInFileManagerResult> => {
            if (typeof fsPath !== 'string' || !fsPath) {
                return { ok: false, message: '対象のパスが指定されていません。' };
            }
            shell.showItemInFolder(fsPath);
            return { ok: true };
        });
        // 「ファイルをコピー」は v0 = macOS のみ（司令塔裁定2）。非 macOS は呼ばれない想定だが
        // fail-safe で { ok: false } を返す。macOS 版は Finder が理解する UTI
        // `public.file-url` へ file URL を書き込む（⌘V での貼り付けに必要な形式）。
        ipcMain.handle(CHANNEL_COPY_FILE_TO_CLIPBOARD, async (_event, fsPath: unknown): Promise<CopyFileToClipboardResult> => {
            if (typeof fsPath !== 'string' || !fsPath) {
                return { ok: false, message: '対象のパスが指定されていません。' };
            }
            if (!isOSX) {
                return { ok: false, message: 'この機能は現在 macOS のみ対応しています。' };
            }
            clipboard.writeBuffer('public.file-url', Buffer.from(toFileUrl(fsPath)));
            return { ok: true };
        });
    }
}
