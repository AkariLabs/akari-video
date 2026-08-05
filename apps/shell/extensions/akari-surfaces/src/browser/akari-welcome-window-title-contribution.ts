import { inject, injectable } from '@theia/core/shared/inversify';
import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';

/**
 * F11（task 2026-08-05-welcome-screen）: 「ウィンドウタイトルは未選択時
 * 『AKARI Video』だけになるよう整える（surfaces 内で可能な範囲）」の実装。
 *
 * 実測で判明した前提: Theia 既定の `window.title` テンプレートは macOS では
 * `${activeEditorShort}${separator}${rootName}`（`@theia/core` の
 * `core-preferences.ts` — `${appName}` を含まない。macOS 流儀ではタイトルバーに
 * アプリ名を重ねない）。`rootName` はワークスペース無しでは空になり、
 * `activeEditorShort` はメインエリアの現在ウィジェット（ウェルカム面では
 * `AkariHomeWidget` のタブラベル「ホーム」）で埋まる。結果、素の Theia 挙動では
 * ウェルカム時のタイトルが「ホーム」になってしまう（task.md の想定外）。
 *
 * `WindowTitleContribution.enhanceTitle` は `WindowTitleService` が組み立てた
 * 最終文字列を上書きできる公式の拡張点（`@theia/core` 側の実装は変更しない）。
 * ワークスペース未選択（`workspaceService.opened === false`）のときだけ
 * アプリ名（`FrontendApplicationConfigProvider` の `applicationName` =
 * "AKARI Video"）で丸ごと差し替える。選択後は Theia 既定の組み立てのまま
 * （通常ホームのタイトル整形は本タスクのスコープ外）。
 */
@injectable()
export class AkariWelcomeWindowTitleContribution implements WindowTitleContribution {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    enhanceTitle(title: string): string {
        if (this.workspaceService.opened) {
            return title;
        }
        return FrontendApplicationConfigProvider.get().applicationName;
    }
}
