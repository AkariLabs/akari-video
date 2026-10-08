import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell, BaseWidget, FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import {
    RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID, RAIL_LIBRARY_OPENER_ID,
    RAIL_EXPORT_OPENER_ID, RAIL_DEVELOPER_OPENER_ID
} from '../common/rail-ids';
import { railOpenerCommand } from '../common/rail-model';
import { railDisabledIds } from '../common/rail-model';
import { AkariScopeService } from './akari-scope-service';
import { AkariExportAvailabilityService } from './akari-export-availability-service';

@injectable()
abstract class AkariRailOpener extends BaseWidget {
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(AkariScopeService) protected readonly scopeService!: AkariScopeService;
    @inject(AkariExportAvailabilityService) protected readonly exportAvailability!: AkariExportAvailabilityService;

    protected configure(id: string, label: string, caption: string, icon: string): void {
        this.id = id;
        this.title.label = label;
        this.title.caption = caption;
        this.title.iconClass = `codicon ${icon}`;
        this.title.closable = false;
    }

    protected override onActivateRequest(_message: Message): void {
        const command = railOpenerCommand(this.id);
        if (!command) return;
        if (railDisabledIds(this.scopeService.scope, this.exportAvailability.snapshot.exists).has(this.id)) return;
        if (this.id === RAIL_EXPORT_OPENER_ID || this.id === RAIL_DEVELOPER_OPENER_ID) this.shell.collapsePanel('left');
        void this.commands.executeCommand(command.id, ...(command.args ? [command.args] : [])).catch(() => undefined);
    }
}

@injectable()
export class AkariRailExpandOpener extends AkariRailOpener {
    static readonly ID = RAIL_EXPAND_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailExpandOpener.ID, 'それぞれ、何があるか', 'それぞれ、何があるか', 'codicon-menu'); }
}
@injectable()
export class AkariRailProjectOpener extends AkariRailOpener {
    static readonly ID = RAIL_PROJECT_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailProjectOpener.ID, 'プロジェクト', '開いているプロジェクトの中身（素材・企画）', 'codicon-device-camera-video'); }
}
@injectable()
export class AkariRailLibraryOpener extends AkariRailOpener {
    static readonly ID = RAIL_LIBRARY_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailLibraryOpener.ID, 'ライブラリ', 'よく使う素材・BGM・フォント・字幕スタイル・テンプレ', 'codicon-library'); }
}
@injectable()
export class AkariRailExportOpener extends AkariRailOpener {
    static readonly ID = RAIL_EXPORT_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailExportOpener.ID, '書き出し', '動画ファイルに書き出す。押すと書き出しの画面が開く', 'codicon-desktop-download'); }
}
@injectable()
export class AkariRailDeveloperOpener extends AkariRailOpener {
    static readonly ID = RAIL_DEVELOPER_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailDeveloperOpener.ID, '開発者', '細かい設定（開発者モードのときだけ）', 'codicon-tools'); }
}

@injectable()
export class AkariRailOpenersContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        for (const [id, rank] of [
            [RAIL_EXPAND_ID, 10], [RAIL_PROJECT_OPENER_ID, 20], [RAIL_LIBRARY_OPENER_ID, 30],
            [RAIL_EXPORT_OPENER_ID, 60], [RAIL_DEVELOPER_OPENER_ID, 390]
        ] as const) {
            const widget = await this.widgetManager.getOrCreateWidget(id);
            if (!widget.isAttached) await app.shell.addWidget(widget, { area: 'left', rank });
        }
    }
}
