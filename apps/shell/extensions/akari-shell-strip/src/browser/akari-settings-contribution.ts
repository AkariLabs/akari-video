import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication, WidgetManager, ApplicationShell, BaseWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';

/** Activity-bar entry only. The settings body lives in the surfaces dialog. */
@injectable()
export class AkariSettingsOpener extends BaseWidget {
    static readonly ID = 'akari-settings-opener';
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;

    @postConstruct()
    protected init(): void {
        this.id = AkariSettingsOpener.ID;
        this.title.label = '設定';
        this.title.caption = 'AKARI Video の設定';
        this.title.iconClass = 'codicon codicon-settings-gear';
        this.title.closable = false;
    }

    protected override onActivateRequest(_message: Message): void {
        // Collapse before the asynchronous dialog acquires focus; keep the icon at rank 400.
        this.shell.collapsePanel('left');
        void this.commands.executeCommand('akari.settings.open').catch(() => undefined);
    }
}

@injectable()
export class AkariSettingsContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget(AkariSettingsOpener.ID);
        if (!widget.isAttached) { await app.shell.addWidget(widget, { area: 'left', rank: 400 }); }
    }
}
