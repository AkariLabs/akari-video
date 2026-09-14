import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { AkariWorldViewService } from '../common/akari-world-view-protocol';
import { worldOverviewHtml } from '../common/world-overview-html';

export const OPEN_WORLD_MAP: Command = { id: 'akari.world.openMap', label: '地図を開く' };
export const SEEK_WORLD_MAP: Command = { id: 'akari.world.seek' };
export const OPEN_WORLD_MAP_BESIDE_PREVIEW: Command = { id: 'akari.world.openBesidePreview', label: 'プレビューと並べる' };
const IDENTIFIER = { id: 'akari-world-map', viewId: 'akari-world-map' };

@injectable()
export class AkariWorldViewContribution implements CommandContribution {
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;
    @inject(ApplicationShell) protected readonly shell!: ApplicationShell;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    @inject(AkariScopeService) protected readonly scope!: AkariScopeService;
    @inject(AkariWorldViewService) protected readonly service!: AkariWorldViewService;
    protected widget?: WebviewWidget;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(OPEN_WORLD_MAP, { execute: () => this.open(false) });
        registry.registerCommand(OPEN_WORLD_MAP_BESIDE_PREVIEW, { execute: () => this.open(true) });
        registry.registerCommand(SEEK_WORLD_MAP, { execute: (request?: { time?: number }) => {
            if (Number.isFinite(request?.time)) this.widget?.sendMessage({ type: 'akari-world-seek', time: request!.time });
        } });
    }

    protected async open(beside: boolean): Promise<WebviewWidget | undefined> {
        if (this.scope.worldMap.state === 'absent') return undefined;
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root) return undefined;
        const widget = await this.widgets.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, IDENTIFIER);
        this.widget = widget;
        widget.viewType = 'akari.world';
        widget.title.label = '地図'; widget.title.caption = 'ワールド地図'; widget.title.iconClass = 'codicon codicon-map';
        widget.setContentOptions({ allowScripts: true });
        const initial = await this.commands.executeCommand<number>('akari.timeline.playhead').catch(() => 0);
        const sources = await this.service.readWorldOverviewSources(root.toString());
        widget.setHTML(worldOverviewHtml({ ...sources, seconds: initial ?? 0, error: this.scope.worldMap.error ?? sources.error }));
        const hasPreview = this.shell.widgets.some(candidate => Boolean((candidate as { akariPreviewEditUri?: unknown }).akariPreviewEditUri));
        if (!widget.isAttached) this.shell.addWidget(widget, beside && hasPreview ? { area: 'main', mode: 'split-right' } : { area: 'main' });
        await this.shell.activateWidget(widget.id);
        widget.disposed.connect(() => { if (this.widget === widget) this.widget = undefined; });
        return widget;
    }
}
