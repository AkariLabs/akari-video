import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { AkariHomeWidget } from './akari-home-widget';

/**
 * 進め方フォーム（intake サーフェス）をホーム以外から開く経路
 * （task 2026-08-02-home-v4-minimal）。v3 まではホーム dashboard 上の
 * 「進め方カード」がこの経路を兼ねていたが、v4 でカードごと撤去したため
 * （裁定 R2）、コマンドパレットから直接開ける最小のコマンドを 1 個だけ用意する
 * （intake.json 自体の SSOT・エージェント書き込み可は不変。v3 R5）。
 */
export const AkariHomeCommands = {
    OPEN_INTAKE_FORM: {
        id: 'akari.home.openIntakeForm',
        label: '進め方フォームを開く'
    } as Command
};

@injectable()
export class AkariHomeCommandContribution implements CommandContribution {

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AkariHomeCommands.OPEN_INTAKE_FORM, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID);
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main', rank: 10 });
                }
                await this.shell.activateWidget(widget.id);
                await widget.openIntakeForm();
            }
        });
    }
}
