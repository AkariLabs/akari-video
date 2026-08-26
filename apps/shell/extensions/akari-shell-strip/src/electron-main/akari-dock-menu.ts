import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { Menu, app } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';

/**
 * macOS の Dock アイコン右クリックメニュー（task 2026-08-25-shell-window-and-notify ②）。
 *
 * 「新しいウィンドウ」はワークスペース未指定の既定ウィンドウを開く
 * （openDefaultWindow — フロントはホーム + プロジェクト・ランチャーで起動するので、
 * そこから新規作成・既存プロジェクトを開くの両方に進める）。プロジェクト作成や
 * フォルダ選択そのものはフロント側のフロー（AkariHomeWidget#startNewProject 等）が
 * 正本なので、main プロセスには複製しない。
 */
@injectable()
export class AkariDockMenu implements ElectronMainApplicationContribution {

    onStart(application: ElectronMainApplication): void {
        if (process.platform !== 'darwin' || !app.dock) {
            return;
        }
        app.dock.setMenu(Menu.buildFromTemplate([
            {
                label: '新しいウィンドウ',
                click: () => {
                    application.openDefaultWindow().catch(error =>
                        console.error('[akari-shell-strip] dock「新しいウィンドウ」でウィンドウを開けませんでした:', error)
                    );
                }
            }
        ]));
    }
}
