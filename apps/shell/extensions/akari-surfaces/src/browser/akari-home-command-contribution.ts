import { inject, injectable } from '@theia/core/shared/inversify';
import {
    Command,
    CommandContribution,
    CommandRegistry,
    MenuContribution,
    MenuModelRegistry
} from '@theia/core/lib/common';
import { ApplicationShell, CommonMenus, WidgetManager } from '@theia/core/lib/browser';
import { AkariHomeWidget } from './akari-home-widget';

/**
 * 進め方フォーム（intake サーフェス）をホーム以外から開く経路
 * （task 2026-08-02-home-v4-minimal）。v3 まではホーム dashboard 上の
 * 「進め方カード」がこの経路を兼ねていたが、v4 でカードごと撤去したため
 * （裁定 R2）、コマンドパレットから直接開ける最小のコマンドを 1 個だけ用意する
 * （intake.json 自体の SSOT・エージェント書き込み可は不変。v3 R5）。
 *
 * NEW_PROJECT は File メニュー／コマンドパレットの「新規プロジェクト作成」。
 * ホームの「＋ 新しい動画を始める」と**同じ 1 経路**（AkariHomeWidget#startNewProject）
 * を呼ぶ（オーナー裁定 2026-08-07）。以前は akari-project 拡張のフォルダ選択版だけが
 * この位置に居たが、ネイティブのフォルダ選択に「新規フォルダ」ボタンが無く
 * （Theia の toOpenDialogOptions が createDirectory を渡さない）、既定の表示先も
 * 今開いているプロジェクトなので、空フォルダを事前に用意していない限り
 * 「空のフォルダーを選んでください」かキャンセルで必ず行き止まりになる実測があった。
 * フォルダ選択版は「場所を選んで新規作成…」として akari-project 側に残してある。
 */
export const AkariHomeCommands = {
    OPEN_INTAKE_FORM: {
        id: 'akari.home.openIntakeForm',
        label: '進め方フォームを開く'
    } as Command,
    NEW_PROJECT: {
        id: 'akari.home.newProject',
        label: '新規プロジェクト作成'
    } as Command,
    OPEN_FIRST_RUN_SETUP: {
        id: 'akari.home.openFirstRunSetup',
        label: '初回セットアップを開く'
    } as Command
};

@injectable()
export class AkariHomeCommandContribution implements CommandContribution, MenuContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariHomeCommands.OPEN_INTAKE_FORM, {
            execute: async () => {
                const widget = await this.revealHome();
                await widget.openIntakeForm();
            }
        });
        registry.registerCommand(AkariHomeCommands.NEW_PROJECT, {
            execute: async () => {
                // ホームを出してから始める。作成中は「作成しています…」がホーム上に
                // 出るので、メニューから始めても進行が見える場所に居る。
                const widget = await this.revealHome();
                await widget.startNewProject();
            }
        });
        registry.registerCommand(AkariHomeCommands.OPEN_FIRST_RUN_SETUP, {
            execute: async () => {
                const widget = await this.revealHome();
                await widget.openFirstRunSetup();
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_NEW, {
            commandId: AkariHomeCommands.NEW_PROJECT.id,
            label: AkariHomeCommands.NEW_PROJECT.label,
            order: 'a05'
        });
    }

    /** ホームを main エリアに出して前面にする（無ければ作る）。 */
    protected async revealHome(): Promise<AkariHomeWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, { area: 'main', rank: 10 });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }
}
