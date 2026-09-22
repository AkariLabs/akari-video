import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { WindowTitleContribution, WindowTitleService } from '@theia/core/lib/browser/window/window-title-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { homeWindowTitle } from './home/home-model';
import { parseIntakeTitle } from '../common/project-display-name';

const INTAKE_RELATIVE_PATH = '.akari/intake.json';

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
 * "AKARI Video"）で丸ごと差し替える。
 *
 * task 2026-08-09-project-display-title: ワークスペース選択後は Theia 既定の
 * `rootName`（= ワークスペースルートのフォルダ名）がそのままタイトル/ブラウザタブに
 * 出る。`.akari/intake.json` の `title` が設定されていれば、`enhanceTitle` の第 2
 * 引数で渡ってくる組み立て済み `rootName` パーツをそれに差し替える
 * （`WindowTitleService` はコアの実装なので、文字列置換以外の上書き手段が無い —
 * `enhanceTitle(title, parts)` の `parts.get('rootName')` が実際に使われた生の
 * rootName と一致する前提で、そのまま出現箇所だけを置換する）。
 *
 * task 2026-09-08: WorkspaceService 自身が WindowTitleService を注入するため、
 * WindowTitleService.init() から構築されるこの contribution は依存注入をゼロに保つ。
 * enhanceTitle で遅延プロバイダを引いても同期解決の循環が閉じるので、ローカル状態だけを読む。
 * 監視と状態更新は FrontendApplicationContribution として構築される updater に分離する。
 */
@injectable()
export class AkariWelcomeWindowTitleContribution implements WindowTitleContribution {

    protected opened = false;
    protected resolvedTitle: string | null = null;
    protected channel: string | undefined;

    setTitleState(opened: boolean, resolvedTitle: string | null, channel?: string): boolean {
        const changed = this.opened !== opened || this.resolvedTitle !== resolvedTitle || this.channel !== channel;
        this.opened = opened;
        this.resolvedTitle = resolvedTitle;
        this.channel = channel;
        return changed;
    }

    enhanceTitle(title: string, parts: Map<string, string | undefined>): string {
        if (!this.opened) {
            return FrontendApplicationConfigProvider.get().applicationName;
        }
        const project = this.resolvedTitle || parts.get('rootName');
        return project ? homeWindowTitle(project, this.channel) : title;
    }
}

@injectable()
export class AkariWelcomeWindowTitleUpdater implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(WindowTitleService)
    protected readonly windowTitleService: WindowTitleService;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(EnvVariablesServer) protected readonly envVariables: EnvVariablesServer;

    @inject(AkariWelcomeWindowTitleContribution)
    protected readonly contribution: AkariWelcomeWindowTitleContribution;

    protected readonly toDispose = new DisposableCollection();
    protected intakeUri: URI | undefined;
    protected titleUpdated = false;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => void this.refresh()));
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.intakeUri && event.contains(this.intakeUri)) {
                void this.refresh();
            }
        }));
        void this.refresh();
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    protected async refresh(): Promise<void> {
        const roots = await this.workspaceService.roots;
        this.intakeUri = roots[0]?.resource.resolve(INTAKE_RELATIVE_PATH);
        const title = this.intakeUri ? await this.readTitle(this.intakeUri) : null;
        const channel = roots[0] ? await this.readChannel(roots[0].resource) : undefined;
        const changed = this.contribution.setTitleState(this.workspaceService.opened, title, channel);
        // 未選択・title 無しで状態が既定値のままでも、初回は必ず反映する。
        if (changed || !this.titleUpdated) {
            this.titleUpdated = true;
            // タイトルパーツ自体は変わっていないが、enhanceTitle を再評価させたい
            // だけなので空更新で updateTitle() を再トリガーする（公式 API はこれのみ）。
            this.windowTitleService.update({});
        }
    }

    protected async readChannel(projectUri: URI): Promise<string | undefined> {
        try {
            const override = await this.envVariables.getValue('AKARI_HOME');
            const home = override?.value ? URI.fromFilePath(override.value) : new URI(await this.envVariables.getHomeDirUri()).resolve('.akari');
            const pointer = JSON.parse((await this.fileService.readFile(home.resolve('creator-root.json'))).value.toString());
            if (typeof pointer?.lastRoot !== 'string') { return undefined; }
            const segments = URI.fromFilePath(pointer.lastRoot).relative(projectUri)?.toString().split('/');
            return segments?.length === 4 && segments[0] === 'channels' && segments[2] === 'videos' ? segments[1] : undefined;
        } catch { return undefined; }
    }

    protected async readTitle(uri: URI): Promise<string | null> {
        try {
            const content = await this.fileService.readFile(uri);
            return parseIntakeTitle(JSON.parse(content.value.toString()));
        } catch {
            return null;
        }
    }

}
