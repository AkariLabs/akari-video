import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { ipcMain, shell } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_REVEAL_IN_FILE_MANAGER, RevealInFileManagerResult } from '../electron-common/electron-api';

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
    }
}
