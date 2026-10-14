import { t } from '../common/shell-text';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell, BaseWidget, FrontendApplication, FrontendApplicationContribution, WidgetManager } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import { Message } from '@theia/core/shared/@lumino/messaging';
import {
    RAIL_EXPAND_ID, RAIL_PROJECT_OPENER_ID, RAIL_LIBRARY_OPENER_ID,
    RAIL_CONNECT_OPENER_ID, RAIL_EXPORT_OPENER_ID, RAIL_DEVELOPER_OPENER_ID
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
    @postConstruct() protected init(): void { this.configure(AkariRailExpandOpener.ID, t('shell.leftRail.menu.menuLabel'), t('shell.leftRail.menu.menuLabel'), 'codicon-menu'); }
}
@injectable()
export class AkariRailProjectOpener extends AkariRailOpener {
    static readonly ID = RAIL_PROJECT_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailProjectOpener.ID, t('shell.leftRail.project.projectLabel'), t('shell.leftRail.project.openProjectContentsAssetsPlanningText'), 'codicon-device-camera-video'); }
}
@injectable()
export class AkariRailLibraryOpener extends AkariRailOpener {
    static readonly ID = RAIL_LIBRARY_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailLibraryOpener.ID, t('shell.leftRail.library.libraryLabel'), t('shell.leftRail.library.assetsBgmFontsCaptionStylesTemplatesText'), 'codicon-library'); }
}
@injectable()
export class AkariRailConnectOpener extends AkariRailOpener {
    static readonly ID = RAIL_CONNECT_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailConnectOpener.ID, 'つなぐ', '道具とサービスをつなぐ', 'codicon-plug'); }
}
@injectable()
export class AkariRailExportOpener extends AkariRailOpener {
    static readonly ID = RAIL_EXPORT_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailExportOpener.ID, t('shell.leftRail.export.exportAction'), t('shell.leftRail.export.exportVideoFileOpensExportScreenMessage'), 'codicon-desktop-download'); }
}
@injectable()
export class AkariRailDeveloperOpener extends AkariRailOpener {
    static readonly ID = RAIL_DEVELOPER_OPENER_ID;
    @postConstruct() protected init(): void { this.configure(AkariRailDeveloperOpener.ID, t('shell.leftRail.developer.developerLabel'), t('shell.leftRail.developer.advancedSettingsDeveloperModeText'), 'codicon-tools'); }
}

@injectable()
export class AkariRailOpenersContribution implements FrontendApplicationContribution {
    @inject(WidgetManager) protected readonly widgetManager!: WidgetManager;

    async onStart(app: FrontendApplication): Promise<void> {
        for (const [id, rank] of [
            [RAIL_EXPAND_ID, 10], [RAIL_PROJECT_OPENER_ID, 20], [RAIL_LIBRARY_OPENER_ID, 30],
            [RAIL_CONNECT_OPENER_ID, 45], [RAIL_EXPORT_OPENER_ID, 60], [RAIL_DEVELOPER_OPENER_ID, 390]
        ] as const) {
            const widget = await this.widgetManager.getOrCreateWidget(id);
            if (!widget.isAttached) await app.shell.addWidget(widget, { area: 'left', rank });
        }
    }
}
